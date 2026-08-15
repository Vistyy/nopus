import assert from "node:assert/strict";
import test from "node:test";
import { measureProse, stripNonprose } from "../../src/analysis/measure-prose.js";
import { shouldRewrite } from "../../src/policy/decide-rewrite.js";

const concreteness = new Map<string, number>([
  ["approval", 2],
  ["authority", 2],
  ["condition", 2],
  ["decision", 2],
  ["evidence", 2],
  ["explicit", 2],
  ["require", 2],
]);

test("removes code, URLs, and table rows before prose analysis", () => {
  const prose = stripNonprose("Keep this.\n```ts\nconst hidden = true\n```\nhttps://example.com\n| hidden | row |");
  assert.match(prose, /Keep this/);
  assert.doesNotMatch(prose, /hidden|example/);
});

test("detects sustained abstract sentences with packaged POS and lemma data", () => {
  const text = [
    "Explicit approval requires authority evidence.",
    "Each decision requires explicit condition evidence.",
    "Authority approval requires explicit evidence.",
  ].join(" ");
  const metrics = measureProse(text, concreteness);
  assert.equal(metrics.eligibleSentenceCount, 3);
  assert.equal(metrics.highAbstractSentenceCount, 3);
  assert.equal(shouldRewrite(metrics, "medium"), true);
});

test("keeps hyphenated modifiers in noun stacks", () => {
  const metrics = measureProse(
    "The authoritative repository-aware launch retains late-activation recovery behavior.",
    new Map([
      ["authoritative", 2],
      ["repository", 2],
      ["aware", 2],
      ["launch", 2],
      ["late", 2],
      ["activation", 2],
      ["recovery", 2],
      ["behavior", 2],
    ]),
  );
  assert.deepEqual(metrics.stacks, [
    "authoritative repository aware launch",
    "late activation recovery behavior",
  ]);
});

test("low sensitivity accepts isolated metric accumulation below calibrated abstractness", () => {
  assert.equal(shouldRewrite({
    uncommonRatio: 0.355,
    veryUncommonRatio: 0.08,
    abstractRatio: 0.417,
    eligibleSentenceCount: 10,
    highAbstractSentenceCount: 3,
    highAbstractSentenceRatio: 0.3,
    maxSentenceAbstractRatio: 0.8,
    nounStackCount: 4,
    phraseLoadPer100Words: 4.89,
    styleCueCount: 0,
    lexicalWordCount: 92,
  }), false);
});
