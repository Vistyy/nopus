import assert from "node:assert/strict";
import test from "node:test";
import { matchStyleCues } from "../../src/data/style-cues.js";

test("matches context-free literal style cues", () => {
  const matches = matchStyleCues(
    "Here's where it gets interesting. This is a paradigm shift.",
  );
  assert.deepEqual(matches.map(({ cue }) => cue), [
    "here's where it gets interesting",
    "paradigm shift",
  ]);
});

test("does not treat context-sensitive source entries as literal cues", () => {
  assert.deepEqual(matchStyleCues("The shape names the stored record."), []);
  assert.deepEqual(matchStyleCues("Is this the right time to delete the record? Most people use the cache."), []);
});
