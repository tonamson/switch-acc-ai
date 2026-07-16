# switch-acc-ai

[GitHub](https://github.com/tonamson/switch-acc-ai) · [npm](https://www.npmjs.com/package/switch-acc-ai)

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

## Logs

Mỗi ngày `sacc` ghi **một file log chi tiết** (không tóm gọn) cho toàn bộ Codex + Grok:

```text
~/.sacc/logs/sacc-YYYY-MM-DD.log
```

Xem path log hôm nay:

```bash
sacc logs
```

Mỗi entry là multi-line block: timestamp, level, session id, message, rồi **JSON pretty-print đầy đủ** (stack, env, command, pid, elapsedMs, raw API/app-server payloads khi có).

Ví dụ:

```text
-------- 2026-07-16T12:00:00.000Z [INFO] #3 sess=abc123 login start --------
{
  "provider": "grok",
  "account": "work",
  "command": ["grok", "login", "--oauth"],
  "profilePath": "/Users/me/.grok-accounts/work",
  "runtime": { "stdin": { "isTTY": true }, ... }
}
```

Cover (cả 2 provider): CLI, menu TUI, login/run, list, status/usage, rename/remove, pick, profile/symlink, billing & app-server exchange, terminal handoff.

Khi báo lỗi: gửi nguyên file log ngày đó. Mặc định log **debug đầy đủ**. Giảm ồn: `SACC_LOG=info|warn|error`. Tắt: `SACC_LOG=0`.

## Environment

| Variable | Default |
|----------|---------|
| `CODEX_ACCOUNTS_DIR` | `~/.codex-accounts` |
| `CODEX_SHARED_HOME` | `~/.codex` |
| `GROK_ACCOUNTS_DIR` | `~/.grok-accounts` |
| `GROK_SHARED_HOME` | `~/.grok` |
| `SACC_LOG_DIR` | `~/.sacc/logs` |
| `SACC_LOG` | default = full detail; `info`/`warn`/`error` = filter; `0`/`false` = off |

## How it works

1. Tạo profile dir cho account
2. Symlink shared assets từ shared home
3. Spawn CLI với home env riêng:
   - Codex: `CODEX_HOME=<profile>`
   - Grok: `GROK_HOME=<profile>`

Auth do CLI gốc xử lý (`codex login` / `grok login`). `sacc` chỉ isolate profile.
