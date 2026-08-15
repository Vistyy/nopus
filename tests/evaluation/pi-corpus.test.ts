import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assistantText, extractCorpus, importLabels, importMediumAnchorLabels, normalizeResponseText, sampleCorpus } from "../../evaluation/src/pi-corpus.js";
import { expectedRewrite, type CandidateBaseline, type DecisionBand, type HumanLabel, type LengthBand, type PrivateCandidate } from "../../evaluation/src/pi-corpus-schema.js";
import { measureProse } from "../../src/analysis/measure-prose.js";

const assistant = (text: string, overrides: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  provider: "openai",
  model: "gpt-test",
  stopReason: "stop",
  ...overrides,
});

const entry = (id: string, parentId: string | null, message: unknown) => ({
  type: "message", id, parentId, timestamp: "2026-08-14T00:00:00.000Z", message,
});

test("assistantText accepts only completed text responses without tool calls", () => {
  assert.equal(assistantText(assistant("  clear\r\ntext  ")), "clear\ntext");
  assert.equal(assistantText(assistant("working", { stopReason: "toolUse" })), undefined);
  assert.equal(assistantText(assistant("ignored", { content: [{ type: "toolCall", id: "1" }] })), undefined);
  assert.equal(assistantText({ role: "user", content: [{ type: "text", text: "private input" }] }), undefined);
  assert.equal(normalizeResponseText(" e\u0301\rvalue "), "é\nvalue");
});

test("ordinal labels imply monotonic profile expectations", () => {
  const label: HumanLabel = {
    schemaVersion: 1, sampleId: "sample", candidateId: "x", status: "certain",
    firstRewriteProfile: "medium", rubricVersion: 1,
  };
  assert.equal(expectedRewrite(label, "low"), false);
  assert.equal(expectedRewrite(label, "medium"), true);
  assert.equal(expectedRewrite(label, "high"), true);
  assert.equal(expectedRewrite({ ...label, status: "uncertain", firstRewriteProfile: null }, "high"), undefined);
});

test("sample and label lifecycle preserves source caps and sample identity", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "nopus-sample-"));
  const root = join(temporary, "private");
  await mkdir(root);
  const quotas: Record<DecisionBand, Partial<Record<LengthBand, number>>> = {
    AAA: { "1-9": 4, "10-29": 8, "30-99": 14, "100-299": 9, "300+": 5 },
    AAR: { "30-99": 8, "100-299": 18, "300+": 14 },
    ARR: { "30-99": 8, "100-299": 18, "300+": 14 },
    RRR: { "30-99": 8, "100-299": 22, "300+": 10 },
  };
  const candidates: PrivateCandidate[] = [];
  const baselines: CandidateBaseline[] = [];
  const metrics = measureProse("Use the cache for repeated reads.");
  let serial = 0;
  for (const [band, lengths] of Object.entries(quotas) as Array<[DecisionBand, Partial<Record<LengthBand, number>>]>) {
    for (const [length, quota] of Object.entries(lengths) as Array<[LengthBand, number]>) {
      for (let index = 0; index < quota + 10; index += 1) {
        const candidateId = `candidate-${String(serial++).padStart(4, "0")}`;
        candidates.push({
          schemaVersion: 1, candidateId, duplicateGroupId: `duplicate-${candidateId}`,
          sourceSessionId: index < 10 ? "shared-session" : `source-${candidateId}`,
          sourceRecordId: `record-${candidateId}`, provider: "test", model: "test", text: `Response ${candidateId}.`,
        });
        const rewrites = band.split("").map((value) => value === "R");
        baselines.push({
          schemaVersion: 1, candidateId, whitespaceWordCount: 50, lengthBand: length, decisionBand: band,
          metrics,
          decisions: {
            low: { rewrite: rewrites[0]!, signals: [] },
            medium: { rewrite: rewrites[1]!, signals: [] },
            high: { rewrite: rewrites[2]!, signals: [] },
          },
        });
      }
    }
  }
  await writeFile(join(root, "candidates.jsonl"), candidates.map((value) => JSON.stringify(value)).join("\n") + "\n");
  await writeFile(join(root, "baseline.jsonl"), baselines.map((value) => JSON.stringify(value)).join("\n") + "\n");
  const sample = await sampleCorpus(root, "test-seed", true);
  assert.equal(sample.selected.length, 160);
  assert.equal(sample.calibrationIds.length, 120);
  assert.equal(sample.holdoutIds.length, 40);
  assert.ok(sample.sampleId);
  const sources = new Map(candidates.map((value) => [value.candidateId, value.sourceSessionId]));
  const uses = new Map<string, number>();
  for (const value of sample.selected) {
    const source = sources.get(value.candidateId)!;
    uses.set(source, (uses.get(source) ?? 0) + 1);
  }
  assert.ok(Math.max(...uses.values()) <= 2);

  const wrongPath = join(temporary, "wrong-label.jsonl");
  await writeFile(wrongPath, `${JSON.stringify({ schemaVersion: 1, sampleId: "wrong", candidateId: sample.calibrationIds[0], status: "certain", firstRewriteProfile: "none", rubricVersion: 1 })}\n`);
  await assert.rejects(importLabels(root, wrongPath), /different sample/);

  const anchorPath = join(temporary, "medium-anchor-label.jsonl");
  await writeFile(anchorPath, `${JSON.stringify({ schemaVersion: 1, sampleId: sample.sampleId, candidateId: sample.calibrationIds[0], profile: "medium", decision: "accept", rubricVersion: 1 })}\n`);
  assert.deepEqual(await importMediumAnchorLabels(root, anchorPath), { labels: 1 });
  const anchorsPath = join(root, "medium-anchor-labels.jsonl");
  await writeFile(anchorsPath, `${JSON.stringify({ schemaVersion: 1, sampleId: "stale", candidateId: sample.calibrationIds[0], profile: "medium", decision: "accept", rubricVersion: 1 })}\n`);
  await assert.rejects(importMediumAnchorLabels(root, anchorPath), /private medium-anchor labels belong to a different/);
  await writeFile(anchorsPath, await readFile(anchorPath, "utf8"));
  await assert.rejects(sampleCorpus(root, "another-seed", true), /after labels exist/);

  const labelPath = join(temporary, "label.jsonl");
  await writeFile(labelPath, `${JSON.stringify({ schemaVersion: 1, sampleId: sample.sampleId, candidateId: sample.calibrationIds[0], status: "certain", firstRewriteProfile: "none", rubricVersion: 1 })}\n`);
  assert.deepEqual(await importLabels(root, labelPath), { labels: 1 });
  const labelsPath = join(root, "labels.jsonl");
  await writeFile(labelsPath, `${JSON.stringify({ schemaVersion: 1, sampleId: "stale", candidateId: sample.calibrationIds[0], status: "certain", firstRewriteProfile: "none", rubricVersion: 1 })}\n`);
  await assert.rejects(importLabels(root, labelPath), /private labels belong to a different/);
  await writeFile(labelsPath, await readFile(labelPath, "utf8"));
  await assert.rejects(sampleCorpus(root, "another-seed", true), /after labels exist/);
});

