import React from 'react';
import { render } from 'ink';
import { App, type Action } from './App.js';
import type { AppConfig } from '../../core/config.js';

export { type Action };

function resetTerminal(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false);
  }
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[0m');
  }
}

export async function runInkApp(config: AppConfig): Promise<Action> {
  let action: Action = 'exit';
  const instance = render(<App config={config} onAction={(nextAction) => { action = nextAction; }} />);
  await instance.waitUntilExit();
  instance.clear();
  instance.cleanup();
  resetTerminal();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return action;
}
