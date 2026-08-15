import assert from "node:assert/strict";
import test from "node:test";
import { matchedTechnicalWordIndexes } from "../../src/data/technical-terms.js";

test("matches packaged single-word and multiword technical terms", () => {
  const tokens = ["The", "abstract", "syntax", "tree", "uses", "an", "algorithm"];
  assert.deepEqual([...matchedTechnicalWordIndexes(tokens)], [1, 2, 3, 6]);
});

test("does not downweight partial technical terms", () => {
  assert.deepEqual([...matchedTechnicalWordIndexes(["state", "discussion"])], []);
});
