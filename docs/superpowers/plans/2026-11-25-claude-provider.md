# Claude Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `claude` (Claude Code) as a third sacc provider: multi-account profiles, shared assets, run/login, unified usage.

**Architecture:** Mirror `src/core/grok.ts`. Profile isolation via `CLAUDE_CONFIG_DIR=<profile>`. Replace the growing `provider === "codex" ? … : …` ternaries with one dispatch table in `src/core/providers.ts`. Usage comes from Anthropic's unofficial OAuth usage endpoint.

**Tech Stack:** TypeScript (ESM, Node >=20), commander, ink TUI, vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-claude-provider-design.md`

## Global Constraints

- Official `claude` CLI only; never store or copy credentials ourselves.
- Auth must never mix between profiles; if isolation cannot be proven (Task 1), stop and report.
- Usage errors never throw: return `UsageStatus` with `note: "usage error: ..."` (same as Grok).
- Defaults: `accountsDir` `~/.claude-accounts`, `sharedHome` `~/.claude`; env `CLAUDE_ACCOUNTS_DIR`, `CLAUDE_SHARED_HOME`.
- Log through `src/core/log.ts`; redact tokens with `redactSecret`.
- ponytail: no abstractions beyond the dispatch table.

## Review Focus

- Token expired (`expiresAt` past): usage note "token expired, run claude to refresh"; no crash, no refresh attempt.
- No credentials anywhere: label "Not signed in", usage note "not signed in".
- Endpoint returns non-200 or unexpected JSON: note `usage error: ...`, metrics stay `-`.
- `claude` not on PATH: error containing "Is the Claude CLI installed" plus install hint.
- Non-macOS / no Keychain entry: file-only path works, no throw.
- Two profiles must resolve different tokens (isolation).

---

### Task 1: Isolation spike (gate, throwaway)

**Files:** none committed; notes go in the PR description.

- [ ] **Step 1:** In a scratch dir, run `CLAUDE_CONFIG_DIR=/tmp/sacc-a claude` and `/login` as account A; same for `/tmp/sacc-b` as account B.
- [ ] **Step 2:** Check where each stored credentials: `ls -a /tmp/sacc-a` for `.credentials.json`, and `security find-generic-password -s "Claude Code-credentials" ` plus suffixed variants (do NOT print secrets: omit `-w`). Record the exact Keychain service name used per config dir.
- [ ] **Step 3:** Confirm `claude` in A vs B shows different accounts. Record: (a) credential file or Keychain service-name rule, (b) JSON shape of the credential blob (expected `claudeAiOauth.accessToken`, `expiresAt`, `subscriptionType`), (c) where the email lives (expected `<profile>/.claude.json` → `oauthAccount.emailAddress`), (d) the usage endpoint request/response (expected `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer`, `anthropic-beta: oauth-2025-04-20`; body `five_hour` / `seven_day` each `{utilization, resets_at}`).
- [ ] **Step 4:** If A and B share one login, STOP and report to the user. Otherwise Tasks 3–6 use the recorded values in place of the "expected" ones above.

### Task 2: Config + shared assets

**Files:**
- Modify: `src/core/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `ProviderId = "codex" | "grok" | "claude"`; `AppConfig.claude: ProviderConfig`; `SHARED_ASSETS.claude: readonly string[]`; `isProviderId("claude") === true`.

- [ ] **Step 1: Failing tests** in `tests/config.test.ts`: `resolveConfig({}, "/h").claude` equals `{accountsDir:"/h/.claude-accounts", sharedHome:"/h/.claude"}`; env overrides `CLAUDE_ACCOUNTS_DIR`/`CLAUDE_SHARED_HOME` win; `isProviderId("claude")` true; `SHARED_ASSETS.claude` contains `skills, agents, commands, plugins, projects, settings.json, CLAUDE.md, rules` and does NOT contain `.credentials.json` or `.claude.json`.
- [ ] **Step 2:** Run `npx vitest run tests/config.test.ts` → FAIL.
- [ ] **Step 3:** Extend the type, `AppConfig`, `SHARED_ASSETS`, `isProviderId`, `resolveConfig`. Add `commands` to `SHARED_DIR_ASSETS` (`projects` too, replacing "sessions" role for claude; builder keeps existing entries).
- [ ] **Step 4:** `npx vitest run tests/config.test.ts` → PASS. `npx tsc --noEmit` will now fail on exhaustive ternaries; that is fixed in Task 5.
- [ ] **Step 5:** Commit `feat: claude provider config`.

### Task 3: Claude usage + label (core)

**Files:**
- Create: `src/core/claude.ts`
- Test: `tests/claude.test.ts`

**Interfaces:**
- Consumes: `requireProfile`, `ProviderConfig`, `emptyUsageStatus`, `metricFromPercentWindow`, `ABSENT`, `UsageStatus`, `redactSecret`, `logInfo/logWarn/logException`.
- Produces:
  - `export async function readAccountLabel(config: ProviderConfig, name: string): Promise<string>` — email from `.claude.json`, else `"Not signed in"`.
  - `export async function readAuthStatus(config: ProviderConfig, name: string, options?: { fetchImpl?: typeof fetch; readKeychain?: (profilePath: string) => Promise<string | null> }): Promise<UsageStatus>` — `fiveHour` from `five_hour`, `weekly` from `seven_day`, `monthly` absent, `plan` from `subscriptionType`.

