import assert from "node:assert/strict";
import test from "node:test";
import { shouldRewrite } from "../../src/policy/decide-rewrite.js";

const borderline = {
  uncommonRatio: 0.16,
  veryUncommonRatio: 0.06,
  abstractRatio: 0.4,
  eligibleSentenceCount: 3,
  highAbstractSentenceCount: 2,
  highAbstractSentenceRatio: 2 / 3,
  maxSentenceAbstractRatio: 0.7,
  nounStackCount: 0,
  phraseLoadPer100Words: 2,
  styleCueCount: 0,
  lexicalWordCount: 20,
};

test("sensitivity profiles increase monotonically", () => {
  assert.equal(shouldRewrite(borderline, "low"), false);
  assert.equal(shouldRewrite(borderline, "medium"), true);
  assert.equal(shouldRewrite(borderline, "high"), true);
});

test("rarity-dependent routes require broad-web evidence", () => {
  const metrics = {
    ...borderline,
    uncommonRatio: 0.32,
    veryUncommonRatio: 0.04,
    abstractRatio: 0.46,
    highAbstractSentenceCount: 3,
    highAbstractSentenceRatio: 0.3,
    maxSentenceAbstractRatio: 0.8,
    nounStackCount: 4,
    phraseLoadPer100Words: 4.5,
  };
  assert.equal(shouldRewrite(metrics, "low"), false);
  assert.equal(shouldRewrite({ ...metrics, veryUncommonRatio: 0.06 }, "low"), true);
});

test("medium combined complexity accepts four percent very uncommon wording with supporting evidence", () => {
  const metrics = {
    ...borderline,
    uncommonRatio: 0.2,
    veryUncommonRatio: 0.04,
    abstractRatio: 0.45,
    nounStackCount: 2,
    phraseLoadPer100Words: 2,
  };
  assert.equal(shouldRewrite(metrics, "low"), false);
  assert.equal(shouldRewrite(metrics, "medium"), true);
  assert.equal(shouldRewrite(metrics, "high"), true);
});

test("sustained abstractness requires profile-appropriate loaded phrasing", () => {
  const unloaded = { ...borderline, phraseLoadPer100Words: 0 };
  assert.equal(shouldRewrite(unloaded, "high"), false);
  const highOnly = { ...unloaded, phraseLoadPer100Words: 1 };
  assert.equal(shouldRewrite(highOnly, "medium"), false);
  assert.equal(shouldRewrite(highOnly, "high"), true);
  assert.equal(shouldRewrite({ ...unloaded, phraseLoadPer100Words: 2 }, "medium"), true);
});

test("concentrated evidence requires response-level abstractness", () => {
  const concentrated = {
    ...borderline,
    uncommonRatio: 0.32,
    abstractRatio: 0.35,
    eligibleSentenceCount: 20,
    highAbstractSentenceCount: 5,
    highAbstractSentenceRatio: 0.25,
    maxSentenceAbstractRatio: 0.8,
    nounStackCount: 0,
    phraseLoadPer100Words: 4.8,
  };
  assert.equal(shouldRewrite(concentrated, "low"), false);
  assert.equal(shouldRewrite({ ...concentrated, abstractRatio: 0.46 }, "low"), true);
});

test("pervasive lexical and abstract complexity does not require noun stacks", () => {
  const metrics = {
    ...borderline,
    uncommonRatio: 0.6,
    veryUncommonRatio: 0.23,
    abstractRatio: 0.61,
    eligibleSentenceCount: 3,
    highAbstractSentenceCount: 2,
    highAbstractSentenceRatio: 2 / 3,
    maxSentenceAbstractRatio: 2 / 3,
    nounStackCount: 0,
    phraseLoadPer100Words: 0,
    lexicalWordCount: 35,
  };
  assert.equal(shouldRewrite(metrics, "low"), true);
});

test("two distinct style cues are sufficient at every sensitivity", () => {
  const metrics = {
    ...borderline,
    eligibleSentenceCount: 1,
    highAbstractSentenceCount: 0,
    highAbstractSentenceRatio: 0,
    maxSentenceAbstractRatio: 0.4,
    styleCueCount: 2,
  };
  assert.equal(shouldRewrite(metrics, "low"), true);
  assert.equal(shouldRewrite(metrics, "medium"), true);
  assert.equal(shouldRewrite(metrics, "high"), true);
});

test("one style cue needs supporting rarity evidence", () => {
  const metrics = {
    ...borderline,
    uncommonRatio: 0.31,
    eligibleSentenceCount: 1,
    highAbstractSentenceCount: 0,
    highAbstractSentenceRatio: 0,
    maxSentenceAbstractRatio: 0,
    styleCueCount: 1,
  };
  assert.equal(shouldRewrite(metrics, "low"), true);
  assert.equal(shouldRewrite({ ...metrics, uncommonRatio: 0 }, "low"), false);
});

test("low sensitivity requires loaded phrasing with sustained abstractness", () => {
  const metrics = {
    ...borderline,
    eligibleSentenceCount: 6,
    highAbstractSentenceCount: 3,
    highAbstractSentenceRatio: 0.5,
    maxSentenceAbstractRatio: 0.8,
    phraseLoadPer100Words: 2,
  };
  assert.equal(shouldRewrite(metrics, "low"), false);
  assert.equal(shouldRewrite({ ...metrics, phraseLoadPer100Words: 3 }, "low"), true);
});
