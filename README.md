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

[GitHub](https://github.com/tonamson/switch-acc-ai) · [npm](https://www.npmjs.com/package/switch-acc-ai)

Switch between multiple AI CLI accounts on one machine — without mixing sessions or auth.

Supports **Codex** (OpenAI) and **Grok** (xAI). Each account is an isolated profile; shared skills, plugins, and config stay linked across accounts.

---

## Install

```bash
npm install -g switch-acc-ai
```

Node.js ≥ 20. Install the provider CLIs (`codex`, `grok`) separately.

---

## Quick start

```bash
sacc
```

Opens the TUI: pick a provider, manage accounts, and run the CLI from there.

---

## How it works

`sacc` does not replace auth. It isolates each account and launches the official CLI with a dedicated home:

| | Codex | Grok |
|---|-------|------|
| Profiles | `~/.codex-accounts/<name>` | `~/.grok-accounts/<name>` |
| Shared home | `~/.codex` | `~/.grok` |
| Env | `CODEX_HOME` | `GROK_HOME` |

---

## License

MIT
