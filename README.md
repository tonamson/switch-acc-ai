# switch-acc-ai

Switch between multiple Codex accounts without repeatedly logging in and out.

`switch-acc-ai` provides the `sacc` CLI, which runs Codex with an isolated
`CODEX_HOME` for each account. Authentication and account-specific state stay
separate, while common assets such as skills, plugins, sessions, and
configuration can still be shared from your main Codex home.

Use it to:

- Keep personal, work, and other Codex accounts separate.
- Launch Codex with a named account in one command.
- View account status and choose an account interactively.
- Rename or remove local account profiles.
- Continue using the standard `codex login` OAuth flow.

`switch-acc-ai` does not modify Codex authentication. It only manages which
profile directory Codex uses.

## Install

Run without installing:

```bash
npx switch-acc-ai
```

Or install globally:

```bash
npm install -g switch-acc-ai
sacc status
```

## Account Storage

Profiles are stored here unless overridden:

```bash
~/.codex-accounts/<name>
```

Codex OAuth is still handled by `codex login`. This package only switches the profile directory used as `CODEX_HOME`.

When present, these shared assets are linked from `CODEX_SHARED_HOME` into each profile:

```text
skills
plugins
sessions
config.toml
```

## Commands

```bash
sacc
sacc login main
sacc list
sacc status
sacc status acc2
sacc status --all
sacc pick --model gpt-5
sacc main --model gpt-5
sacc resume <session-id>
sacc rename main backup
sacc remove backup
```

## Environment

Change the account profile root:

```bash
CODEX_ACCOUNTS_DIR=~/my-codex-accounts sacc list
```

Change the shared Codex home used for linked assets:

```bash
CODEX_SHARED_HOME=~/my-codex-home sacc main
```

## Migration From cx

The old Bash command was `cx`. The npm package exposes only `sacc`.

```bash
cx status        # old
sacc status       # new
```

Existing profiles in `~/.codex-accounts` remain compatible.
