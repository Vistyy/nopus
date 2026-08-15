import type { ProseMetrics } from "../../src/analysis/measure-prose.js";
import type { ComplexitySensitivity, RewriteSignal } from "../../src/policy/decide-rewrite.js";

export const CORPUS_VERSION = 1;
export const PROFILES: readonly ComplexitySensitivity[] = ["low", "medium", "high"];

export type DecisionBand = "AAA" | "AAR" | "ARR" | "RRR";
export type LengthBand = "1-9" | "10-29" | "30-99" | "100-299" | "300+";
export type FirstRewriteProfile = ComplexitySensitivity | "none";

export type PrivateCandidate = {
  schemaVersion: 1;
  candidateId: string;
  duplicateGroupId: string;
  sourceSessionId: string;
  sourceRecordId: string;
  timestamp?: string;
  provider: string;
  model: string;
  text: string;
};

export type FrozenMetrics = Omit<ProseMetrics, "sentences" | "stacks" | "styleCues"> & {
  sentences: ProseMetrics["sentences"];
  stacks: string[];
  styleCues: ProseMetrics["styleCues"];
};

export type ProfileDecision = { rewrite: boolean; signals: RewriteSignal[] };

export type CandidateBaseline = {
  schemaVersion: 1;
  candidateId: string;
  whitespaceWordCount: number;
  lengthBand: LengthBand;
  decisionBand: DecisionBand;
  metrics: FrozenMetrics;
  decisions: Record<ComplexitySensitivity, ProfileDecision>;
};

export type CorpusSample = {
  schemaVersion: 1;
  sampleId: string;
  seed: string;
  createdAt: string;
  calibrationIds: string[];
  holdoutIds: string[];
  selected: Array<{
    candidateId: string;
    role: "calibration" | "holdout";
    decisionBand: DecisionBand;
    lengthBand: LengthBand;
  }>;
  quotaRelaxations: string[];
};

export type HumanLabel = {
  schemaVersion: 1;
  sampleId: string;
  candidateId: string;
  status: "certain" | "uncertain";
  firstRewriteProfile: FirstRewriteProfile | null;
  rubricVersion: 1;
  note?: string;
};

export type MediumAnchorLabel = {
  schemaVersion: 1;
  sampleId: string;
  candidateId: string;
  profile: "medium";
  decision: "accept" | "rewrite" | "uncertain";
  rubricVersion: 1;
  note?: string;
};

export type SourceManifest = {
  schemaVersion: 1;
  createdAt: string;
  inputRootId: string;
  files: Array<{ sourceId: string; size: number; modifiedMilliseconds: number; sha256: string }>;
  counts: Record<string, number>;
};

export function lengthBand(wordCount: number): LengthBand {
  if (wordCount < 10) return "1-9";
  if (wordCount < 30) return "10-29";
  if (wordCount < 100) return "30-99";
  if (wordCount < 300) return "100-299";
  return "300+";
}

export function decisionBand(decisions: Record<ComplexitySensitivity, ProfileDecision>): DecisionBand {
  const pattern = PROFILES.map((profile) => decisions[profile].rewrite ? "R" : "A").join("");
  if (pattern === "AAA" || pattern === "AAR" || pattern === "ARR" || pattern === "RRR") return pattern;
  throw new Error(`Policy decisions are not monotonic: ${pattern}`);
}

export function expectedRewrite(label: HumanLabel, profile: ComplexitySensitivity): boolean | undefined {
  if (label.status === "uncertain" || label.firstRewriteProfile === null) return undefined;
  if (label.firstRewriteProfile === "none") return false;
  return PROFILES.indexOf(profile) >= PROFILES.indexOf(label.firstRewriteProfile);
}
