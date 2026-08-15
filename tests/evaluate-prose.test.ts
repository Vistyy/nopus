import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProse } from "../src/evaluate-prose.js";

test("evaluates prose with packaged frequency, concreteness, and technical-term data", () => {
  const result = evaluateProse(
    "The persistence adapter validates the repository schema before publication.",
  );
  assert.equal(result.retry, false);
  assert.ok(result.metrics.technicalDownweightedRatio > 0);
  assert.ok(result.metrics.uncommonRatio < result.metrics.rawConversationallyRareRatio);
});

test("one style cue can combine with uncommon wording", () => {
  const result = evaluateProse(
    "Double-click on the load-bearing model to inspect the calculation.",
  );
  assert.equal(result.metrics.styleCueCount, 1);
  assert.ok(result.metrics.uncommonRatio >= 0.3);
  assert.equal(result.retry, true);
});

test("two distinct style cues cause a low-sensitivity rewrite", () => {
  const result = evaluateProse(
    "Here's where it gets interesting. This paradigm shift changes the execution boundary.",
  );
  assert.equal(result.metrics.styleCueCount, 2);
  assert.equal(result.retry, true);
});

test("does not rewrite context-dependent source phrases as literal style cues", () => {
  const result = evaluateProse(
    "Is this the right time to delete the record? Most people use the cache after a timeout. Most people use the cache after a timeout.",
    { complexitySensitivity: "high" },
  );
  assert.equal(result.metrics.styleCueCount, 0);
  assert.equal(result.retry, false);
});

test("counts distinct style cues rather than repeated occurrences", () => {
  const result = evaluateProse(
    "At the end of the day, use the cache. At the end of the day, use the cache.",
    { complexitySensitivity: "high" },
  );
  assert.equal(result.metrics.styleCueCount, 1);
  assert.equal(result.retry, false);
});

test("rewrites pervasive complexity in one ornate sentence", () => {
  const result = evaluateProse(
    "Certainly; insofar as your request seeks the production of a response whose rhetorical, syntactic, and conceptual architecture exceeds by a conspicuously unnecessary margin the relatively modest informational requirements ordinarily associated with acknowledgment, I can confirm, without introducing paragraph breaks that might compromise the singular structural constraint you have imposed, that I possess both the capacity and the immediate willingness to furnish precisely such an extravagantly elaborated, circuitously articulated, and magnificently overengineered answer.",
  );
  assert.equal(result.retry, true);
  assert.ok(result.signals.includes("pervasive-complexity"));
});

test("rewrites pervasive complexity across several sentences", () => {
  const result = evaluateProse(
    "Certainly. The requested transformation can be understood as a deliberate migration from direct expression toward an elevated domain of conceptual indeterminacy. Within this discursive framework, meaning emerges through layered abstractions, recursive qualifications, and syntactically elaborate formulations. The resulting communication therefore becomes less an ordinary answer than a ceremonially overconstructed manifestation of semantic possibility.",
  );
  assert.equal(result.retry, true);
  assert.ok(result.signals.includes("pervasive-complexity"));
});

test("rewrites ornate prose when no single metric reaches an extreme", () => {
  const result = evaluateProse(
    "The chromatic identity of the interface's primary interaction mechanism has undergone a narrowly bounded yet conceptually resonant transition from blue to green, thereby reconfiguring its visual presence without disturbing its functional ontology. This modest alteration operates exclusively within the presentational stratum, leaving behavioral logic, structural relationships, and event-driven consequences entirely untouched. In practical terms, the button still performs precisely the same action as before, but now communicates its unchanged purpose through a differently calibrated wavelength of visible light.",
  );
  assert.equal(result.retry, true);
  assert.ok(result.signals.includes("pervasive-complexity"));
});

test("accepts a mildly wordy response that remains concrete", () => {
  const result = evaluateProse(
    "Certainly. I can split the response into multiple sentences while keeping it needlessly complex. The result will remain one paragraph, preserving your original structural constraint while introducing several distinct sentence boundaries.",
  );
  assert.equal(result.retry, false);
});

test("returns evidence when sustained abstract prose needs a rewrite", () => {
  const result = evaluateProse([
    "Explicit approval requires authority evidence.",
    "Each decision requires explicit condition evidence.",
    "Authority approval requires explicit evidence.",
    "Explicit authority requires approval evidence.",
  ].join(" "));
  assert.equal(result.retry, true);
  assert.equal(result.metrics.highAbstractSentenceCount, 4);
  assert.ok(result.findings.some(({ kind }) => kind === "high-abstractness-sentence"));
});
