import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const command = resolve("plugin/dist/stop-hook.mjs");
const difficult = [
  "Explicit approval requires authority evidence.",
  "Each decision requires explicit condition evidence.",
  "Authority approval requires explicit evidence.",
  "Explicit authority requires approval evidence.",
].join(" ");

function runHook(input: unknown, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [command], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      NOPUS_CONFIG: join(tmpdir(), `nopus-missing-${process.pid}.json`),
      NOPUS_COMPLEXITY_SENSITIVITY: undefined,
      NOPUS_INCLUDE_EVIDENCE: undefined,
      CLAUDE_PLUGIN_OPTION_COMPLEXITYSENSITIVITY: undefined,
      CLAUDE_PLUGIN_OPTION_INCLUDEEVIDENCE: undefined,
      ...environment,
    },
  });
}

test("the bundled Stop command evaluates a normal host request", () => {
  const result = runHook({
    hook_event_name: "Stop",
    last_assistant_message: difficult,
    stop_hook_active: false,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision?: unknown; reason?: unknown; systemMessage?: unknown };
  assert.equal(output.decision, "block");
  assert.equal(output.systemMessage, "nopus requested a clearer rewrite.");
  assert.match(String(output.reason), /Rewrite the response for clarity and directness/);
});

test("the bundled command applies configured complexity sensitivity", () => {
  const result = runHook({
    hook_event_name: "Stop",
    last_assistant_message: "Here's where it gets interesting. This paradigm shift changes the execution boundary.",
  }, { NOPUS_COMPLEXITY_SENSITIVITY: "high" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision?: unknown };
  assert.equal(output.decision, "block");
});

test("the bundled command reads persistent nopus configuration", () => {
  const path = join(mkdtempSync(join(tmpdir(), "nopus-hook-config-")), "config.json");
  writeFileSync(path, `${JSON.stringify({ complexitySensitivity: "high" })}\n`);
  const result = runHook({
    hook_event_name: "Stop",
    last_assistant_message: "Here's where it gets interesting. This paradigm shift changes the execution boundary.",
  }, { NOPUS_CONFIG: path });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision?: unknown };
  assert.equal(output.decision, "block");
});

test("the bundled command reads Claude's native plugin option", () => {
  const result = runHook({
    hook_event_name: "Stop",
    last_assistant_message: "Here's where it gets interesting. This paradigm shift changes the execution boundary.",
  }, { CLAUDE_PLUGIN_OPTION_COMPLEXITYSENSITIVITY: "high" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as { decision?: unknown };
  assert.equal(output.decision, "block");
});

test("the bundled command rejects invalid complexity sensitivity", () => {
  const result = runHook({
    hook_event_name: "Stop",
    last_assistant_message: "A direct response.",
  }, { NOPUS_COMPLEXITY_SENSITIVITY: "maximum" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be low, medium, or high/);
  assert.equal(result.stdout, "");
});
