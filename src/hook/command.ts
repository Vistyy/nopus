#!/usr/bin/env node
import { configuredNopusConfig } from "../config/nopus-config.js";
import { handleStop, type StopHookInput } from "./handle-stop.js";

let source = "";
for await (const chunk of process.stdin) source += chunk;

try {
  const input = JSON.parse(source) as StopHookInput;
  const config = configuredNopusConfig();
  const output = handleStop(input, config.complexitySensitivity, config.includeEvidence, config.extraSimple);
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  process.stderr.write(`nopus Stop hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
