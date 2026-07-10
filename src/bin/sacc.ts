#!/usr/bin/env node

import { runProgram } from "../cli/commands.js";

runProgram().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
