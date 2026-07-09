# switch-acc-ai

`switch-acc-ai` provides the `swa` command for running Codex with isolated `CODEX_HOME` account profiles.

Each account profile is stored separately, while shared Codex assets can still be linked from your main Codex home.

## Install

Run without installing:

```bash
npx switch-acc-ai
```

Or install globally:

```bash
npm install -g switch-acc-ai
swa status
```

## Account Storage

Profiles are stored here by default:

```bash
~/.codex-accounts/<name>
```

The current account is stored in:

```bash
~/.codex-accounts/.current
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
swa
swa login main
swa use main
swa current
swa list
swa status
swa status acc2
swa status --all
swa pick --model gpt-5
swa main --model gpt-5
swa resume <session-id>
swa rename main backup
swa remove backup
```

## Environment

Change the account profile root:

```bash
CODEX_ACCOUNTS_DIR=~/my-codex-accounts swa list
```

Change the shared Codex home used for linked assets:

```bash
CODEX_SHARED_HOME=~/my-codex-home swa main
```

## Migration From cx

The old Bash command was `cx`. The npm package exposes only `swa`.

```bash
cx status        # old
swa status       # new
```

Existing profiles in `~/.codex-accounts` remain compatible.
