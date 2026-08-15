#!/usr/bin/env node
import { updateNopusConfig } from "./update-nopus-config.js";

try {
  const result = updateNopusConfig(process.argv.slice(2));
  process.stdout.write(`${result.confirmation}\nConfiguration: ${result.path}\n`);
} catch (error) {
  process.stderr.write(`nopus configuration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
