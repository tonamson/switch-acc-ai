# switch-acc-ai

`switch-acc-ai` provides the `sacc` command for running Codex with isolated `CODEX_HOME` account profiles.

Each account profile is stored separately, while shared Codex assets can still be linked from your main Codex home.

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
