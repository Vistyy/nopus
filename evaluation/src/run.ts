import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { measureProse } from "../../src/analysis/measure-prose.js";
import { shouldRewrite } from "../../src/policy/decide-rewrite.js";

type Baseline = {
  message_id: string;
  text: string;
  uncommon_ratio: number;
  abstract_ratio: number;
  eligible_sentence_count: number;
  high_abstract_sentence_count: number;
  max_sentence_abstract_ratio: number;
  max_abstract_word_run: number;
  noun_stack_count: number;
  phrase_load_per_100_words: number;
  findings: Array<{ kind: string; text: string; detail: string }>;
  would_retry: boolean;
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function loadConcreteness(path: string): Promise<Map<string, number>> {
  const values = new Map<string, number>();
  const [header, ...lines] = (await readFile(path, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/);
  const columns = header?.split("\t") ?? [];
  const wordIndex = columns.indexOf("Word");
  const ratingIndex = columns.indexOf("Conc.M");
  if (wordIndex < 0 || ratingIndex < 0) throw new Error("Concreteness data is missing Word or Conc.M columns");
  for (const line of lines) {
    const columns = line.split("\t");
    const word = columns[wordIndex];
    const rating = Number(columns[ratingIndex]);
    if (word && Number.isFinite(rating)) values.set(word.toLowerCase(), rating);
  }
  return values;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

// Preserve the experiment's three decision branches so this comparison isolates
// the NLP and dataset migration from later production policy changes.
function legacyRetry(metrics: ReturnType<typeof measureProse>): boolean {
  return (
    metrics.eligibleSentenceCount >= 3 &&
    metrics.highAbstractSentenceRatio >= 0.35 &&
    metrics.maxSentenceAbstractRatio >= 0.65
  ) || (
    metrics.uncommonRatio >= 0.18 &&
    metrics.abstractRatio >= 0.42 &&
    metrics.nounStackCount >= 2 &&
    metrics.phraseLoadPer100Words >= 2
  ) || (
    metrics.abstractRatio >= 0.52 &&
    metrics.nounStackCount >= 4 &&
    metrics.phraseLoadPer100Words >= 3
  );
}

const baselinePath = resolve(argument("--baseline") ?? "../../.pi/agent/scratch/prose-complexity/output/analysis.jsonl");
const concretenessPath = resolve(argument("--concreteness") ?? "../../.pi/agent/scratch/prose-complexity/.cache/concreteness.tsv");
const outputPath = resolve(argument("--output") ?? "tmp/wink-parity.json");
const reportPath = resolve(argument("--report") ?? "tmp/wink-parity-changes.md");

const baselines = (await readFile(baselinePath, "utf8"))
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line) as Baseline);
const concreteness = await loadConcreteness(concretenessPath);

const comparisons = baselines.map((baseline) => {
  const wink = measureProse(baseline.text, concreteness);
  const parityRetry = legacyRetry(wink);
  const productionRetry = shouldRewrite(wink, "low");
  return {
    messageId: baseline.message_id,
    text: baseline.text,
    baseline: {
      uncommonRatio: baseline.uncommon_ratio,
      abstractRatio: baseline.abstract_ratio,
      eligibleSentenceCount: baseline.eligible_sentence_count,
      highAbstractSentenceCount: baseline.high_abstract_sentence_count,
      maxSentenceAbstractRatio: baseline.max_sentence_abstract_ratio,
      maxAbstractWordRun: baseline.max_abstract_word_run,
      nounStackCount: baseline.noun_stack_count,
      phraseLoadPer100Words: baseline.phrase_load_per_100_words,
      findings: baseline.findings,
      wouldRetry: baseline.would_retry,
    },
    wink: { ...wink, parityRetry, productionRetry },
  };
});

const parityChanged = comparisons.filter(({ baseline, wink }) => baseline.wouldRetry !== wink.parityRetry);
const productionChanged = comparisons.filter(({ baseline, wink }) => baseline.wouldRetry !== wink.productionRetry);
const reviewCases = comparisons.filter(({ baseline, wink }) =>
  baseline.wouldRetry !== wink.parityRetry || baseline.wouldRetry !== wink.productionRetry
);
const summary = {
  responses: comparisons.length,
  baselineFlagged: comparisons.filter(({ baseline }) => baseline.wouldRetry).length,
  parity: {
    decisionAgreement: 1 - parityChanged.length / Math.max(1, comparisons.length),
    winkFlagged: comparisons.filter(({ wink }) => wink.parityRetry).length,
    changedToFlagged: parityChanged.filter(({ wink }) => wink.parityRetry).map(({ messageId }) => messageId),
    changedToAccepted: parityChanged.filter(({ wink }) => !wink.parityRetry).map(({ messageId }) => messageId),
  },
  production: {
    decisionAgreement: 1 - productionChanged.length / Math.max(1, comparisons.length),
    winkFlagged: comparisons.filter(({ wink }) => wink.productionRetry).length,
    changedToFlagged: productionChanged.filter(({ wink }) => wink.productionRetry).map(({ messageId }) => messageId),
    changedToAccepted: productionChanged.filter(({ wink }) => !wink.productionRetry).map(({ messageId }) => messageId),
  },
  meanAbsoluteDifference: {
    uncommonRatio: mean(comparisons.map(({ baseline, wink }) => Math.abs(baseline.uncommonRatio - wink.uncommonRatio))),
    abstractRatio: mean(comparisons.map(({ baseline, wink }) => Math.abs(baseline.abstractRatio - wink.abstractRatio))),
    eligibleSentenceCount: mean(comparisons.map(({ baseline, wink }) => Math.abs(baseline.eligibleSentenceCount - wink.eligibleSentenceCount))),
    highAbstractSentenceCount: mean(comparisons.map(({ baseline, wink }) => Math.abs(baseline.highAbstractSentenceCount - wink.highAbstractSentenceCount))),
    nounStackCount: mean(comparisons.map(({ baseline, wink }) => Math.abs(baseline.nounStackCount - wink.nounStackCount))),
  },
};

function winkFindings(wink: (typeof comparisons)[number]["wink"]): string[] {
  return [
    ...wink.sentences
      .filter(({ abstractRatio }) => abstractRatio >= 0.55)
      .sort((left, right) => right.abstractRatio - left.abstractRatio)
      .slice(0, 4)
      .map(({ text, abstractRatio, longestRun }) => `- **high-abstractness-sentence:** ${JSON.stringify(text)} - ${(abstractRatio * 100).toFixed(0)}% abstract rated words; longest abstract run ${longestRun}`),
    ...wink.stacks.slice(0, 5).map((stack) => `- **abstract-noun-stack:** ${JSON.stringify(stack)}`),
  ];
}

const report = [
  "# winkNLP changed decisions",
  "",
  `With the same three-branch policy, Python and winkNLP disagree on ${parityChanged.length} of ${comparisons.length} responses.`,
  `The production low-sensitivity policy differs from the Python baseline on ${productionChanged.length} responses.`,
  `Their union contains ${reviewCases.length} responses for human review.`,
  "",
  ...reviewCases.flatMap(({ messageId, text, baseline, wink }, index) => {
    const findings = winkFindings(wink);
    return [
      `## ${index + 1}. \`${messageId}\``,
      "",
      `- Python baseline: ${baseline.highAbstractSentenceCount}/${baseline.eligibleSentenceCount} high-abstractness sentences; ${baseline.nounStackCount} noun stacks; retry ${baseline.wouldRetry ? "yes" : "no"}.`,
      `- Same-policy winkNLP: ${wink.highAbstractSentenceCount}/${wink.eligibleSentenceCount} high-abstractness sentences; ${wink.nounStackCount} noun stacks; retry ${wink.parityRetry ? "yes" : "no"}.`,
      `- Production low sensitivity: retry ${wink.productionRetry ? "yes" : "no"}.`,
      "",
      "### Response",
      "",
      text,
      "",
      "### Python findings",
      "",
      ...(baseline.findings.length > 0
        ? baseline.findings.map(({ kind, text: finding, detail }) => `- **${kind}:** ${JSON.stringify(finding)} - ${detail}`)
        : ["- None."]),
      "",
      "### winkNLP findings",
      "",
      ...(findings.length > 0 ? findings : ["- None."]),
      "",
    ];
  }),
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ summary, comparisons }, null, 2)}\n`);
await writeFile(reportPath, `${report}\n`);
console.log(JSON.stringify({ ...summary, report: reportPath }, null, 2));
