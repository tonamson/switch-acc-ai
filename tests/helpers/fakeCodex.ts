import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeFakeCodex(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const fakePath = join(binDir, "codex");
  await writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "app-server" && "\${2:-}" == "--stdio" ]]; then
  if [[ -n "\${CODEX_APP_SERVER_EXIT_LOG:-}" ]]; then
    trap 'printf "%s\\n" "sigterm" > "\${CODEX_APP_SERVER_EXIT_LOG}" ; exit 143' TERM
  fi
  while IFS= read -r line; do
    case "$line" in
      *'"id":1'*)
        printf '{"id":1,"result":{"codexHome":"%s"}}\\n' "\${CODEX_HOME:-}"
        ;;
      *'"account/read"'*)
        account="$(basename "\${CODEX_HOME:-unknown}")"
        printf '{"id":2,"result":{"account":{"email":"%s@example.com","planType":"plus"}}}\\n' "$account"
        ;;
      *'"account/rateLimits/read"'*)
        account="$(basename "\${CODEX_HOME:-unknown}")"
        case "$account" in
          acc1) primary=25; secondary=50 ;;
          acc2) primary=75; secondary=90 ;;
          keyed) primary=61; secondary=22 ;;
          legacy) primary=44; secondary=11 ;;
          *) primary=1; secondary=2 ;;
        esac
        case "$account" in
          keyed)
            printf '{"id":3,"result":{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":%s,"resetsAt":1893456000},"secondary":{"usedPercent":%s,"resetsAt":1893974400},"planType":"pro"}},"rateLimitResetCredits":{"availableCount":7}}}\\n' "$primary" "$secondary"
            ;;
          legacy)
            printf '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":%s,"resetsAt":1893456000},"secondary":{"usedPercent":%s,"resetsAt":1893974400},"planType":"plus","credits":{"balance":3}}}}\\n' "$primary" "$secondary"
            ;;
          *)
            printf '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":%s,"resetsAt":1893456000},"secondary":{"usedPercent":%s,"resetsAt":1893974400},"planType":"plus"},"rateLimitResetCredits":{"availableCount":1}}}\\n' "$primary" "$secondary"
            ;;
        esac
        ;;
    esac
  done
  if [[ -n "\${CODEX_APP_SERVER_EXIT_LOG:-}" ]]; then
    printf '%s\\n' "stdin-closed" > "\${CODEX_APP_SERVER_EXIT_LOG}"
  fi
  exit 0
fi

if [[ "\${1:-}" == "login" ]]; then
  printf '%s\\n' "\${CODEX_HOME:-}" > "\${CODEX_LOGIN_LOG:?}"
  exit 0
fi

printf '%s\\n' "\${CODEX_HOME:-}" > "\${CODEX_ACCOUNT_LOG:?}"
printf '%s\\n' "$*" > "\${CODEX_ARGS_LOG:?}"
`,
    { mode: 0o755 },
  );
  return fakePath;
}
