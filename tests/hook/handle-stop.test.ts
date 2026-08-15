import assert from "node:assert/strict";
import test from "node:test";
import { handleStop } from "../../src/hook/handle-stop.js";

const difficult = [
  "Explicit approval requires authority evidence.",
  "Each decision requires explicit condition evidence.",
  "Authority approval requires explicit evidence.",
  "Explicit authority requires approval evidence.",
].join(" ");

test("requests a rewrite with signal-derived guidance when the evaluation fails", () => {
  const output = handleStop({
    hook_event_name: "Stop",
    last_assistant_message: difficult,
  });
  assert.equal(output.decision, "block");
  if (output.decision === "block") {
    assert.match(output.reason, /Keep its meaning and necessary detail/);
    assert.match(output.reason, /Use more concrete, direct phrasing/);
    assert.match(output.reason, /Examples from the response/);
    assert.match(output.reason, /Explicit approval/);
    assert.doesNotMatch(output.reason, /%|high-abstractness-sentence/);
  }
});

test("translates style signals into positive rewrite guidance", () => {
  const output = handleStop({
    hook_event_name: "Stop",
    last_assistant_message: "Here's where it gets interesting. This paradigm shift changes the execution boundary.",
  }, "medium");
  assert.equal(output.decision, "block");
  if (output.decision === "block") {
    assert.match(output.reason, /Replace formulaic framing with plain statements/);
    assert.match(output.reason, /paradigm shift.*tired/i);
    assert.doesNotMatch(output.reason, /%/);
  }
});

test("can omit response evidence while retaining rewrite guidance", () => {
  const output = handleStop({
    hook_event_name: "Stop",
    last_assistant_message: difficult,
  }, "low", false);
  assert.equal(output.decision, "block");
  if (output.decision === "block") {
    assert.match(output.reason, /Use more concrete, direct phrasing/);
    assert.doesNotMatch(output.reason, /Examples from the response|Explicit approval/);
  }
});

test("accepts a direct response", () => {
  assert.deepEqual(handleStop({
    hook_event_name: "Stop",
    last_assistant_message: "Use the existing cache. Delete the temporary file afterward.",
  }), {});
});

test("does not recursively request another rewrite", () => {
  assert.deepEqual(handleStop({
    hook_event_name: "Stop",
    last_assistant_message: difficult,
    stop_hook_active: true,
  }), {});
});
