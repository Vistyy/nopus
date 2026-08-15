import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configuredNopusConfig,
  readNopusConfig,
} from "../../src/config/nopus-config.js";

function temporaryConfig(): string {
  return join(mkdtempSync(join(tmpdir(), "nopus-config-test-")), "config.json");
}

test("defaults complexity sensitivity to medium and evidence to on", () => {
  const path = temporaryConfig();
  assert.deepEqual(configuredNopusConfig({ NOPUS_CONFIG: path }), {
    complexitySensitivity: "medium",
    includeEvidence: true,
  });

  writeFileSync(path, `${JSON.stringify({ includeEvidence: false })}\n`);
  assert.deepEqual(readNopusConfig(path), {
    complexitySensitivity: "medium",
    includeEvidence: false,
  });
});

test("reads nopus configuration and defaults evidence to on", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({ complexitySensitivity: "medium" })}\n`);
  assert.deepEqual(readNopusConfig(path), {
    complexitySensitivity: "medium",
    includeEvidence: true,
  });
  assert.deepEqual(configuredNopusConfig({ NOPUS_CONFIG: path }), {
    complexitySensitivity: "medium",
    includeEvidence: true,
  });
});

test("native and explicit settings take precedence over the fallback file", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({ complexitySensitivity: "low", includeEvidence: true })}\n`);
  assert.deepEqual(configuredNopusConfig({
    NOPUS_CONFIG: path,
    CLAUDE_PLUGIN_OPTION_COMPLEXITYSENSITIVITY: "medium",
    CLAUDE_PLUGIN_OPTION_INCLUDEEVIDENCE: "false",
    NOPUS_COMPLEXITY_SENSITIVITY: "high",
  }), {
    complexitySensitivity: "high",
    includeEvidence: false,
  });
});

test("rejects invalid configuration values", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({ complexitySensitivity: "maximum" })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /must be low, medium, or high/);
  assert.match(readFileSync(path, "utf8"), /maximum/);

  writeFileSync(path, `${JSON.stringify({ includeEvidence: "sometimes" })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /must be true or false/);
});
