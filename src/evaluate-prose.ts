import { measureProse, type ProseMetrics } from "./analysis/measure-prose.js";
import {
  decideRewrite,
  type ComplexitySensitivity,
  type RewriteSignal,
} from "./policy/decide-rewrite.js";

export type ProseFinding = {
  kind: "high-abstractness-sentence" | "abstract-noun-stack" | "style-cue";
  text: string;
  detail: string;
};

export type ProseEvaluation = {
  retry: boolean;
  signals: RewriteSignal[];
  metrics: ProseMetrics;
  findings: ProseFinding[];
};

function findingsFor(metrics: ProseMetrics): ProseFinding[] {
  return [
    ...metrics.sentences
      .filter(({ abstractRatio }) => abstractRatio >= 0.55)
      .sort((left, right) => right.abstractRatio - left.abstractRatio)
      .slice(0, 4)
      .map(({ text, abstractRatio, longestRun }): ProseFinding => ({
        kind: "high-abstractness-sentence",
        text,
        detail: `${(abstractRatio * 100).toFixed(0)}% abstract rated words; longest abstract run ${longestRun}`,
      })),
    ...metrics.stacks.slice(0, 5).map((text): ProseFinding => ({
      kind: "abstract-noun-stack",
      text,
      detail: "Several abstract nouns or modifiers are stacked.",
    })),
    ...metrics.styleCues.slice(0, 5).map(({ cue, count, guidance }): ProseFinding => ({
      kind: "style-cue",
      text: cue,
      detail: `${count} occurrence${count === 1 ? "" : "s"}. ${guidance}`,
    })),
  ];
}

export function evaluateProse(
  text: string,
  options: { complexitySensitivity?: ComplexitySensitivity } = {},
): ProseEvaluation {
  const metrics = measureProse(text);
  const decision = decideRewrite(metrics, options.complexitySensitivity);
  return {
    retry: decision.rewrite,
    signals: decision.signals,
    metrics,
    findings: findingsFor(metrics),
  };
}
