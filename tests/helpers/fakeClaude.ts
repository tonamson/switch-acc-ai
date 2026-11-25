import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeFakeClaude(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const fakePath = join(binDir, "claude");
  await writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "auth" && "\${2:-}" == "login" ]]; then
  name="$(basename "\${CLAUDE_CONFIG_DIR:?}")"
  printf '%s\\n' "\${CLAUDE_CONFIG_DIR}" > "\${CLAUDE_LOGIN_LOG:?}"
  mkdir -p "\${CLAUDE_CONFIG_DIR}"
  printf '{"oauthAccount":{"emailAddress":"%s@example.com"}}' "$name" > "\${CLAUDE_CONFIG_DIR}/.claude.json"
  printf '{"claudeAiOauth":{"accessToken":"fake-%s","expiresAt":4102444800000,"subscriptionType":"pro"}}' "$name" > "\${CLAUDE_CONFIG_DIR}/.credentials.json"
  exit 0
fi

printf '%s\\n' "\${CLAUDE_CONFIG_DIR:-}" > "\${CLAUDE_ACCOUNT_LOG:?}"
printf '%s\\n' "$*" > "\${CLAUDE_ARGS_LOG:?}"
`,
    { mode: 0o755 },
  );
  return fakePath;
}
