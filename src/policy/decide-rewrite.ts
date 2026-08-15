import type { ProseMetrics } from "../analysis/measure-prose.js";

export type ComplexitySensitivity = "low" | "medium" | "high";
export type RewriteSignal =
  | "sustained-abstractness"
  | "combined-complexity"
  | "stacked-phrasing"
  | "concentrated-complexity"
  | "pervasive-complexity"
  | "style-cues";

export type RewriteDecision = {
  rewrite: boolean;
  signals: RewriteSignal[];
};

type DecisionMetrics = Pick<ProseMetrics,
  "uncommonRatio" |
  "veryUncommonRatio" |
  "abstractRatio" |
  "eligibleSentenceCount" |
  "highAbstractSentenceCount" |
  "highAbstractSentenceRatio" |
  "maxSentenceAbstractRatio" |
  "nounStackCount" |
  "phraseLoadPer100Words" |
  "styleCueCount" |
  "lexicalWordCount"
>;

type Thresholds = {
  sustained: [eligible: number, highCount: number, highRatio: number, maximum: number, phraseLoad: number];
  combined: [uncommon: number, veryUncommon: number, abstract: number, stacks: number, phraseLoad: number];
  stacked: [abstract: number, stacks: number, phraseLoad: number];
  concentrated: [uncommon: number, veryUncommon: number, abstract: number, highCount: number, maximum: number, phraseLoad: number];
  pervasive: [words: number, uncommon: number, veryUncommon: number, abstract: number, combined: number];
  style: [distinctCues: number, singleCueUncommon: number];
};

const profiles: Record<ComplexitySensitivity, Thresholds> = {
  low: {
    sustained: [4, 2, 0.35, 0.65, 3],
    combined: [0.18, 0.05, 0.45, 2, 2],
    stacked: [0.52, 4, 3],
    concentrated: [0.3, 0.05, 0.45, 3, 0.75, 4],
    pervasive: [30, 0.35, 0.08, 0.4, 1.05],
    style: [2, 0.3],
  },
  medium: {
    sustained: [3, 2, 0.35, 0.65, 2],
    combined: [0.16, 0.04, 0.425, 2, 1.75],
    stacked: [0.5, 3, 2.5],
    concentrated: [0.28, 0.045, 0.38, 3, 0.72, 3.5],
    pervasive: [30, 0.35, 0.08, 0.4, 1.05],
    style: [2, 0.25],
  },
  high: {
    sustained: [2, 2, 0.3, 0.6, 1],
    combined: [0.15, 0.04, 0.38, 2, 1.5],
    stacked: [0.48, 3, 2],
    concentrated: [0.25, 0.04, 0.36, 2, 0.7, 3],
    pervasive: [30, 0.35, 0.08, 0.4, 1.05],
    style: [2, 0.2],
  },
};

export function decideRewrite(
  metrics: DecisionMetrics,
  complexitySensitivity: ComplexitySensitivity = "low",
): RewriteDecision {
  const { sustained, combined, stacked, concentrated, pervasive, style } = profiles[complexitySensitivity];
  const signals: RewriteSignal[] = [];

  if (
    metrics.eligibleSentenceCount >= sustained[0] &&
    metrics.highAbstractSentenceCount >= sustained[1] &&
    metrics.highAbstractSentenceRatio >= sustained[2] &&
    metrics.maxSentenceAbstractRatio >= sustained[3] &&
    metrics.phraseLoadPer100Words >= sustained[4]
  ) signals.push("sustained-abstractness");

  if (
    metrics.uncommonRatio >= combined[0] &&
    metrics.veryUncommonRatio >= combined[1] &&
    metrics.abstractRatio >= combined[2] &&
    metrics.nounStackCount >= combined[3] &&
    metrics.phraseLoadPer100Words >= combined[4]
  ) signals.push("combined-complexity");

  if (
    metrics.abstractRatio >= stacked[0] &&
    metrics.nounStackCount >= stacked[1] &&
    metrics.phraseLoadPer100Words >= stacked[2]
  ) signals.push("stacked-phrasing");

  if (
    metrics.uncommonRatio >= concentrated[0] &&
    metrics.veryUncommonRatio >= concentrated[1] &&
    metrics.abstractRatio >= concentrated[2] &&
    metrics.highAbstractSentenceCount >= concentrated[3] &&
    metrics.maxSentenceAbstractRatio >= concentrated[4] &&
    metrics.phraseLoadPer100Words >= concentrated[5]
  ) signals.push("concentrated-complexity");

  if (
    metrics.lexicalWordCount >= pervasive[0] &&
    metrics.uncommonRatio >= pervasive[1] &&
    metrics.veryUncommonRatio >= pervasive[2] &&
    metrics.abstractRatio >= pervasive[3] &&
    metrics.uncommonRatio + metrics.veryUncommonRatio + metrics.abstractRatio >= pervasive[4]
  ) signals.push("pervasive-complexity");

  if (
    metrics.styleCueCount >= style[0] ||
    (metrics.styleCueCount >= 1 && metrics.uncommonRatio >= style[1])
  ) signals.push("style-cues");

  return { rewrite: signals.length > 0, signals };
}

export function shouldRewrite(
  metrics: DecisionMetrics,
  complexitySensitivity: ComplexitySensitivity = "low",
): boolean {
  return decideRewrite(metrics, complexitySensitivity).rewrite;
}
