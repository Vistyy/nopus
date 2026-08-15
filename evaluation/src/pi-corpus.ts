import { createHash, createHmac, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { measureProse, type ProseMetrics } from "../../src/analysis/measure-prose.js";
import { decideRewrite, type ComplexitySensitivity } from "../../src/policy/decide-rewrite.js";
import {
  CORPUS_VERSION,
  PROFILES,
  decisionBand,
  expectedRewrite,
  lengthBand,
  type CandidateBaseline,
  type CorpusSample,
  type DecisionBand,
  type HumanLabel,
  type LengthBand,
  type MediumAnchorLabel,
  type PrivateCandidate,
  type ProfileDecision,
  type SourceManifest,
} from "./pi-corpus-schema.js";

const DEFAULT_SESSIONS = join(homedir(), ".pi", "agent", "sessions");

function stateHome(): string {
  const configured = process.env.XDG_STATE_HOME?.trim();
  if (!configured) return join(homedir(), ".local", "state");
  if (!isAbsolute(configured)) throw new Error("XDG_STATE_HOME must be an absolute path.");
  return configured;
}

const DEFAULT_PRIVATE_ROOT = join(stateHome(), "nopus", "evaluation", "pi-corpus", "v1");
const NOPUS_CUSTOM_TYPE = "nopus-rewrite";
const LENGTHS: readonly LengthBand[] = ["1-9", "10-29", "30-99", "100-299", "300+"];
const BANDS: readonly DecisionBand[] = ["AAA", "AAR", "ARR", "RRR"];
const QUOTAS: Record<DecisionBand, Record<LengthBand, number>> = {
  AAA: { "1-9": 4, "10-29": 8, "30-99": 14, "100-299": 9, "300+": 5 },
  AAR: { "1-9": 0, "10-29": 0, "30-99": 8, "100-299": 18, "300+": 14 },
  ARR: { "1-9": 0, "10-29": 0, "30-99": 8, "100-299": 18, "300+": 14 },
  RRR: { "1-9": 0, "10-29": 0, "30-99": 8, "100-299": 22, "300+": 10 },
};
const POLICY_METRICS: readonly (keyof ProseMetrics)[] = [
  "uncommonRatio", "veryUncommonRatio", "abstractRatio", "eligibleSentenceCount",
  "highAbstractSentenceCount", "highAbstractSentenceRatio", "maxSentenceAbstractRatio",
  "nounStackCount", "phraseLoadPer100Words", "styleCueCount", "lexicalWordCount",
];

type JsonObject = Record<string, unknown>;
type CandidateWithSource = PrivateCandidate & { sourceSessionId: string };
type ExtractionCounts = {
  sourceFiles: number;
  hashedBytes: number;
  assistantRecords: number;
  excludedNotCompleted: number;
  excludedNopusRewrite: number;
  excludedMissingProvenance: number;
  excludedMock: number;
  excludedEmptyOrToolCall: number;
  excludedDuplicate: number;
  candidates: number;
};
type ParsedSession = {
  candidates: PrivateCandidate[];
  manifestFile: SourceManifest["files"][number];
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeResponseText(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export function assistantText(message: unknown): string | undefined {
  if (!isObject(message) || message.role !== "assistant" || message.stopReason !== "stop" || !Array.isArray(message.content)) return undefined;
  if (message.content.some((block) => isObject(block) && block.type === "toolCall")) return undefined;
  const text = message.content.flatMap((block) =>
    isObject(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []
  ).join("\n");
  const normalized = normalizeResponseText(text);
  return normalized.length > 0 ? normalized : undefined;
}

function digest(key: Buffer, domain: string, value: string): string {
  return createHmac("sha256", key).update(domain).update("\0").update(value).digest("hex").slice(0, 32);
}

async function jsonLines<T>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf8");
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function parsedSample(value: unknown): CorpusSample {
  if (!isObject(value) || value.schemaVersion !== CORPUS_VERSION || typeof value.sampleId !== "string" || !value.sampleId ||
      !Array.isArray(value.calibrationIds) || !Array.isArray(value.holdoutIds) || !Array.isArray(value.selected)) {
    throw new Error("The private sample is incompatible. Replace it with `sample --force` before labeling.");
  }
  return value as CorpusSample;
}

async function loadSample(root: string): Promise<CorpusSample> {
  return parsedSample(JSON.parse(await readFile(join(root, "sample.json"), "utf8")));
}

async function loadLabels(root: string, sampleId?: string): Promise<HumanLabel[]> {
  const labels = (await jsonLines<unknown>(join(root, "labels.jsonl"))).map(validatedLabel);
  if (sampleId !== undefined && labels.some((label) => label.sampleId !== sampleId)) {
    throw new Error("The private labels belong to a different frozen sample.");
  }
  return labels;
}

async function loadMediumAnchorLabels(root: string, sampleId?: string): Promise<MediumAnchorLabel[]> {
  const labels = (await jsonLines<unknown>(join(root, "medium-anchor-labels.jsonl"))).map(validatedMediumAnchorLabel);
  if (sampleId !== undefined && labels.some((label) => label.sampleId !== sampleId)) {
    throw new Error("The private medium-anchor labels belong to a different frozen sample.");
  }
  return labels;
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.new`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function privateKey(root: string): Promise<Buffer> {
  const path = join(root, "id-key");
  try {
    const value = await readFile(path);
    if (value.length !== 32) throw new Error(`Invalid private corpus key: ${path}`);
    return value;
  } catch (error) {
    if (isObject(error) && error.code !== "ENOENT") throw error;
    const value = randomBytes(32);
    await writeFile(path, value, { mode: 0o600, flag: "wx" });
    return value;
  }
}

async function sessionFiles(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path);
    }
  };
  await visit(root);
  return result.sort();
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function unchanged(before: Awaited<ReturnType<typeof stat>>, after: Awaited<ReturnType<typeof stat>>): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs;
}

async function parseSession(path: string, sessionsRoot: string, key: Buffer, counts: ExtractionCounts): Promise<ParsedSession> {
  const before = await stat(path);
  const sha256 = await sha256File(path);
  const afterHash = await stat(path);
  if (!unchanged(before, afterHash)) throw new Error(`Session changed while hashing: ${basename(path)}`);

  const sourcePath = relative(sessionsRoot, path);
  const sourceSessionId = digest(key, "session", sourcePath);
  const candidates: PrivateCandidate[] = [];
  const nopusTurnByEntry = new Map<string, boolean>();
  let headerSeen = false;
  let lineNumber = 0;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    let entry: JsonObject;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isObject(parsed)) throw new Error("entry is not an object");
      entry = parsed;
    } catch (error) {
      throw new Error(`Invalid session JSON at ${basename(path)}:${lineNumber}: ${String(error)}`);
    }
    if (!headerSeen) {
      headerSeen = true;
      if (entry.type !== "session" || entry.version !== 3) throw new Error(`Unsupported session header: ${basename(path)}`);
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id : undefined;
    const parentId = typeof entry.parentId === "string" ? entry.parentId : undefined;
    const inheritedNopusTurn = parentId !== undefined && nopusTurnByEntry.get(parentId) === true;
    const startsNopusTurn = entry.type === "custom_message" && entry.customType === NOPUS_CUSTOM_TYPE;
    const isUserMessage = entry.type === "message" && isObject(entry.message) && entry.message.role === "user";
    const isNopusTurn = isUserMessage ? false : startsNopusTurn || inheritedNopusTurn;
    if (id !== undefined) nopusTurnByEntry.set(id, isNopusTurn);
    if (entry.type !== "message" || !isObject(entry.message)) continue;
    counts.assistantRecords += entry.message.role === "assistant" ? 1 : 0;
    if (entry.message.role !== "assistant" || entry.message.stopReason !== "stop") {
      if (entry.message.role === "assistant") counts.excludedNotCompleted += 1;
      continue;
    }
    if (isNopusTurn) {
      counts.excludedNopusRewrite += 1;
      continue;
    }
    const provider = typeof entry.message.provider === "string" ? entry.message.provider : undefined;
    const model = typeof entry.message.model === "string" ? entry.message.model : undefined;
    if (provider === undefined || model === undefined) {
      counts.excludedMissingProvenance += 1;
      continue;
    }
    if (/mock/i.test(provider) || /mock/i.test(model)) {
      counts.excludedMock += 1;
      continue;
    }
    const text = assistantText(entry.message);
    if (text === undefined) {
      counts.excludedEmptyOrToolCall += 1;
      continue;
    }
    const sourceRecord = `${sourcePath}\0${id ?? lineNumber}`;
    candidates.push({
      schemaVersion: CORPUS_VERSION,
      candidateId: digest(key, "candidate", sourceRecord),
      duplicateGroupId: digest(key, "duplicate", text),
      sourceSessionId,
      sourceRecordId: digest(key, "record", sourceRecord),
      ...(typeof entry.timestamp === "string" ? { timestamp: entry.timestamp } : {}),
      provider,
      model,
      text,
    });
  }
  if (!headerSeen) throw new Error(`Empty session: ${basename(path)}`);
  const after = await stat(path);
  if (!unchanged(before, after)) throw new Error(`Session changed while reading: ${basename(path)}`);
  counts.hashedBytes += before.size;
  counts.sourceFiles += 1;
  return {
    candidates,
    manifestFile: {
      sourceId: sourceSessionId,
      size: before.size,
      modifiedMilliseconds: before.mtimeMs,
      sha256,
    },
  };
}

export async function extractCorpus(sessionsRoot: string, root: string): Promise<{ candidates: number; files: number }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const key = await privateKey(root);
  const counts: ExtractionCounts = {
    sourceFiles: 0, hashedBytes: 0, assistantRecords: 0, excludedNotCompleted: 0,
    excludedNopusRewrite: 0, excludedMissingProvenance: 0, excludedMock: 0,
    excludedEmptyOrToolCall: 0, excludedDuplicate: 0, candidates: 0,
  };
  const all: PrivateCandidate[] = [];
  const files: SourceManifest["files"] = [];
  for (const path of await sessionFiles(sessionsRoot)) {
    const parsed = await parseSession(path, sessionsRoot, key, counts);
    all.push(...parsed.candidates);
    files.push(parsed.manifestFile);
  }
  const seen = new Set<string>();
  const candidates = all.filter((candidate) => {
    if (seen.has(candidate.duplicateGroupId)) {
      counts.excludedDuplicate += 1;
      return false;
    }
    seen.add(candidate.duplicateGroupId);
    return true;
  });
  counts.candidates = candidates.length;
  const manifest: SourceManifest = {
    schemaVersion: CORPUS_VERSION,
    createdAt: new Date().toISOString(),
    inputRootId: digest(key, "input-root", resolve(sessionsRoot)),
    files,
    counts,
  };
  await atomicPrivateWrite(join(root, "candidates.jsonl"), candidates.map((value) => JSON.stringify(value)).join("\n") + "\n");
  await atomicPrivateWrite(join(root, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { candidates: candidates.length, files: files.length };
}

function profileDecisions(metrics: ProseMetrics): Record<ComplexitySensitivity, ProfileDecision> {
  return Object.fromEntries(PROFILES.map((profile) => [profile, decideRewrite(metrics, profile)])) as Record<ComplexitySensitivity, ProfileDecision>;
}

export async function scoreCorpus(root: string): Promise<Record<DecisionBand, number>> {
  const candidates = await jsonLines<PrivateCandidate>(join(root, "candidates.jsonl"));
  const totals = { AAA: 0, AAR: 0, ARR: 0, RRR: 0 };
  const baselines = candidates.map((candidate): CandidateBaseline => {
    const metrics = measureProse(candidate.text);
    const decisions = profileDecisions(metrics);
    const band = decisionBand(decisions);
    totals[band] += 1;
    const wordCount = candidate.text.split(/\s+/).filter(Boolean).length;
    return {
      schemaVersion: CORPUS_VERSION,
      candidateId: candidate.candidateId,
      whitespaceWordCount: wordCount,
      lengthBand: lengthBand(wordCount),
      decisionBand: band,
      metrics,
      decisions,
    };
  });
  await atomicPrivateWrite(join(root, "baseline.jsonl"), baselines.map((value) => JSON.stringify(value)).join("\n") + "\n");
  return totals;
}

function rank(key: Buffer, seed: string, id: string): string {
  return digest(key, `sample:${seed}`, id);
}

export async function sampleCorpus(root: string, seed = "nopus-pi-corpus-v1", force = false): Promise<CorpusSample> {
  const samplePath = join(root, "sample.json");
  if (!force) {
    try { return parsedSample(JSON.parse(await readFile(samplePath, "utf8"))); } catch (error) {
      if (!isObject(error) || error.code !== "ENOENT") throw error;
    }
  } else {
    for (const load of [loadLabels, loadMediumAnchorLabels] as const) {
      try {
        const labels = await load(root);
        if (labels.length > 0) throw new Error("Cannot replace a sample after labels exist.");
      } catch (error) {
        if (!isObject(error) || (error.code !== "ENOENT" && !(error instanceof Error && error.message.includes("after labels exist")))) throw error;
        if (error instanceof Error && error.message.includes("after labels exist")) throw error;
      }
    }
  }
  const key = await privateKey(root);
  const candidates = await jsonLines<CandidateWithSource>(join(root, "candidates.jsonl"));
  const baselines = await jsonLines<CandidateBaseline>(join(root, "baseline.jsonl"));
  const candidateById = new Map(candidates.map((value) => [value.candidateId, value]));
  const selected: CandidateBaseline[] = [];
  const sourceUses = new Map<string, number>();
  const relaxations: string[] = [];
  for (const band of BANDS) {
    for (const length of LENGTHS) {
      const quota = QUOTAS[band][length];
      const pool = baselines
        .filter((value) => value.decisionBand === band && value.lengthBand === length)
        .sort((left, right) => rank(key, seed, left.candidateId).localeCompare(rank(key, seed, right.candidateId)));
      const choose = (cap: number, count: number, already: CandidateBaseline[] = []): CandidateBaseline[] => {
        const result: CandidateBaseline[] = [];
        const uses = new Map(sourceUses);
        for (const value of already) {
          const source = candidateById.get(value.candidateId)?.sourceSessionId;
          if (source !== undefined) uses.set(source, (uses.get(source) ?? 0) + 1);
        }
        for (const value of pool) {
          if (result.length >= count || already.includes(value) || selected.some((chosen) => chosen.candidateId === value.candidateId)) continue;
          const source = candidateById.get(value.candidateId)?.sourceSessionId;
          if (source === undefined || (uses.get(source) ?? 0) >= cap) continue;
          result.push(value);
          uses.set(source, (uses.get(source) ?? 0) + 1);
        }
        return result;
      };
      let chosen = choose(2, quota);
      if (chosen.length < quota) {
        const cappedCount = chosen.length;
        chosen = [...chosen, ...choose(Number.POSITIVE_INFINITY, quota - chosen.length, chosen)];
        relaxations.push(`${band}/${length}: relaxed the two-responses-per-session cap for ${quota - cappedCount} selections.`);
      }
      if (chosen.length < quota) throw new Error(`Insufficient candidates for ${band}/${length}: need ${quota}, found ${chosen.length}`);
      for (const value of chosen) {
        selected.push(value);
        const source = candidateById.get(value.candidateId)?.sourceSessionId;
        if (source !== undefined) sourceUses.set(source, (sourceUses.get(source) ?? 0) + 1);
      }
    }
  }
  const records: CorpusSample["selected"] = [];
  for (const band of BANDS) {
    const group = selected.filter((value) => value.decisionBand === band)
      .sort((left, right) => rank(key, `${seed}:role`, left.candidateId).localeCompare(rank(key, `${seed}:role`, right.candidateId)));
    const holdout = new Set(group.slice(0, 10).map((value) => value.candidateId));
    for (const value of group) records.push({
      candidateId: value.candidateId,
      role: holdout.has(value.candidateId) ? "holdout" : "calibration",
      decisionBand: value.decisionBand,
      lengthBand: value.lengthBand,
    });
  }
  records.sort((left, right) => rank(key, `${seed}:order`, left.candidateId).localeCompare(rank(key, `${seed}:order`, right.candidateId)));
  const sampleId = createHash("sha256").update(seed).update("\0").update(records.map(({ candidateId, role }) => `${candidateId}:${role}`).join("\n")).digest("hex").slice(0, 32);
  const sample: CorpusSample = {
    schemaVersion: CORPUS_VERSION,
    sampleId,
    seed,
    createdAt: new Date().toISOString(),
    calibrationIds: records.filter(({ role }) => role === "calibration").map(({ candidateId }) => candidateId),
    holdoutIds: records.filter(({ role }) => role === "holdout").map(({ candidateId }) => candidateId),
    selected: records,
    quotaRelaxations: relaxations,
  };
  await atomicPrivateWrite(samplePath, `${JSON.stringify(sample, null, 2)}\n`);
  return sample;
}

type Confusion = { trueAccept: number; falseRewrite: number; falseAccept: number; trueRewrite: number };

function emptyConfusion(): Confusion {
  return { trueAccept: 0, falseRewrite: 0, falseAccept: 0, trueRewrite: 0 };
}

export function addConfusion(result: Confusion, expected: boolean, actual: boolean): void {
  if (!expected && !actual) result.trueAccept += 1;
  else if (!expected && actual) result.falseRewrite += 1;
  else if (expected && !actual) result.falseAccept += 1;
  else result.trueRewrite += 1;
}

export async function writePrivacyInput(root: string, role: "calibration" | "holdout" | "all" = "all"): Promise<{ responses: number; output: string }> {
  const candidates = await jsonLines<PrivateCandidate>(join(root, "candidates.jsonl"));
  const sample = await loadSample(root);
  const selected = new Set(sample.selected
    .filter((value) => role === "all" || value.role === role)
    .map((value) => value.candidateId));
  const values = candidates.filter((candidate) => selected.has(candidate.candidateId));
  if (values.length !== selected.size) throw new Error(`Privacy input is incomplete: ${values.length}/${selected.size}`);
  const output = join(root, `privacy-input-${role}.jsonl`);
  await atomicPrivateWrite(output, values.map((value) => JSON.stringify(value)).join("\n") + "\n");
  return { responses: values.length, output };
}

function validatedLabel(value: unknown): HumanLabel {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.sampleId !== "string" || typeof value.candidateId !== "string" || value.rubricVersion !== 1) {
    throw new Error("A label has an invalid schema or candidate ID.");
  }
  if (value.status !== "certain" && value.status !== "uncertain") throw new Error(`Invalid label status for ${value.candidateId}`);
  const first = value.firstRewriteProfile;
  if (value.status === "uncertain" && first !== null) throw new Error(`Uncertain label must have a null profile: ${value.candidateId}`);
  if (value.status === "certain" && first !== "low" && first !== "medium" && first !== "high" && first !== "none") {
    throw new Error(`Certain label has an invalid profile: ${value.candidateId}`);
  }
  return {
    schemaVersion: 1,
    sampleId: value.sampleId,
    candidateId: value.candidateId,
    status: value.status,
    firstRewriteProfile: first as HumanLabel["firstRewriteProfile"],
    rubricVersion: 1,
    ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
  };
}

export async function importLabels(root: string, input: string): Promise<{ labels: number }> {
  const sample = await loadSample(root);
  const allowed = new Set(sample.selected.map(({ candidateId }) => candidateId));
  const incoming = (await jsonLines<unknown>(input)).map(validatedLabel);
  let existing: HumanLabel[] = [];
  try { existing = await loadLabels(root, sample.sampleId); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  const merged = new Map(existing.map((label) => [label.candidateId, label]));
  for (const label of incoming) {
    if (label.sampleId !== sample.sampleId) throw new Error(`Label belongs to a different sample: ${label.candidateId}`);
    if (!allowed.has(label.candidateId)) throw new Error(`Label is not in the frozen sample: ${label.candidateId}`);
    merged.set(label.candidateId, label);
  }
  const labels = [...merged.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  await atomicPrivateWrite(join(root, "labels.jsonl"), labels.map((value) => JSON.stringify(value)).join("\n") + "\n");
  return { labels: labels.length };
}

function validatedMediumAnchorLabel(value: unknown): MediumAnchorLabel {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.sampleId !== "string" || typeof value.candidateId !== "string" ||
      value.profile !== "medium" || value.rubricVersion !== 1) {
    throw new Error("A medium-anchor label has an invalid schema or candidate ID.");
  }
  if (value.decision !== "accept" && value.decision !== "rewrite" && value.decision !== "uncertain") {
    throw new Error(`Invalid medium-anchor decision for ${value.candidateId}`);
  }
  return {
    schemaVersion: 1,
    sampleId: value.sampleId,
    candidateId: value.candidateId,
    profile: "medium",
    decision: value.decision,
    rubricVersion: 1,
    ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
  };
}

export async function importMediumAnchorLabels(root: string, input: string): Promise<{ labels: number }> {
  const sample = await loadSample(root);
  const allowed = new Set(sample.calibrationIds);
  const incoming = (await jsonLines<unknown>(input)).map(validatedMediumAnchorLabel);
  let existing: MediumAnchorLabel[] = [];
  try { existing = await loadMediumAnchorLabels(root, sample.sampleId); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  const merged = new Map(existing.map((label) => [label.candidateId, label]));
  for (const label of incoming) {
    if (label.sampleId !== sample.sampleId) throw new Error(`Medium-anchor label belongs to a different sample: ${label.candidateId}`);
    if (!allowed.has(label.candidateId)) throw new Error(`Medium-anchor label is not in the calibration sample: ${label.candidateId}`);
    merged.set(label.candidateId, label);
  }
  const labels = [...merged.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  await atomicPrivateWrite(join(root, "medium-anchor-labels.jsonl"), labels.map((value) => JSON.stringify(value)).join("\n") + "\n");
  return { labels: labels.length };
}

export async function exportPolicyFixture(root: string, output: string): Promise<{ cases: number; output: string }> {
  const baselines = await jsonLines<CandidateBaseline>(join(root, "baseline.jsonl"));
  const sample = await loadSample(root);
  let labels: HumanLabel[] = [];
  try { labels = await loadLabels(root, sample.sampleId); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  const labelById = new Map(labels.map((label) => [label.candidateId, label]));
  const cases = [...baselines]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    .map((baseline) => ({
      metrics: Object.fromEntries(POLICY_METRICS.map((metric) => [metric, baseline.metrics[metric]])),
      expected: Object.fromEntries(PROFILES.map((profile) => [profile, baseline.decisions[profile].rewrite])),
      ...(labelById.has(baseline.candidateId) ? {
        label: {
          status: labelById.get(baseline.candidateId)!.status,
          firstRewriteProfile: labelById.get(baseline.candidateId)!.firstRewriteProfile,
        },
      } : {}),
    }));
  const fixture = {
    schemaVersion: CORPUS_VERSION,
    description: "Frozen policy inputs from unique completed Pi assistant responses. Contains no response text or provenance.",
    profiles: PROFILES,
    cases,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(fixture)}\n`);
  await chmod(output, 0o644);
  return { cases: cases.length, output };
}

export async function verifyCorpus(root: string): Promise<JsonObject> {
  const candidates = await jsonLines<PrivateCandidate>(join(root, "candidates.jsonl"));
  const baselines = await jsonLines<CandidateBaseline>(join(root, "baseline.jsonl"));
  const candidateById = new Map(candidates.map((value) => [value.candidateId, value]));
  let analyzerDrift = 0;
  let frozenPolicyDrift = 0;
  let endToEndDrift = 0;
  let monotonicityViolations = 0;
  const currentById = new Map<string, Record<ComplexitySensitivity, ProfileDecision>>();
  for (const baseline of baselines) {
    const candidate = candidateById.get(baseline.candidateId);
    if (candidate === undefined) throw new Error(`Baseline has no candidate: ${baseline.candidateId}`);
    const currentMetrics = measureProse(candidate.text);
    if (POLICY_METRICS.some((metric) => Math.abs(Number(currentMetrics[metric]) - Number(baseline.metrics[metric])) > 1e-12)) analyzerDrift += 1;
    const frozen = profileDecisions(baseline.metrics);
    if (PROFILES.some((profile) => frozen[profile].rewrite !== baseline.decisions[profile].rewrite)) frozenPolicyDrift += 1;
    const current = profileDecisions(currentMetrics);
    currentById.set(baseline.candidateId, current);
    if (PROFILES.some((profile) => current[profile].rewrite !== baseline.decisions[profile].rewrite)) endToEndDrift += 1;
    try { decisionBand(current); } catch { monotonicityViolations += 1; }
  }
  let sample: CorpusSample | undefined;
  try { sample = await loadSample(root); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  let labels: HumanLabel[] = [];
  try { labels = await loadLabels(root, sample?.sampleId); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  let mediumAnchorLabels: MediumAnchorLabel[] = [];
  try { mediumAnchorLabels = await loadMediumAnchorLabels(root, sample?.sampleId); } catch (error) {
    if (!isObject(error) || error.code !== "ENOENT") throw error;
  }
  const roleById = new Map(sample?.selected.map((value) => [value.candidateId, value.role]) ?? []);
  const confusion: Record<string, Record<ComplexitySensitivity, Confusion>> = {
    calibration: { low: emptyConfusion(), medium: emptyConfusion(), high: emptyConfusion() },
    holdout: { low: emptyConfusion(), medium: emptyConfusion(), high: emptyConfusion() },
  };
  let certainLabels = 0;
  let uncertainLabels = 0;
  for (const label of labels) {
    if (label.status === "uncertain") { uncertainLabels += 1; continue; }
    certainLabels += 1;
    const role = roleById.get(label.candidateId);
    const decisions = currentById.get(label.candidateId);
    if (role === undefined || decisions === undefined) continue;
    for (const profile of PROFILES) {
      const expected = expectedRewrite(label, profile);
      if (expected !== undefined) addConfusion(confusion[role]![profile], expected, decisions[profile].rewrite);
    }
  }
  const mediumAnchorConfusion = emptyConfusion();
  let certainMediumAnchors = 0;
  let uncertainMediumAnchors = 0;
  for (const label of mediumAnchorLabels) {
    if (label.decision === "uncertain") {
      uncertainMediumAnchors += 1;
      continue;
    }
    certainMediumAnchors += 1;
    const decisions = currentById.get(label.candidateId);
    if (decisions !== undefined) addConfusion(mediumAnchorConfusion, label.decision === "rewrite", decisions.medium.rewrite);
  }
  const report = {
    schemaVersion: CORPUS_VERSION,
    createdAt: new Date().toISOString(),
    responses: baselines.length,
    analyzerDrift,
    frozenPolicyDrift,
    endToEndDrift,
    monotonicityViolations,
    labels: { certain: certainLabels, uncertain: uncertainLabels },
    mediumAnchor: {
      labels: { certain: certainMediumAnchors, uncertain: uncertainMediumAnchors },
      confusion: mediumAnchorConfusion,
    },
    confusion,
  };
  await atomicPrivateWrite(join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main(): Promise<void> {
  process.umask(0o077);
  const command = process.argv[2] ?? "build";
  const root = resolve(argument("--root") ?? DEFAULT_PRIVATE_ROOT);
  const sessions = resolve(argument("--sessions") ?? DEFAULT_SESSIONS);
  let result: unknown;
  if (command === "extract") result = await extractCorpus(sessions, root);
  else if (command === "score") result = await scoreCorpus(root);
  else if (command === "sample") result = await sampleCorpus(root, argument("--seed"), process.argv.includes("--force"));
  else if (command === "privacy-input") {
    const role = argument("--role") ?? "all";
    if (role !== "all" && role !== "calibration" && role !== "holdout") throw new Error("--role must be all, calibration, or holdout");
    result = await writePrivacyInput(root, role);
  }
  else if (command === "labels" || command === "medium-anchor-labels") {
    const input = argument("--input");
    if (input === undefined) throw new Error(`${command} requires --input PATH`);
    result = command === "labels" ? await importLabels(root, resolve(input)) : await importMediumAnchorLabels(root, resolve(input));
  }
  else if (command === "export-fixture") {
    result = await exportPolicyFixture(root, resolve(argument("--output") ?? "evaluation/fixtures/pi-policy-corpus.json"));
  }
  else if (command === "verify") result = await verifyCorpus(root);
  else if (command === "build") {
    result = {
      extract: await extractCorpus(sessions, root),
      score: await scoreCorpus(root),
      sample: await sampleCorpus(root, argument("--seed")),
      verify: await verifyCorpus(root),
    };
  } else throw new Error("Usage: pi-corpus.ts [build|extract|score|sample|privacy-input|medium-anchor-labels|labels|export-fixture|verify] [--sessions PATH] [--root PATH] [--seed VALUE] [--force] [--role all|calibration|holdout] [--input PATH] [--output PATH]");
  console.log(JSON.stringify({ root, result }, null, 2));
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === resolve(new URL(import.meta.url).pathname)) await main();
