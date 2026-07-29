```text
  ╔══════════════════════════════════════════╗
  ║  █████╗ █████╗  █████╗ █████╗            ║
  ║  ██╔══╝██╔══██╗██╔═══╝██╔═══╝            ║
  ║  █████╗███████║██║    ██║                ║
  ║  ╚══██║██╔══██║██║    ██║                ║
  ║  █████║██║  ██║╚█████╗╚█████╗  · a i ·   ║
  ║  ╚════╝╚═╝  ╚═╝ ╚════╝ ╚════╝            ║
  ║                                          ║
  ║  01 00 10  01 10 00  01 10 00  01 00 11  ║
  ╚══════════════════════════════════════════╝
           s w i t c h · a c c · a i
```

<p align="center">
  <strong>One machine. Many AI CLI accounts. Zero mixed auth.</strong><br/>
  Isolated profiles for <b>Codex</b> (OpenAI) &amp; <b>Grok</b> (xAI) — official CLIs only.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/switch-acc-ai"><img src="https://img.shields.io/npm/v/switch-acc-ai.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/switch-acc-ai"><img src="https://img.shields.io/npm/dm/switch-acc-ai.svg?style=flat-square&color=cb3837" alt="npm downloads" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/switch-acc-ai.svg?style=flat-square" alt="node" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license" /></a>
  <a href="https://github.com/tonamson/switch-acc-ai"><img src="https://img.shields.io/github/stars/tonamson/switch-acc-ai?style=flat-square" alt="stars" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#faq">FAQ</a>
</p>

---

## Why

You run **Codex** and/or **Grok** on one laptop. Multiple personal logins. One shared `~/.codex` or `~/.grok` **mixes cookies, sessions, and auth**.

**`sacc`** keeps each account in its own home profile, then launches the **official** CLI:

| Problem | What `sacc` does |
|---------|------------------|
| Auth / sessions bleed across logins | Isolated `CODEX_HOME` / `GROK_HOME` per profile |
| Skills & plugins reinstalled every switch | Shared assets symlinked into every profile |
| Lost threads after switch | Shared `sessions/` + resume index repair |
| “Which account is left this week?” | Unified usage status (5h / weekly / monthly) |

Not a proxy. Not multi-key rotation. **Personal profile switcher** for people who own their own accounts.

---

## Features

- **Codex + Grok** in one tool (`sacc` / TUI)
- **Isolated profiles** — login once per name, switch anytime
- **Official CLIs only** — no MITM, no third-party OAuth siphon
- **Shared skills, plugins, rules, sessions** across your profiles
- **Session resume after switch** (Codex SQLite index + Grok FS layout)
- **Usage status** — rate limits / credits in one view
- **Interactive TUI** + scriptable CLI
- **Self-update** — `sacc update`

---

## Install

```bash
npm install -g switch-acc-ai
```

**Requirements**