- [ ] **Step 1: Failing tests** (tmp profile dirs, fake `fetchImpl`, `readKeychain` stub): (a) credentials file + 200 body `{five_hour:{utilization:12,resets_at:"2026-11-25T18:00:00Z"},seven_day:{utilization:40,resets_at:"2026-11-30T00:00:00Z"}}` → `fiveHour.usedPercent === "12% used"`, `weekly.usedPercent === "40% used"`, request sent `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`; (b) no credentials → `note === "not signed in"`; (c) `expiresAt` in past → note contains `token expired`, fetch not called; (d) HTTP 500 → note starts `usage error:`, no throw; (e) token from `readKeychain` when no file; (f) two profiles with different tokens send different Bearer values.
- [ ] **Step 2:** Run `npx vitest run tests/claude.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Token order: `<profile>/.credentials.json` → `readKeychain(profilePath)` (default impl: macOS only, `execFile security find-generic-password -s <service> -w`, service name rule from Task 1, return null on any error/non-darwin). Reset label via a `resets <YYYY-MM-DD HH:mm UTC>` formatter like Grok's `formatPeriodEnd`. Use `Task 1` values if they differ from expected shapes.
- [ ] **Step 4:** `npx vitest run tests/claude.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: claude usage and label`.

### Task 4: Claude run + login

**Files:**
- Modify: `src/core/claude.ts`
- Create: `tests/helpers/fakeClaude.ts` (copy `fakeGrok.ts` pattern; fake `claude` records `CLAUDE_CONFIG_DIR` and args to log files, writes a fake `.credentials.json` + `.claude.json` on login)
- Test: `tests/claude.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Produces: `runClaude(config: ProviderConfig, name: string, args: string[]): Promise<number>`; `loginClaude(config: ProviderConfig, name: string, args?: string[]): Promise<number>`. Missing binary rejects with message containing `Is the Claude CLI installed`.

- [ ] **Step 1: Failing tests:** `runClaude` launches `claude` with `CLAUDE_CONFIG_DIR=<profile>` and forwarded args; `loginClaude` creates the profile, runs `claude` (interactive; user types `/login`) with `CLAUDE_CONFIG_DIR` set — builder confirms from Task 1 whether a `claude auth login` subcommand exists and uses it if so; ENOENT → rejects with the message above.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement by copying the structure of `runGrok`/`loginGrok` (`ensureProfile`/`requireProfile`, `linkSharedProfile(config, profilePath, "claude")`, `watchSharedProfileLinks`, `prepareInteractiveChild`, `waitForExitDetailed`). Extract nothing shared (YAGNI); duplicate is acceptable, note it as a ponytail comment.
- [ ] **Step 4:** Run → PASS. Verify `linkSharedProfile` never links credential files (test asserts `.credentials.json` stays private).
- [ ] **Step 5:** Commit `feat: claude run and login`.

### Task 5: Dispatch table + wiring (CLI, menu, TUI, help)

**Files:**
- Create: `src/core/providers.ts`
- Modify: `src/cli/commands.ts` (lines ~89, 126, 156, 183, 197, 237, 336, `hintForError`), `src/ui/menu.ts` (~40, 47, 90), `src/ui/tui/App.tsx` (`PROVIDERS`, `menuItems` runLabel, `loadList`, `loadStatus`, dashboard counts), `src/ui/output.ts` (help lines)
- Test: `tests/cli.test.ts`, `tests/output.test.ts`

**Interfaces:**
- Produces: `export const providers: Record<ProviderId, { label: string; run(c: ProviderConfig, n: string, a: string[]): Promise<number>; login(c: ProviderConfig, n: string, a?: string[]): Promise<number>; readLabel(c: ProviderConfig, n: string): Promise<string>; readUsage(c: ProviderConfig, n: string): Promise<UsageStatus> }>`. Entries wrap the existing codex/grok exports and the new claude ones.

- [ ] **Step 1: Failing tests:** `sacc claude login work` then `sacc claude list` shows the fake identity; `sacc claude status work` prints usage via injected fake endpoint (use env override `CLAUDE_USAGE_URL` if needed for the CLI test; add it to `claude.ts` defaulting to the real URL); help output contains `sacc claude login <name>`; `sacc claude <account> args` runs fake claude.
- [ ] **Step 2:** Run `npx vitest run tests/cli.test.ts tests/output.test.ts` → FAIL.
- [ ] **Step 3:** Create the table; replace every ternary listed with `providers[provider].…`; add `addProviderCommands(program, config, "claude")`; TUI: add `{ id: 'claude', name: 'Claude', hint: 'Anthropic Claude Code profiles', enabled: true }`, a `claudeCount`, dashboard line "Claude profiles"; add Claude install hint (`npm install -g @anthropic-ai/claude-code`) to `hintForError`; add help lines mirroring Grok's.
- [ ] **Step 4:** `npx tsc --noEmit && npx vitest run` → all PASS. Existing Codex/Grok tests must be unchanged and green.
- [ ] **Step 5:** Commit `feat: wire claude provider into cli and tui`.

### Task 6: Docs + manual verification

**Files:**
- Modify: `README.md` (Providers table: Claude → ✅ Supported; Features; CLI section; FAQ note that usage uses an unofficial endpoint), `package.json` keywords already include `claude`.

- [ ] **Step 1:** Update README; mention Keychain behavior learned in Task 1.
- [ ] **Step 2:** Manually: `sacc claude login a`, `sacc claude login b`, `sacc claude list` (two different emails), `sacc claude status --all` (both show % windows), `sacc claude a` launches the right account.
- [ ] **Step 3:** `npm test` green. Commit `docs: claude provider supported`.
