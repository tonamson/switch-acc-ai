import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { listAccounts } from '../../core/accounts.js';
import { readAccountLabel, readRateLimits } from '../../core/codex.js';
import type { AppConfig } from '../../core/config.js';
import type { RateLimitStatus } from '../../core/codex.js';

export type Action =
  | 'run'
  | 'login'
  | 'list'
  | 'status'
  | 'rename'
  | 'remove'
  | 'exit'
  | { type: 'run'; account: string }
  | { type: 'login'; name: string }
  | { type: 'rename'; account: string; newName: string }
  | { type: 'remove'; account: string };
type MenuAction = 'run' | 'login' | 'list' | 'status' | 'rename' | 'remove' | 'exit';

type DetailView = 'overview' | 'list' | 'status' | 'run' | 'accountAction' | 'loginName' | 'renameName' | 'removeConfirm';
type ProviderId = 'codex' | 'claude' | 'more';
type AccountInfo = { name: string; label: string };
type StatusInfo = RateLimitStatus | { account: string; error: string };

const PROVIDERS: { id: ProviderId; name: string; hint: string; enabled: boolean }[] = [
  { id: 'codex', name: 'Codex', hint: 'OpenAI CLI profiles', enabled: true },
  { id: 'claude', name: 'Claude', hint: 'Coming soon', enabled: false },
  { id: 'more', name: 'More', hint: 'Add another provider later', enabled: false },
];

const MENU_ITEMS: { label: string; hint: string; value: MenuAction }[] = [
  { label: 'Run Codex', hint: 'Launch with a profile', value: 'run' },
  { label: 'Add account', hint: 'Sign in to a new profile', value: 'login' },
  { label: 'Accounts', hint: 'View saved profiles', value: 'list' },
  { label: 'Usage', hint: 'Check limits and resets', value: 'status' },
  { label: 'Rename', hint: 'Change a profile name', value: 'rename' },
  { label: 'Remove', hint: 'Delete a profile', value: 'remove' },
  { label: 'Back', hint: 'Choose another provider', value: 'exit' },
  { label: 'Exit', hint: 'Close switcher', value: 'exit' },
];

function usageColor(value: string): 'green' | 'yellow' | 'red' | undefined {
  const used = Number.parseFloat(value);
  if (Number.isNaN(used)) return undefined;
  if (used >= 85) return 'red';
  if (used >= 70) return 'yellow';
  return 'green';
}

function Key({ children }: { children: string }) {
  return <Text color="gray">[{children}]</Text>;
}

function detailTitle(detailView: DetailView, selectedLabel: string, accountAction: 'rename' | 'remove'): string {
  if (detailView === 'overview') return selectedLabel;
  if (detailView === 'run') return 'RUN CODEX';
  if (detailView === 'accountAction') return accountAction.toUpperCase();
  if (detailView === 'loginName') return 'ADD ACCOUNT';
  if (detailView === 'renameName') return 'RENAME';
  if (detailView === 'removeConfirm') return 'REMOVE';
  return detailView.toUpperCase();
}

