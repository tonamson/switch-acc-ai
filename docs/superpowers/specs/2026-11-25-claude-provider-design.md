# Claude provider for sacc — design

## Intent
Third provider, `claude` (Anthropic Claude Code), same model as Codex/Grok: many accounts, isolated auth per profile, shared skills/sessions, official `claude` CLI launched under the profile, usage shown in the same unified view. Why: user has several Claude accounts and wants one switcher + one usage view.

## Goals
- `sacc claude add|login|run|list|...` mirroring the Grok/Codex commands.
- TUI provider entry "Claude" with run/login/usage like the others.
- Usage: 5h window + weekly window (+ plan/identity label) in the existing `UsageStatus` shape.

## Non-goals / anti-goals
- No proxy, no token rotation, no storing credentials ourselves.
- Must never mix auth between profiles (a profile silently using another account's login = failure).

## Approaches (picked: 1)
1. **Unofficial OAuth usage endpoint**, token read per profile. Matches Codex/Grok style; risk: endpoint undocumented, may change. **Picked.**
2. Parse `/usage` from the CLI: fragile, slow.
3. No usage in v1: safe, but misses the stated need.

## Design (user decided: approach 1; rest is my call)
- `config.ts`: `ProviderId` adds `"claude"`; `accountsDir` default `~/.claude-accounts`, `sharedHome` `~/.claude` (env overrides `CLAUDE_ACCOUNTS_DIR`, `CLAUDE_SHARED_HOME`); `SHARED_ASSETS.claude` = `skills, agents, commands, plugins, projects (sessions), settings.json, CLAUDE.md, rules` (my call; verify against real layout, never share credentials/`.claude.json` auth state).
- `src/core/claude.ts` (modeled on `grok.ts`): env `CLAUDE_CONFIG_DIR=<profile>`; `loginClaude`, `runClaude`, `readAccountLabel`, `readAuthStatus`.
- Token source: first `<profile>/.credentials.json`, else macOS Keychain via `security find-generic-password` (service name derived per config dir). **First task: verify with two real profiles that Keychain entries are isolated per `CLAUDE_CONFIG_DIR`.** If not, stop and report; do not ship mixed auth.
- Usage: GET Anthropic OAuth usage endpoint with Bearer token; map to `fiveHour` and `weekly` via `metricFromPercentWindow`; monthly `-`. Any HTTP/shape error → `note: usage error: ...`, never throws (same as Grok).
- Session sharing: `projects/` is the Claude session store; the sessions repair step is needed only if paths are absolute — builder checks and adds a repair like `repairGrokSessions` only if resume breaks after switch (my call).
- Touch points: `config.ts`, `accounts.ts` (provider branch), `commands.ts`, `App.tsx`, README (flip Claude to Supported), tests with a `fakeClaude` helper like `fakeGrok`.

## Left to builder
Exact shared-asset list, Keychain service-name derivation, endpoint headers/response mapping, install hint text for missing `claude`.
