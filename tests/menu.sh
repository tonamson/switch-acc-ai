#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export CODEX_ACCOUNTS_DIR="$TMP_DIR/accounts"
mkdir -p "$CODEX_ACCOUNTS_DIR/acc1" "$CODEX_ACCOUNTS_DIR/acc2" "$TMP_DIR/bin"

cat > "$TMP_DIR/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "app-server" && "${2:-}" == "--stdio" ]]; then
  while IFS= read -r line; do
    case "$line" in
      *'"id":1'*)
        printf '{"id":1,"result":{"codexHome":"%s"}}\n' "${CODEX_HOME:-}"
        ;;
      *'"account/read"'*)
        account="$(basename "${CODEX_HOME:-unknown}")"
        printf '{"id":2,"result":{"account":{"type":"chatgpt","email":"%s@example.com","planType":"plus"},"requiresOpenaiAuth":true}}\n' "$account"
        ;;
    esac
  done
  exit 0
fi

printf '%s\n' "${CODEX_HOME:-}" > "$CODEX_ACCOUNT_LOG"
printf '%s\n' "$*" > "$CODEX_ARGS_LOG"
FAKE_CODEX
chmod +x "$TMP_DIR/bin/codex"
export PATH="$TMP_DIR/bin:$PATH"
export CODEX_ACCOUNT_LOG="$TMP_DIR/account.log"
export CODEX_ARGS_LOG="$TMP_DIR/args.log"

run_menu_case() {
  local keys="$1"
  rm -f "$CODEX_ACCOUNT_LOG" "$CODEX_ARGS_LOG"
  CX_TEST_KEYS="$keys" "$REPO_ROOT/cx" --model test-model >/dev/null 2>/dev/null

  selected="$(cat "$CODEX_ACCOUNT_LOG")"
  args="$(cat "$CODEX_ARGS_LOG")"

  if [[ "$selected" != "$CODEX_ACCOUNTS_DIR/acc2" ]]; then
    printf 'expected acc2 to be selected, got: %s\n' "$selected" >&2
    exit 1
  fi

  if [[ "$args" != "--model test-model" ]]; then
    printf 'expected codex args to be forwarded, got: %s\n' "$args" >&2
    exit 1
  fi
}

run_menu_case $'\n\n\e[B\n'
run_menu_case $'\n\n\eOB\n'