| Need | Notes |
|------|--------|
| Node.js **≥ 20** | Runtime for `sacc` |
| [Codex CLI](https://github.com/openai/codex) | On `PATH` if you use Codex |
| [Grok CLI](https://x.ai/cli) | On `PATH` if you use Grok |

```bash
# Grok CLI (example)
curl -fsSL https://x.ai/cli/install.sh | bash
```

---

## Quick start

```bash
# Interactive menu (pick provider → account → run)
sacc

# First-time login into a named profile
sacc codex login work
sacc grok login personal

# Run official CLI under that profile
sacc codex work
sacc grok personal

# See usage across all Codex accounts
sacc status --all
sacc grok status --all
```

Flow:

```text
  sacc
    ├─ pick provider (codex | grok)
    ├─ list / login / rename / remove
    ├─ status (usage windows)
    └─ run → official CLI with isolated home
```

---

## CLI

### Run

| Command | Description |
|---------|-------------|
| `sacc` | Open interactive menu |
| `sacc codex <account> [args…]` | Run Codex under profile |
| `sacc grok <account> [args…]` | Run Grok under profile |
| `sacc <account> [args…]` | Codex shortcut (compat) |
| `sacc pick [args…]` | Pick Codex account, then run |
| `sacc codex pick [args…]` | Pick Codex account, then run |
| `sacc grok pick [args…]` | Pick Grok account, then run |
| `sacc update` | `npm install -g switch-acc-ai@latest` |
| `sacc logs` | Path to today’s log file |

### Accounts

| Command | Description |
|---------|-------------|
| `sacc codex login <name>` | OAuth login into Codex profile |
| `sacc grok login <name>` | OAuth login into Grok profile |
| `sacc login <name>` | Codex login (compat) |
| `sacc codex list` / `sacc grok list` | List profiles + identity |
| `sacc list` | List Codex profiles (compat) |
| `sacc codex rename <old> <new>` | Rename profile |
| `sacc grok rename <old> <new>` | Rename profile |
| `sacc codex remove <name>` | Delete profile (confirm) |
| `sacc grok remove <name>` | Delete profile (confirm) |

### Status

| Command | Description |
|---------|-------------|
| `sacc codex status <name>` | Usage: 5h / weekly / monthly |
| `sacc grok status <name>` | Usage: 5h / weekly / monthly |
| `sacc status --all` | All Codex accounts |
| `sacc grok status --all` | All Grok accounts |

---

## How it works

`sacc` does **not** replace auth. It sets a dedicated home, links shared assets, repairs resume indexes, then `spawn`s the real CLI.

| | **Codex** | **Grok** |
|---|-----------|----------|
| Profiles | `~/.codex-accounts/<name>` | `~/.grok-accounts/<name>` |
| Shared home | `~/.codex` | `~/.grok` |
| Env var | `CODEX_HOME` | `GROK_HOME` |
| Private | Auth / tokens / per-account state | Auth / tokens / per-account state |
| Shared (symlink) | `skills`, `plugins`, `sessions`, `config.toml` | `skills`, `sessions`, `rules`, `plugins`, `AGENTS.md`, … |

```text
  ~/.codex-accounts/work/     ──►  CODEX_HOME for "work"
  ~/.codex-accounts/side/     ──►  CODEX_HOME for "side"
           │
           └─ sessions/, skills/, …  ──symlink──►  ~/.codex/
```

Override paths if needed:

```bash
export CODEX_ACCOUNTS_DIR=...
export CODEX_SHARED_HOME=...
export GROK_ACCOUNTS_DIR=...
export GROK_SHARED_HOME=...
```

---

## What this is / isn’t

| ✅ This is | ❌ This is not |
|------------|----------------|
| Personal multi-profile manager | Account sharing / credential rental |
| Launcher for **official** Codex & Grok CLIs | API proxy / multi-key round-robin |
| Isolation so auth & sessions don’t mix | Bypass of provider rate limits |
| Open source (MIT) | A replacement for provider ToS |

You use **your** accounts. Each profile stays yours. Follow [OpenAI](https://openai.com/policies/) and [xAI](https://x.ai/legal/) terms for multi-account and usage limits.

---

## FAQ

**Does switching lose my chat history?**  
Sessions are shared under the global home, with resume repair for Codex’s SQLite index and Grok’s on-disk layout. Use the CLI’s normal resume flow after switch.

**Can I use this in scripts?**  
Yes — skip the TUI and pass the account name:

```bash
sacc codex work exec "summarize README.md"
sacc grok personal --help
```

**Where are logs?**  

```bash
sacc logs
```

**Update**  

```bash
sacc update
# or
npm install -g switch-acc-ai@latest
```

---

## Development

```bash
git clone https://github.com/tonamson/switch-acc-ai.git
cd switch-acc-ai
npm install
npm run build
npm test
node dist/bin/sacc.js
```

| Script | |
|--------|--|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |

---

## Links

- **GitHub:** [tonamson/switch-acc-ai](https://github.com/tonamson/switch-acc-ai)
- **npm:** [switch-acc-ai](https://www.npmjs.com/package/switch-acc-ai)
- **Issues:** [github.com/tonamson/switch-acc-ai/issues](https://github.com/tonamson/switch-acc-ai/issues)

---

## License

[MIT](LICENSE) © tonamson
