#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("swa")
  .description("Codex account switcher")
  .helpOption("-h, --help", "show help");

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`swa: ${message}`);
  process.exitCode = 1;
});
