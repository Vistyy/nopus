import { evaluateProse, type ProseEvaluation } from "../evaluate-prose.js";
import type { ComplexitySensitivity } from "../policy/decide-rewrite.js";

export type StopHookInput = {
  hook_event_name?: unknown;
  last_assistant_message?: unknown;
  stop_hook_active?: unknown;
};

export type StopHookOutput = Record<string, never> | {
  decision: "block";
  reason: string;
};

function evidenceFor(evaluation: ProseEvaluation): string[] {
  const includeAbstract = evaluation.signals.some((signal) =>
    signal === "sustained-abstractness" || signal === "combined-complexity" || signal === "concentrated-complexity" ||
    signal === "pervasive-complexity"
  );
  const includeStacks = evaluation.signals.some((signal) =>
    signal === "combined-complexity" || signal === "stacked-phrasing" || signal === "concentrated-complexity"
  );
  const includeStyle = evaluation.signals.includes("style-cues");
  return evaluation.findings.flatMap(({ kind, text, detail }) => {
    if (kind === "high-abstractness-sentence" && includeAbstract) {
      return [`- ${JSON.stringify(text)} relies heavily on abstract wording.`];
    }
    if (kind === "abstract-noun-stack" && includeStacks) {
      return [`- ${JSON.stringify(text)} compresses several ideas into one phrase.`];
    }
    if (kind === "style-cue" && includeStyle) {
      const guidance = detail.replace(/^\d+ occurrences?\.\s*/, "").split(/(?<=[.!?])\s/, 1)[0];
      return [`- ${JSON.stringify(text)}: ${guidance}`];
    }
    return [];
  }).slice(0, 3);
}

export function buildRewriteInstruction(evaluation: ProseEvaluation, includeEvidence: boolean): string {
  const areas = new Set<string>();
  for (const signal of evaluation.signals) {
    if (signal === "sustained-abstractness" || signal === "combined-complexity" || signal === "concentrated-complexity" ||
      signal === "pervasive-complexity") {
      areas.add("Use more concrete, direct phrasing.");
    }
    if (signal === "combined-complexity" || signal === "stacked-phrasing" || signal === "concentrated-complexity") {
      areas.add("Unpack dense phrases.");
    }
    if (signal === "combined-complexity" || signal === "concentrated-complexity" || signal === "pervasive-complexity") {
      areas.add("Prefer familiar wording where it preserves precision.");
    }
    if (signal === "style-cues") areas.add("Replace formulaic framing with plain statements.");
  }
  const evidence = includeEvidence ? evidenceFor(evaluation) : [];
  return [
    "Rewrite the response for clarity and directness.",
    "Keep its meaning and necessary detail.",
    "Return only the revised response.",
    ...(areas.size === 0 ? [] : ["", "Focus on these areas:", ...[...areas].map((area) => `- ${area}`)]),
    ...(evidence.length === 0 ? [] : ["", "Examples from the response:", ...evidence]),
  ].join("\n");
}

export function handleStop(
  input: StopHookInput,
  complexitySensitivity: ComplexitySensitivity = "low",
  includeEvidence = true,
): StopHookOutput {
  if (input.hook_event_name !== "Stop" || input.stop_hook_active === true) return {};
  if (typeof input.last_assistant_message !== "string") return {};
  const evaluation = evaluateProse(input.last_assistant_message, { complexitySensitivity });
  return evaluation.retry
    ? { decision: "block", reason: buildRewriteInstruction(evaluation, includeEvidence) }
    : {};
}