export function App({ config, onAction }: { config: AppConfig; onAction: (action: Action) => void }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [accountNames, setAccountNames] = useState<string[]>([]);
  const [detailView, setDetailView] = useState<DetailView>('overview');
  const [accountsInfo, setAccountsInfo] = useState<AccountInfo[]>([]);
  const [statusInfo, setStatusInfo] = useState<StatusInfo[]>([]);
  const [statusIndex, setStatusIndex] = useState(0);
  const [accountAction, setAccountAction] = useState<'rename' | 'remove'>('rename');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = (action: Action) => {
    onAction(action);
    exit();
  };

  const refreshAccounts = async () => {
    const names = await listAccounts(config);
    setAccountNames(names);
    return names;
  };

  useEffect(() => {
    refreshAccounts().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [config]);

  const loadList = async () => {
    const names = await refreshAccounts();
    const infos = await Promise.all(names.map(async (name) => ({
      name,
      label: await readAccountLabel(config, name).catch(() => 'Not signed in'),
    })));
    setAccountsInfo(infos);
    setDetailView('list');
  };

  const loadStatus = async () => {
    const names = await refreshAccounts();
    const stats = await Promise.all(names.map((name) =>
      readRateLimits(config, name).catch((err: unknown) => ({
        account: name,
        error: err instanceof Error ? err.message : String(err),
      })),
    ));
    setStatusInfo(stats);
    setStatusIndex(0);
    setDetailView('status');
  };

  const runDetailAction = async (action: 'list' | 'status') => {
    setLoading(true);
    setError(null);
    try {
      if (action === 'list') await loadList();
      if (action === 'status') await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useInput(async (input, key) => {
    if (loading) return;
    if (detailView === 'removeConfirm') {
      if (key.escape) {
        setDetailView('overview');
      } else if (key.return) {
        finish({ type: 'remove', account: selectedAccount });
      }
      return;
    }
    if (detailView === 'loginName' || detailView === 'renameName') {
      if (key.escape) {
        setTextInput('');
        setDetailView('overview');
      } else if (key.backspace || key.delete) {
        setTextInput((value) => value.slice(0, -1));
      } else if (key.return) {
        const value = textInput.trim();
        if (detailView === 'loginName' && value) {
          finish({ type: 'login', name: value });
        } else if (detailView === 'renameName' && value) {
          finish({ type: 'rename', account: selectedAccount, newName: value });
        }
      } else if (input) {
        setTextInput((value) => value + input);
      }
      return;
    }
    if (!provider) {
      if (key.upArrow) {
        setProviderIndex((index) => Math.max(0, index - 1));
      } else if (key.downArrow) {
        setProviderIndex((index) => Math.min(PROVIDERS.length - 1, index + 1));
      } else if (key.return) {
        const nextProvider = PROVIDERS[providerIndex];
        if (nextProvider.enabled) {
          setProvider(nextProvider.id);
          setSelectedIndex(0);
          setDetailView('overview');
          setError(null);
        } else {
          setError(`${nextProvider.name} is not wired yet.`);
        }
      } else if (input === 'q' || key.escape) {
        finish('exit');
      }
      return;
    }
    if (key.leftArrow && detailView === 'status' && statusInfo.length > 1) {
      setStatusIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.rightArrow && detailView === 'status' && statusInfo.length > 1) {
      setStatusIndex((index) => Math.min(statusInfo.length - 1, index + 1));
      return;
    }
    if ((detailView === 'run' || detailView === 'accountAction') && key.upArrow) {
      setStatusIndex((index) => Math.max(0, index - 1));
      return;
    }
    if ((detailView === 'run' || detailView === 'accountAction') && key.downArrow) {
      setStatusIndex((index) => Math.min(accountNames.length - 1, index + 1));
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      setDetailView('overview');
    } else if (key.downArrow) {
      setSelectedIndex((index) => Math.min(MENU_ITEMS.length - 1, index + 1));
      setDetailView('overview');
    } else if (input === 'r') {
      if (detailView === 'status') await runDetailAction('status');
      else {
        setLoading(true);
        setError(null);
        try {
          await refreshAccounts();
          setDetailView('overview');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoading(false);
        }
      }
    }
    else if (key.return) {
      const action = MENU_ITEMS[selectedIndex].value;
      if (detailView === 'run') {
        const account = accountNames[statusIndex];
        if (account) {
          finish({ type: 'run', account });
        }
      } else if (detailView === 'accountAction') {
        const account = accountNames[statusIndex];
        if (account && accountAction === 'rename') {
          setSelectedAccount(account);
          setTextInput('');
          setDetailView('renameName');
        } else if (account) {
          setSelectedAccount(account);
          setTextInput('');
          setDetailView('removeConfirm');
        }
      } else if (action === 'run') {
        if (!accountNames.length) setError('No profiles available. Add an account first.');
        else {
          setError(null);
          setStatusIndex(0);
          setDetailView('run');
        }
      } else if (action === 'exit') {
        if (MENU_ITEMS[selectedIndex].label === 'Back') {
          setProvider(null);
          setDetailView('overview');
          setError(null);
        } else {
          finish(action);
        }
      } else if (action === 'list' || action === 'status') await runDetailAction(action);
      else if (action === 'rename' || action === 'remove') {
        if (!accountNames.length) setError('No profiles available. Add an account first.');
        else {
          setError(null);
          setAccountAction(action);
          setStatusIndex(0);
          setDetailView('accountAction');
        }
      } else if (action === 'login') {
        setTextInput('');
        setDetailView('loginName');
      }
    } else if (input === 'q') {
      finish('exit');
    } else if (key.escape) {
      if (provider) {
        setProvider(null);
        setDetailView('overview');
        setError(null);
      } else {
        finish('exit');
      }
    }
  });

  const selected = MENU_ITEMS[selectedIndex];
  const selectedProvider = PROVIDERS[providerIndex];
  const layoutWidth = Math.max(60, Math.min(columns - 4, 110));
  const leftMargin = Math.max(0, Math.floor((columns - layoutWidth) / 2));
  const renderBody = () => {
    if (loading) return <Text color="cyan">Refreshing account data...</Text>;
    if (error) return <Text color="red">Could not load data: {error}</Text>;
    if (!provider) {
      return (
        <Box flexDirection="column">
          <Text bold color="white">Provider dashboard</Text>
          <Text color="gray">Choose the AI CLI you want to manage.</Text>
          <Box marginTop={2} flexDirection="column">
            <Text><Text color="gray">Codex profiles  </Text>{accountNames.length}</Text>
            <Text><Text color="gray">Claude         </Text>not connected</Text>
          </Box>
        </Box>
      );
    }
    if (detailView === 'overview') {
      return (
        <Box flexDirection="column">
          <Text bold color="white">Codex workspace</Text>
          <Text color="gray">Choose an account action from the menu.</Text>
          <Box marginTop={2} flexDirection="column">
            <Text><Text color="gray">Saved profiles  </Text>{accountsInfo.length || 'Run Accounts to load'}</Text>
          </Box>
        </Box>
      );
    }
    if (detailView === 'loginName') {
      return <Box flexDirection="column">
        <Text bold>Account profile name</Text>
        <Text color="cyan">{textInput || ' '}</Text>
      </Box>;
    }
    if (detailView === 'renameName') {
      return <Box flexDirection="column">
        <Text bold>New profile name</Text>
        <Text color="gray">{selectedAccount}</Text>
        <Text color="cyan">{textInput || ' '}</Text>
      </Box>;
    }
    if (detailView === 'removeConfirm') {
      return <Box flexDirection="column">
        <Text bold color="red">Delete profile?</Text>
        <Text>{selectedAccount}</Text>
        <Text color="gray">Press enter to remove, or escape to cancel.</Text>
      </Box>;
    }
    if (detailView === 'run' || detailView === 'accountAction') {
      return <Box flexDirection="column">
        <Text bold>Choose profile</Text>
        <Text color="gray">Use up/down, then press enter.</Text>
        <Box marginTop={1} flexDirection="column">
          {accountNames.map((account, index) => <Text key={account} color={index === statusIndex ? 'cyan' : undefined} bold={index === statusIndex}>
            {index === statusIndex ? '> ' : '  '}{account}
          </Text>)}
        </Box>
      </Box>;
    }
    if (detailView === 'list') {
      if (!accountsInfo.length) return <Text color="yellow">No profiles yet. Choose Add account to sign in.</Text>;
      return <Box flexDirection="column">
        <Text bold>Saved profiles</Text>
        <Box marginTop={1} flexDirection="column">
          {accountsInfo.map((account) => <Text key={account.name}>
            <Text color="gray">  </Text>
            <Text>{account.name}</Text><Text color="gray">  {account.label}</Text>
          </Text>)}
        </Box>
      </Box>;
    }
    if (!statusInfo.length) return <Text color="yellow">No profiles yet. Choose Add account to sign in.</Text>;
    const stat = statusInfo[statusIndex];
    if ('error' in stat) return <Box flexDirection="column"><Text bold color="red">Usage unavailable</Text><Text color="gray">{stat.account}</Text><Text color="red">{stat.error}</Text></Box>;
    return <Box flexDirection="column">
      <Box justifyContent="space-between"><Text bold>{stat.account}</Text><Text color="gray">{statusIndex + 1}/{statusInfo.length}</Text></Box>
      <Text color="gray">{stat.user}  {stat.plan}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text><Text color="gray">5 hour   </Text><Text color={usageColor(stat.primary.usedPercent)}>{stat.primary.usedPercent}</Text><Text color="gray">  {stat.primary.resetLabel}</Text></Text>
        <Text><Text color="gray">Weekly   </Text><Text color={usageColor(stat.secondary.usedPercent)}>{stat.secondary.usedPercent}</Text><Text color="gray">  {stat.secondary.resetLabel}</Text></Text>
        <Text><Text color="gray">Credits  </Text>{stat.resetCredits}</Text>
        {stat.reached && <Text color="yellow">Limit reached: {stat.reached}</Text>}
      </Box>
    </Box>;
  };

  return <Box flexDirection="column" width={layoutWidth} marginLeft={leftMargin} paddingX={2} paddingY={1}>
    <Box flexDirection="row" minHeight={14}>
      <Box width={25} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginRight={1}>
        <Text color="gray">MENU</Text>
        <Box marginTop={1} flexDirection="column">
          {!provider
            ? PROVIDERS.map((item, index) => <Text key={item.id} color={providerIndex === index ? 'cyan' : item.enabled ? undefined : 'gray'} bold={providerIndex === index}>
              {providerIndex === index ? '> ' : '  '}{item.name}<Text color="gray">  {item.enabled ? '' : 'soon'}</Text>
            </Text>)
            : MENU_ITEMS.map((item, index) => <Text key={`${item.label}-${item.value}`} color={selectedIndex === index ? 'cyan' : undefined} bold={selectedIndex === index}>
              {selectedIndex === index ? '> ' : '  '}{item.label}
            </Text>)}
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Text color="cyan">{!provider ? selectedProvider.name.toUpperCase() : detailTitle(detailView, selected.label, accountAction)}</Text>
        <Text color="gray">{!provider ? selectedProvider.hint : detailView === 'overview' ? selected.hint : detailView === 'run' ? 'Select an account to launch.' : detailView === 'accountAction' ? 'Select an account.' : detailView === 'removeConfirm' ? 'Confirm removal.' : detailView === 'loginName' || detailView === 'renameName' ? 'Type, then press enter.' : 'r to refresh'}</Text>
        <Box marginTop={1}>{renderBody()}</Box>
      </Box>
    </Box>
    <Box marginTop={1}><Text color="gray"><Key>up/down</Key> {detailView === 'run' || detailView === 'accountAction' ? 'profile' : 'navigate'}  <Key>enter</Key> select  {provider && detailView !== 'loginName' && detailView !== 'renameName' && detailView !== 'removeConfirm' && <><Key>r</Key> refresh  </>}{detailView === 'status' && statusInfo.length > 1 && <><Key>left/right</Key> profile  </>}<Key>esc</Key> back  <Key>q</Key> quit</Text></Box>
  </Box>;
}
