import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * agy has no CLI-visible auth file — it resolves `$HOME/.gemini/antigravity-cli`
 * and stores tokens in the OS keyring. The fake just proves sacc spawned it with
 * the expected HOME and args, and drops a settings.json so readAccountLabel has
 * something to detect as "initialized".
 */
export async function writeFakeAntigravity(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const fakePath = join(binDir, "agy");
  await writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "\${HOME:-}" > "\${ANTIGRAVITY_HOME_LOG:?}"
printf '%s\\n' "$*" > "\${ANTIGRAVITY_ARGS_LOG:?}"
mkdir -p "\${HOME:?}/.gemini/antigravity-cli"
printf '{}' > "\${HOME}/.gemini/antigravity-cli/settings.json"
`,
    { mode: 0o755 },
  );
  return fakePath;
}
