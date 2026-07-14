# switch-acc-ai

`switch-acc-ai` chuyển nhanh giữa nhiều tài khoản AI CLI trên máy local.

Hiện hỗ trợ:

- **Codex** (OpenAI) — isolate bằng `CODEX_HOME`
- **Grok** (xAI) — isolate bằng `GROK_HOME`

Mỗi account là một profile riêng, không cần proxy hay hack env dễ dính policy.

## Install

```bash
npm install -g switch-acc-ai
```

## Run

```bash
sacc
```

Menu chọn provider (Codex / Grok) rồi quản lý account.

## Commands

### Menu

```bash
sacc                         # open provider menu
```

### Codex

```bash
sacc codex login <name>      # OAuth login into profile
sacc codex list              # list profiles
sacc codex status <name>     # rate limits
sacc codex status --all
sacc codex <account> [args]  # run codex with profile
sacc codex pick [args]       # pick profile then run
sacc codex rename <old> <new>
sacc codex remove <name>
```

### Grok

```bash
sacc grok login <name>       # OAuth login into profile
sacc grok login <name> --oauth
sacc grok login <name> --device-auth
sacc grok list
sacc grok status <name>      # monthly usage + auth session
sacc grok status --all
sacc grok <account> [args]   # run grok with profile
sacc grok pick [args]
sacc grok rename <old> <new>
sacc grok remove <name>
```

### Compat shortcuts (Codex default)

Các lệnh cũ vẫn dùng được, mặc định là Codex:

```bash
sacc login <name>
sacc list
sacc status <name>
sacc <account> [codex args]
sacc pick [codex args]
sacc rename <old> <new>
sacc remove <name>
```

## Storage

| Provider | Profiles | Shared home |
|----------|----------|-------------|
| Codex | `~/.codex-accounts/<name>` | `~/.codex` |
| Grok | `~/.grok-accounts/<name>` | `~/.grok` |

Shared assets (skills, plugins, config, …) được symlink từ shared home vào từng profile khi run/login.

## Environment

| Variable | Default |
|----------|---------|
| `CODEX_ACCOUNTS_DIR` | `~/.codex-accounts` |
| `CODEX_SHARED_HOME` | `~/.codex` |
| `GROK_ACCOUNTS_DIR` | `~/.grok-accounts` |
| `GROK_SHARED_HOME` | `~/.grok` |

## How it works

1. Tạo profile dir cho account
2. Symlink shared assets từ shared home
3. Spawn CLI với home env riêng:
   - Codex: `CODEX_HOME=<profile>`
   - Grok: `GROK_HOME=<profile>`

Auth do CLI gốc xử lý (`codex login` / `grok login`). `sacc` chỉ isolate profile.
