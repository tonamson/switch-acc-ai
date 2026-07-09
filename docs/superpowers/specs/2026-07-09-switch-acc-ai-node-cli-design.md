# switch-acc-ai Node CLI Design

Date: 2026-07-09

## Summary

Port the existing `cx` Bash CLI into a public npm package named `switch-acc-ai` with a single executable command, `swa`.

The new CLI keeps the current feature set and account storage model, but moves the implementation to TypeScript so the interactive experience can use a richer command-palette style UI, cleaner status/list output, and maintainable modules.

## Goals

- Publish a public npm package named `switch-acc-ai`.
- Expose only the `swa` command. Do not expose `cx` as a compatibility alias.
- Support `npx switch-acc-ai` and global install usage with `swa`.
- Preserve the existing account-management behavior from `cx`.
- Keep existing Codex profile data compatible.
- Make the CLI presentation more polished than Bash allows while avoiding a heavy TUI framework.
- Use TypeScript for maintainability and typed account/status parsing.

## Non-Goals

- Do not add new account-switching features beyond the current `cx` surface.
- Do not rewrite or manage Codex authentication itself; continue delegating OAuth to `codex login`.
- Do not introduce a React Ink or full-screen TUI app in the first port.
- Do not expose a `cx` npm binary.

## Package And Distribution

The package will use npm's `bin` field to map the command name `swa` to the built executable, for example:

```json
{
  "name": "switch-acc-ai",
  "bin": {
    "swa": "dist/bin/swa.js"
  }
}
```

The executable will include a Node shebang and will be produced by the TypeScript build. The package will be publishable to the public npm registry.

The implementation will target Node.js 20 or newer. Before publishing, verify that `switch-acc-ai` is available on npm. If the name is unavailable, stop and ask for a new package name instead of silently publishing under a different name.

Expected usage:

```bash
npx switch-acc-ai
npx switch-acc-ai status
npm install -g switch-acc-ai
swa status
```

## Commands

The Node CLI will preserve the current command surface with `swa` replacing `cx`:

```text
swa                         open menu
swa <account> [codex args]   run Codex with account
swa run [codex args]         run current account
swa pick [codex args]        choose account then run
swa resume <id> [args]       resume current account
swa login <name>             login Codex OAuth into a profile
swa use <name>               set current account
swa current                  print current account
swa list                     list accounts
swa status                   show current account limits
swa status <name>            show one account limits
swa status --all             show limits for all accounts
swa rename <old> <new>       rename an account
swa remove <name>            delete an account profile after confirmation
```

Unknown commands will continue to be treated as account names when a matching account profile exists. Otherwise the CLI exits with a clear error.

## Data Model

The Node CLI will keep the current file layout:

```text
CODEX_ACCOUNTS_DIR or ~/.codex-accounts
CODEX_SHARED_HOME or ~/.codex
~/.codex-accounts/.current
~/.codex-accounts/<name>
```

Account names must match the existing rule:

```text
letters, numbers, dot, underscore, dash
```

The names `.` and `..` are invalid.

Each account profile remains a dedicated `CODEX_HOME` directory. The CLI will continue linking shared Codex assets from `CODEX_SHARED_HOME` into the account profile when present:

```text
skills
plugins
sessions
config.toml
```

## Architecture

Proposed structure:

```text
package.json
tsconfig.json
src/
  bin/swa.ts
  cli/commands.ts
  core/accounts.ts
  core/codex.ts
  core/config.ts
  ui/theme.ts
  ui/menu.ts
  ui/output.ts
tests/
```

Responsibilities:

- `src/bin/swa.ts`: executable entrypoint, top-level error boundary.
- `src/cli/commands.ts`: command definitions and argument routing.
- `src/core/config.ts`: resolve environment-driven paths and defaults.
- `src/core/accounts.ts`: validate names, list profiles, read/write current account, rename/remove accounts, link shared assets.
- `src/core/codex.ts`: spawn `codex`, run `codex login`, and exchange JSON-RPC messages with `codex app-server --stdio`.
- `src/ui/theme.ts`: color palette and style primitives.
- `src/ui/menu.ts`: interactive command-palette style menus.
- `src/ui/output.ts`: help, list, status, prompt, and error rendering.

