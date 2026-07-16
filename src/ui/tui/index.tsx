import React from 'react';
import { render } from 'ink';
import { App, type Action } from './App.js';
import type { AppConfig, ProviderId } from '../../core/config.js';

export { type Action };

function resetTerminal(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore — stream may already be closed
    }
  }
  // Drain any buffered key events from the TUI so the next interactive
  // child (e.g. `grok login`) does not see a leftover Enter and exit early.
  if (process.stdin.isTTY) {
    try {
      process.stdin.resume();
      let chunk: string | Buffer | null;
      while ((chunk = process.stdin.read()) !== null) {
        void chunk;
      }
      process.stdin.pause();
    } catch {
      // ignore
    }
  }
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[0m');
  }
}

export async function runInkApp(
  config: AppConfig,
  initialProvider?: ProviderId | null,
): Promise<Action> {
  let action: Action = 'exit';
  const instance = render(
    <App
      config={config}
      initialProvider={initialProvider ?? null}
      onAction={(nextAction) => {
        action = nextAction;
      }}
    />,
  );
  await instance.waitUntilExit();
  instance.clear();
  instance.cleanup();
  resetTerminal();
  // Give the terminal a moment to leave raw/alt-screen mode before the
  // caller spawns an interactive CLI (codex/grok login).
  await new Promise((resolve) => setTimeout(resolve, 50));
  return action;
}
