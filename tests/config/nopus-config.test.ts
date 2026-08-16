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

const defaultPiConfig = { hideOriginalResponse: true };

test("uses the default configuration when no file exists", () => {
  const path = temporaryConfig();
  assert.deepEqual(configuredNopusConfig({ NOPUS_CONFIG: path }), {
    complexitySensitivity: "medium",
    includeEvidence: true,
    pi: defaultPiConfig,
  });

  writeFileSync(path, `${JSON.stringify({ includeEvidence: false })}\n`);
  assert.deepEqual(readNopusConfig(path), {
    complexitySensitivity: "medium",
    includeEvidence: false,
    pi: defaultPiConfig,
  });
});

test("reads Pi response hiding and defaults omitted settings", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({
    complexitySensitivity: "medium",
    pi: { hideOriginalResponse: false },
  })}\n`);
  assert.deepEqual(readNopusConfig(path), {
    complexitySensitivity: "medium",
    includeEvidence: true,
    pi: { hideOriginalResponse: false },
  });
  assert.deepEqual(configuredNopusConfig({ NOPUS_CONFIG: path }), {
    complexitySensitivity: "medium",
    includeEvidence: true,
    pi: { hideOriginalResponse: false },
  });
});

test("environment settings take precedence over the configuration file", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({
    complexitySensitivity: "low",
    includeEvidence: true,
    pi: { hideOriginalResponse: true },
  })}\n`);
  assert.deepEqual(configuredNopusConfig({
    NOPUS_CONFIG: path,
    NOPUS_COMPLEXITY_SENSITIVITY: "high",
    NOPUS_INCLUDE_EVIDENCE: "false",
    NOPUS_PI_HIDE_ORIGINAL_RESPONSE: "off",
  }), {
    complexitySensitivity: "high",
    includeEvidence: false,
    pi: { hideOriginalResponse: false },
  });
});

test("rejects invalid configuration values", () => {
  const path = temporaryConfig();
  writeFileSync(path, `${JSON.stringify({ complexitySensitivity: "maximum" })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /must be low, medium, or high/);
  assert.match(readFileSync(path, "utf8"), /maximum/);

  writeFileSync(path, `${JSON.stringify({ includeEvidence: "sometimes" })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /must be true or false/);

  writeFileSync(path, `${JSON.stringify({ pi: "sometimes" })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /pi must be a JSON object/);

  writeFileSync(path, `${JSON.stringify({ pi: { hideOriginalResponse: "sometimes" } })}\n`);
  assert.throws(() => configuredNopusConfig({ NOPUS_CONFIG: path }), /pi\.hideOriginalResponse must be true or false/);
});
