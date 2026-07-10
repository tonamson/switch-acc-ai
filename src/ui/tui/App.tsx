import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { listAccounts, readCurrentAccount } from '../../core/accounts.js';
import { readAccountLabel, readRateLimits } from '../../core/codex.js';
import type { AppConfig } from '../../core/config.js';
import type { RateLimitStatus } from '../../core/codex.js';

export type Action = 'run' | 'login' | 'use' | 'current' | 'list' | 'status' | 'rename' | 'remove' | 'exit' | { type: 'run'; account: string };
type MenuAction = Exclude<Action, { type: 'run'; account: string }>;

type DetailView = 'overview' | 'list' | 'status' | 'current' | 'run';
type AccountInfo = { name: string; label: string };
type StatusInfo = RateLimitStatus | { account: string; error: string };

const MENU_ITEMS: { label: string; hint: string; value: MenuAction }[] = [
  { label: 'Run Codex', hint: 'Launch with a profile', value: 'run' },
  { label: 'Add account', hint: 'Sign in to a new profile', value: 'login' },
  { label: 'Set default', hint: 'Choose the active profile', value: 'use' },
  { label: 'Accounts', hint: 'View saved profiles', value: 'list' },
  { label: 'Usage', hint: 'Check limits and resets', value: 'status' },
  { label: 'Rename', hint: 'Change a profile name', value: 'rename' },
  { label: 'Remove', hint: 'Delete a profile', value: 'remove' },
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

export function App({ config, onAction }: { config: AppConfig; onAction: (action: Action) => void }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentAccount, setCurrentAccount] = useState<string | null>(null);
  const [accountNames, setAccountNames] = useState<string[]>([]);
  const [detailView, setDetailView] = useState<DetailView>('overview');
  const [accountsInfo, setAccountsInfo] = useState<AccountInfo[]>([]);
  const [statusInfo, setStatusInfo] = useState<StatusInfo[]>([]);
  const [statusIndex, setStatusIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAccounts = async () => {
    const [current, names] = await Promise.all([readCurrentAccount(config), listAccounts(config)]);
    setCurrentAccount(current);
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
    setStatusIndex(Math.max(0, names.indexOf(currentAccount ?? names[0])));
    setDetailView('status');
  };

  const runDetailAction = async (action: 'list' | 'status' | 'current') => {
    setLoading(true);
    setError(null);
    try {
      if (action === 'list') await loadList();
      if (action === 'status') await loadStatus();
      if (action === 'current') {
        await refreshAccounts();
        setDetailView('current');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useInput(async (input, key) => {
    if (loading) return;
    if (key.leftArrow && detailView === 'status' && statusInfo.length > 1) {
      setStatusIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.rightArrow && detailView === 'status' && statusInfo.length > 1) {
      setStatusIndex((index) => Math.min(statusInfo.length - 1, index + 1));
      return;
    }
    if (detailView === 'run' && key.upArrow) {
      setStatusIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (detailView === 'run' && key.downArrow) {
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
          exit();
          onAction({ type: 'run', account });
        }
      } else if (action === 'run') {
        if (!accountNames.length) setError('No profiles available. Add an account first.');
        else {
          setError(null);
          setStatusIndex(Math.max(0, accountNames.indexOf(currentAccount ?? accountNames[0])));
          setDetailView('run');
        }
      } else if (action === 'exit') {
        exit();
        onAction(action);
      } else if (action === 'list' || action === 'status') await runDetailAction(action);
      else if (action === 'use') {
        exit();
        onAction(action);
      } else if (action === 'login' || action === 'rename' || action === 'remove') {
        exit();
        onAction(action);
      }
    } else if (input === 'q' || key.escape) {
      exit();
      onAction('exit');
    }
  });

  const selected = MENU_ITEMS[selectedIndex];
  const layoutWidth = Math.max(60, Math.min(columns - 4, 110));
  const leftMargin = Math.max(0, Math.floor((columns - layoutWidth) / 2));
  const renderBody = () => {
    if (loading) return <Text color="cyan">Refreshing account data...</Text>;
    if (error) return <Text color="red">Could not load data: {error}</Text>;
    if (detailView === 'overview') {
      return (
        <Box flexDirection="column">
          <Text bold color="white">Account workspace</Text>
          <Text color="gray">Choose an action from the navigator.</Text>
          <Box marginTop={2} flexDirection="column">
            <Text><Text color="gray">Active profile  </Text><Text color={currentAccount ? 'green' : 'yellow'}>{currentAccount ?? 'None selected'}</Text></Text>
            <Text><Text color="gray">Saved profiles  </Text>{accountsInfo.length || 'Run Accounts to load'}</Text>
          </Box>
        </Box>
      );
    }
    if (detailView === 'current') {
      return <Box flexDirection="column"><Text bold>Active profile</Text><Text color={currentAccount ? 'green' : 'yellow'}>{currentAccount ?? 'No default account selected.'}</Text></Box>;
    }
    if (detailView === 'run') {
      return <Box flexDirection="column">
        <Text bold>Choose profile</Text>
        <Text color="gray">Use up/down, then press enter to launch Codex.</Text>
        <Box marginTop={1} flexDirection="column">
          {accountNames.map((account, index) => <Text key={account} color={index === statusIndex ? 'cyan' : undefined} bold={index === statusIndex}>
            {index === statusIndex ? '> ' : '  '}{account}{account === currentAccount ? <Text color="green">  default</Text> : null}
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
            <Text color={account.name === currentAccount ? 'green' : 'gray'}>{account.name === currentAccount ? '> ' : '  '}</Text>
            <Text bold={account.name === currentAccount}>{account.name}</Text><Text color="gray">  {account.label}</Text>
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
    <Box justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">SWA <Text color="gray">/ Codex profiles</Text></Text>
      <Text color="gray">active: <Text color={currentAccount ? 'green' : 'yellow'}>{currentAccount ?? 'none'}</Text></Text>
    </Box>
    <Box flexDirection="row" minHeight={14}>
      <Box width={25} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginRight={1}>
        <Text color="gray">NAVIGATOR</Text>
        <Box marginTop={1} flexDirection="column">
          {MENU_ITEMS.map((item, index) => <Text key={item.value} color={selectedIndex === index ? 'cyan' : undefined} bold={selectedIndex === index}>
            {selectedIndex === index ? '> ' : '  '}{item.label}
          </Text>)}
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1}>
        <Text color="cyan">{detailView === 'overview' ? selected.label : detailView === 'run' ? 'RUN CODEX' : detailView.toUpperCase()}</Text>
        <Text color="gray">{detailView === 'overview' ? selected.hint : detailView === 'run' ? 'Select an account to launch.' : 'r to refresh'}</Text>
        <Box marginTop={1}>{renderBody()}</Box>
      </Box>
    </Box>
    <Box marginTop={1}><Text color="gray"><Key>up/down</Key> {detailView === 'run' ? 'profile' : 'navigate'}  <Key>enter</Key> select  <Key>r</Key> refresh  {detailView === 'status' && statusInfo.length > 1 && <><Key>left/right</Key> profile  </>}<Key>q</Key> quit</Text></Box>
  </Box>;
}