test("extractCorpus excludes user input, incomplete responses, Nopus rewrites, mocks, and duplicates", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "nopus-corpus-"));
  const sessions = join(temporary, "sessions");
  const root = join(temporary, "private");
  await mkdir(sessions);
  const records = [
    { type: "session", version: 3, id: "session", timestamp: "2026-08-14T00:00:00.000Z", cwd: "/private" },
    entry("user", null, { role: "user", content: [{ type: "text", text: "do not collect me" }] }),
    entry("good", "user", assistant("Completed response.")),
    entry("duplicate", "good", assistant("Completed response.")),
    entry("incomplete", "duplicate", assistant("Partial", { stopReason: "aborted" })),
    { type: "custom_message", id: "rewrite", parentId: "incomplete", timestamp: "2026-08-14T00:00:01.000Z", customType: "nopus-rewrite", content: "rewrite", display: false },
    entry("rewrite-tool-call", "rewrite", assistant("", { stopReason: "toolUse", content: [{ type: "toolCall", id: "call" }] })),
    entry("rewrite-tool-result", "rewrite-tool-call", { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "result" }] }),
    entry("rewritten", "rewrite-tool-result", assistant("Generated rewrite.")),
    entry("next-user", "rewritten", { role: "user", content: [{ type: "text", text: "new request" }] }),
    entry("mock", "next-user", assistant("Mock response.", { provider: "mock" })),
    entry("second", "mock", assistant("Another completed response.")),
  ];
  await writeFile(join(sessions, "session.jsonl"), records.map((value) => JSON.stringify(value)).join("\n") + "\n");
  const result = await extractCorpus(sessions, root);
  assert.deepEqual(result, { candidates: 2, files: 1 });
  const candidates = (await readFile(join(root, "candidates.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(candidates.map(({ text }) => text), ["Completed response.", "Another completed response."]);
  assert.equal(JSON.stringify(candidates).includes("do not collect me"), false);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, "candidates.jsonl"))).mode & 0o777, 0o600);
  const manifest = JSON.parse(await readFile(join(root, "source-manifest.json"), "utf8"));
  assert.equal(JSON.stringify(manifest).includes("session.jsonl"), false);
  assert.equal(manifest.counts.excludedDuplicate, 1);
  assert.equal(manifest.counts.excludedNopusRewrite, 1);
});
