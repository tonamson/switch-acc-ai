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
  Multi-provider profile switcher for official AI CLIs — isolate auth, share skills &amp; sessions.
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

You use more than one AI coding CLI — and often more than one **personal** login per tool. Default homes (`~/.codex`, `~/.grok`, `~/.claude`, …) **mix cookies, sessions, and auth** when you re-login.

**`sacc`** is a **multi-provider account switcher**: each login gets an isolated profile home, shared skills/plugins/sessions stay linked, then the **official** CLI runs under that home.

| Problem | What `sacc` does |
|---------|------------------|
| Auth / sessions bleed across logins | Isolated per-provider profile dirs (`*_HOME` / equivalent) |
| Skills & plugins reinstalled every switch | Shared assets symlinked into every profile |
| Lost threads after switch | Shared `sessions/` + provider-specific resume repair |
| “Which account is left this week?” | Unified usage status (where the provider exposes it) |

Not a proxy. Not multi-key rotation. **Personal profile switcher** for people who own their own accounts.

### Providers

| Provider | CLI | Status |
|----------|-----|--------|
| **Codex** (OpenAI) | `codex` | ✅ Supported |
| **Grok** (xAI) | `grok` | ✅ Supported |
| **Claude** (Anthropic) | `claude` | 🔜 Planned |
| Others (Gemini, …) | official CLIs | 💭 Backlog |

Same product idea for every provider: **isolate auth, share config assets, launch the real CLI.**

---

## Features

- **Multi-provider** — one `sacc` / TUI for all supported CLIs
- **Codex + Grok today** — Claude and more on the roadmap
- **Isolated profiles** — login once per name, switch anytime
- **Official CLIs only** — no MITM, no third-party OAuth siphon
- **Shared skills, plugins, rules, sessions** across your profiles (per provider)
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
    ├─ pick provider (codex | grok | …)
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

`sacc` does **not** replace auth. Per provider it sets a dedicated home, links shared assets, repairs resume indexes when needed, then `spawn`s the real CLI.

### Supported today

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

Same pattern for every future provider (e.g. Claude → isolated profile home + shared skills/sessions + official `claude`).

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
| Multi-provider **personal** profile manager | Account sharing / credential rental |
| Launcher for **official** AI CLIs (per provider) | API proxy / multi-key round-robin |
| Isolation so auth & sessions don’t mix | Bypass of provider rate limits |
| Extensible — more CLIs over time | A replacement for provider ToS |

You use **your** accounts. Each profile stays yours. Follow each provider’s terms ([OpenAI](https://openai.com/policies/), [xAI](https://x.ai/legal/), Anthropic, …) for multi-account and usage limits.

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

## Roadmap

- [x] Codex (OpenAI) profiles + usage + session resume repair  
- [x] Grok (xAI) profiles + usage + session resume repair  
- [ ] Claude Code (`claude`) profiles — same isolation model  
- [ ] More official AI CLIs as demand shows up  
- [ ] Provider-agnostic polish (TUI, status, docs)

Want a provider next? [Open an issue](https://github.com/tonamson/switch-acc-ai/issues).

---

## Links

- **GitHub:** [tonamson/switch-acc-ai](https://github.com/tonamson/switch-acc-ai)
- **npm:** [switch-acc-ai](https://www.npmjs.com/package/switch-acc-ai)
- **Issues:** [github.com/tonamson/switch-acc-ai/issues](https://github.com/tonamson/switch-acc-ai/issues)

---

## License

[MIT](LICENSE) © tonamson