## Dependencies

Use a moderate CLI dependency set:

- `commander` for command parsing.
- `@inquirer/prompts` for interactive menus and confirmations.
- `picocolors` for lightweight color.
- `ora` for long-running status reads.
- `cli-table3` for list/status output.

The first implementation should avoid a full-screen TUI framework. If a dependency adds more complexity than value during implementation, prefer a smaller helper or local renderer.

## UI Direction

The UI should feel like a compact command palette rather than a dashboard. It should be more polished than the Bash version, but fast and terminal-native.

Visual rules:

- Use color and spacing more intentionally than the Bash script.
- Keep text concise.
- Use ASCII-safe labels and separators by default.
- Use clear sections for help output.
- Use compact tables or compact blocks for account list and status.
- Make the current account visually obvious.
- Use distinct styling for errors, warnings, prompts, and success messages.
- Respect `NO_COLOR`.

Interactive menu example:

```text
SWA  command palette
context  codex    current  acc2

> 01  Run with account
  02  Login account
  03  Set default account
  04  Status and limits

enter select    arrows move    q/esc back
```

Final menu behavior can use `@inquirer/prompts` conventions instead of exactly matching this text, but the compact command-palette feel should remain.

## Codex Integration

Running Codex:

1. Resolve the target account profile.
2. Link shared profile assets into that account profile if they exist and are not already present.
3. Spawn `codex` with `CODEX_HOME` set to the profile directory.
4. Forward user-provided Codex args unchanged.
5. Use inherited stdio for interactive Codex sessions.

Reading identity and limits:

1. Spawn `codex app-server --stdio` with `CODEX_HOME` set to the profile directory.
2. Send JSON-RPC `initialize`.
3. Send `account/read`.
4. For status commands, send `account/rateLimits/read`.
5. Parse newline-delimited JSON-RPC responses.
6. Enforce timeouts and close the child process cleanly.

The parser should tolerate unrelated lines and only use responses with matching request ids.

## Error Handling

Errors should be short, styled, and actionable:

- Invalid account name: explain the valid character rule.
- Account not found: suggest `swa login <name>` or `swa list`.
- Missing current account: suggest `swa use <name>` or `swa pick`.
- Missing `codex` binary: tell the user Codex CLI must be installed and available in `PATH`.
- JSON-RPC timeout or app-server error: show which account failed.
- `swa remove <name>`: require typed confirmation of the exact account name.

For `swa status --all`, failures must be isolated per account. The command should render successful accounts and per-account error rows, then exit non-zero if any account failed.

## Testing

Test coverage should focus on behavior parity and migration risk:

- Unit tests for config resolution and account name validation.
- Unit tests for account listing, current account read/write, rename, remove, and shared asset linking.
- Unit tests for JSON-RPC response parsing.
- CLI tests with a fake `codex` binary to verify `login`, `run`, `resume`, `list`, and `status`.
- Output tests for `help`, `list`, `status`, and key error messages.
- Smoke tests against the built executable `dist/bin/swa.js`.

The existing shell tests can guide parity cases, but the Node implementation should use a JavaScript or TypeScript test runner.

## Migration Plan

The existing Bash `cx` script may remain in the repository during the port, but it is not part of the npm package command surface. The package should publish only `swa`.

The README should be updated after implementation to document:

- `npx switch-acc-ai`
- global install usage
- command mapping from `cx` examples to `swa`
- environment variables
- account storage compatibility

## Open Decisions Resolved

- Package name: `switch-acc-ai`.
- Command name: `swa`.
- Public npm distribution: yes.
- Implementation language: TypeScript.
- Dependency level: moderate CLI libraries.
- Backward-compatible `cx` binary: no.
