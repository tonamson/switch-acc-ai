import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeFakeGrok(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const fakePath = join(binDir, "grok");
  await writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "login" ]]; then
  printf '%s\\n' "\${GROK_HOME:-}" > "\${GROK_LOGIN_LOG:?}"
  printf '%s\\n' "$*" > "\${GROK_LOGIN_ARGS_LOG:-/dev/null}"
  mkdir -p "\${GROK_HOME:?}"
  cat > "\${GROK_HOME}/auth.json" <<EOF
{
  "https://auth.x.ai::test": {
    "key": "fake-token-$(basename "\${GROK_HOME}")",
    "email": "$(basename "\${GROK_HOME}")@example.com",
    "user_id": "user-$(basename "\${GROK_HOME}")",
    "team_id": "team-1",
    "auth_mode": "oidc",
    "expires_at": "2099-01-01T00:00:00.000Z",
    "first_name": "Test",
    "last_name": "User"
  }
}
EOF
  exit 0
fi

printf '%s\\n' "\${GROK_HOME:-}" > "\${GROK_ACCOUNT_LOG:?}"
printf '%s\\n' "$*" > "\${GROK_ARGS_LOG:?}"
`,
    { mode: 0o755 },
  );
  return fakePath;
}
