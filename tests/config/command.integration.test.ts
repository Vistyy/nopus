import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const command = resolve("plugin/dist/configure.mjs");

test("the bundled configuration command writes persistent user configuration", () => {
  const path = join(mkdtempSync(join(tmpdir(), "nopus-config-command-")), "nopus", "config.json");
  const result = spawnSync(process.execPath, [command, "medium"], {
    encoding: "utf8",
    env: { ...process.env, NOPUS_CONFIG: path },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    complexitySensitivity: "medium",
    includeEvidence: true,
  });
  assert.match(result.stdout, /complexity sensitivity is medium/);

  const evidence = spawnSync(process.execPath, [command, "evidence", "off"], {
    encoding: "utf8",
    env: { ...process.env, NOPUS_CONFIG: path },
  });
  assert.equal(evidence.status, 0, evidence.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    complexitySensitivity: "medium",
    includeEvidence: false,
  });
  assert.match(evidence.stdout, /rewrite evidence is off/);
});

test("the bundled configuration command rejects unknown levels", () => {
  const result = spawnSync(process.execPath, [command, "maximum"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be low, medium, or high/);
});
