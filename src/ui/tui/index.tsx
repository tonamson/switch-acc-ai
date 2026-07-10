import React from 'react';
import { render } from 'ink';
import { App, type Action } from './App.js';
import type { AppConfig } from '../../core/config.js';

export { type Action };

export async function runInkApp(config: AppConfig): Promise<Action> {
  let action: Action = 'exit';
  const instance = render(<App config={config} onAction={(nextAction) => { action = nextAction; }} />);
  await instance.waitUntilExit();
  instance.cleanup();
  return action;
}
