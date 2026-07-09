#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export CODEX_ACCOUNTS_DIR="$TMP_DIR/accounts"
mkdir -p "$CODEX_ACCOUNTS_DIR/acc1" "$CODEX_ACCOUNTS_DIR/acc2" "$TMP_DIR/bin"
printf 'acc1\n' > "$CODEX_ACCOUNTS_DIR/.current"

cat > "$TMP_DIR/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "app-server" || "${2:-}" != "--stdio" ]]; then
  echo "unexpected codex args: $*" >&2
  exit 1
fi

while IFS= read -r line; do
  case "$line" in
    *'"id":1'*)
      printf '{"id":1,"result":{"codexHome":"%s"}}\n' "${CODEX_HOME:-}"
      ;;
    *'"account/read"'*)
      account="$(basename "${CODEX_HOME:-unknown}")"
      printf '{"id":2,"result":{"account":{"type":"chatgpt","email":"%s@example.com","planType":"plus"},"requiresOpenaiAuth":true}}\n' "$account"
      ;;
    *'"account/rateLimits/read"'*)
      account="$(basename "${CODEX_HOME:-unknown}")"
      case "$account" in
        acc1)
          primary_used=25
          secondary_used=50
          ;;
        acc2)
          primary_used=75
          secondary_used=90
          ;;
        *)
          primary_used=1
          secondary_used=2
          ;;
      esac
      printf '{"id":3,"result":{"rateLimits":{"limitId":"codex","primary":{"usedPercent":%s,"windowDurationMins":300,"resetsAt":1893456000},"secondary":{"usedPercent":%s,"windowDurationMins":10080,"resetsAt":1893974400},"planType":"plus","credits":{"hasCredits":false,"unlimited":false,"balance":"0"}},"rateLimitResetCredits":{"availableCount":1}}}\n' "$primary_used" "$secondary_used"
      ;;
  esac
done
FAKE_CODEX
chmod +x "$TMP_DIR/bin/codex"
export PATH="$TMP_DIR/bin:$PATH"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'expected output to contain: %s\noutput:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

output="$("$REPO_ROOT/cx" status)"
assert_contains "$output" "acc1"
assert_contains "$output" "user          acc1@example.com"
assert_contains "$output" "5h limit      25% used"
assert_contains "$output" "weekly limit  50% used"
assert_contains "$output" "reset credits 1"

output="$("$REPO_ROOT/cx" status acc2)"
assert_contains "$output" "acc2"
assert_contains "$output" "user          acc2@example.com"
assert_contains "$output" "5h limit      75% used"
assert_contains "$output" "weekly limit  90% used"

output="$("$REPO_ROOT/cx" status --all)"
assert_contains "$output" "acc1"
assert_contains "$output" "acc2"
assert_contains "$output" "5h limit      25% used"
assert_contains "$output" "5h limit      75% used"

output="$("$REPO_ROOT/cx" list)"
assert_contains "$output" "acc1"
assert_contains "$output" "acc1@example.com"
assert_contains "$output" "acc2"
assert_contains "$output" "acc2@example.com"
