import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { broadZipf, concretenessRatings, conversationalZipf } from "../data/linguistic-data.js";
import { matchStyleCues, type StyleCueMatch } from "../data/style-cues.js";
import { matchedTechnicalWords } from "../data/technical-terms.js";

const nlp = winkNLP(model);
const { its } = nlp;

const STOPWORDS = new Set(`
a an and are as at be because been being but by can could did do does doing done for
from had has have having he her hers herself him himself his how i if in into is it
its itself may me might mine more most must my myself no nor not of on once only or
other ought our ours ourselves out over own same she should so some such than that
the their theirs them themselves then there these they this those through to too
under until up very was we were what when where which while who whom why will with
would you your yours yourself yourselves
`.trim().split(/\s+/));

const FENCE_RE = /```.*?```|~~~.*?~~~/gs;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const PATH_RE = /(?<!\w)(?:[.~]?\/)?(?:[\w.-]+\/)+[\w.-]+/g;
const MARKUP_RE = /^\s{0,3}(?:#{1,6}|>|[-*+]\s|\d+[.)]\s)/gm;

type Pos = "ADJ" | "ADP" | "ADV" | "AUX" | "CCONJ" | "DET" | "INTJ" | "NOUN" | "NUM" | "PART" | "PRON" | "PROPN" | "PUNCT" | "SCONJ" | "SYM" | "VERB" | "X" | "SPACE";

type LexicalToken = {
  original: string;
  lemma: string;
  pos: Pos;
};

export type ProseMetrics = {
  rawConversationallyRareRatio: number;
  uncommonRatio: number;
  veryUncommonRatio: number;
  technicalDownweightedRatio: number;
  abstractRatio: number;
  concretenessCoverage: number;
  eligibleSentenceCount: number;
  highAbstractSentenceCount: number;
  highAbstractSentenceRatio: number;
  maxSentenceAbstractRatio: number;
  maxAbstractWordRun: number;
  nounStackCount: number;
  phraseLoadPer100Words: number;
  styleCueCount: number;
  styleCueLoadPer100Words: number;
  lexicalWordCount: number;
  sentences: Array<{ text: string; abstractRatio: number; longestRun: number }>;
  stacks: string[];
  styleCues: StyleCueMatch[];
};

export function stripNonprose(text: string): string {
  const stripped = text
    .replace(FENCE_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(URL_RE, " ")
    .replace(PATH_RE, " ");
  return stripped
    .split("\n")
    .map((line) => line.includes("|") ? " " : line)
    .join("\n")
    .replace(MARKUP_RE, "");
}

function obviousIdentifier(token: string): boolean {
  return (token.length > 1 && token === token.toUpperCase()) ||
    /[a-z][A-Z]|[A-Z].*[A-Z]/.test(token) ||
    token.includes("_");
}

function lexicalTokens(values: string[], lemmas: string[], poses: Pos[], types: string[]): LexicalToken[] {
  const result: LexicalToken[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const original = values[index];
    const lemma = lemmas[index];
    const pos = poses[index];
    const type = types[index];
    if (original === undefined || lemma === undefined || pos === undefined || type !== "word") continue;
    const lower = original.toLowerCase();
    if (lower.length < 3 || STOPWORDS.has(lower) || obviousIdentifier(original) || /^[A-Z]/.test(original)) continue;
    result.push({ original, lemma: lemma.toLowerCase(), pos });
  }
  return result;
}

function tokensFromText(text: string): LexicalToken[] {
  const tokens = nlp.readDoc(text).tokens();
  return lexicalTokens(
    tokens.out() as string[],
    tokens.out(its.lemma as never) as string[],
    tokens.out(its.pos) as Pos[],
    tokens.out(its.type) as string[],
  );
}

function wordValues(text: string): string[] {
  const tokens = nlp.readDoc(text).tokens();
  const values = tokens.out() as string[];
  const types = tokens.out(its.type) as string[];
  return values.filter((_, index) => types[index] === "word");
}

function rarityProfile(text: string, lexical: LexicalToken[]) {
  const technicalWords = matchedTechnicalWords(wordValues(text));
  let rawRareCount = 0;
  let uncommonCount = 0;
  let veryUncommonCount = 0;
  let technicalCount = 0;
  for (const { lemma } of lexical) {
    const conversationalFrequency = conversationalZipf(lemma);
    const isRare = conversationalFrequency < 3.7;
    if (isRare) rawRareCount += 1;
    if (isRare && technicalWords.has(lemma)) {
      technicalCount += 1;
      continue;
    }
    if (isRare) uncommonCount += 1;
    if (conversationalFrequency < 2.8 && broadZipf(lemma) < 3.8) veryUncommonCount += 1;
  }
  const count = Math.max(1, lexical.length);
  return {
    rawConversationallyRareRatio: rawRareCount / count,
    uncommonRatio: uncommonCount / count,
    veryUncommonRatio: veryUncommonCount / count,
    technicalDownweightedRatio: technicalCount / count,
  };
}

function sentenceProfile(text: string, concreteness: ReadonlyMap<string, number>) {
  const lexical = tokensFromText(text);
  const ratings = lexical.flatMap(({ lemma }) => {
    const rating = concreteness.get(lemma);
    return rating === undefined ? [] : [rating];
  });
  if (ratings.length < 4 || ratings.length / Math.max(1, lexical.length) < 0.5) return undefined;
  let longestRun = 0;
  let currentRun = 0;
  for (const { lemma } of lexical) {
    const rating = concreteness.get(lemma);
    if (rating !== undefined && rating <= 2.5) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return {
    text,
    abstractRatio: ratings.filter((rating) => rating <= 2.5).length / ratings.length,
    longestRun,
  };
}

function nounStacks(text: string, concreteness: ReadonlyMap<string, number>): string[] {
  const tokens = nlp.readDoc(text).tokens();
  const values = tokens.out() as string[];
  const poses = tokens.out(its.pos) as Pos[];
  const types = tokens.out(its.type) as string[];
  const stacks: string[] = [];
  let current: Array<{ value: string; pos: Pos }> = [];

  const flush = () => {
    if (current.length >= 3 && current.filter(({ pos }) => pos === "NOUN").length >= 2) {
      const ratings = current.flatMap(({ value }) => {
        const rating = concreteness.get(value.toLowerCase());
        return rating === undefined ? [] : [rating];
      });
      if (ratings.length === 0 || ratings.reduce((sum, value) => sum + value, 0) / ratings.length <= 3) {
        stacks.push(current.map(({ value }) => value).join(" "));
      }
    }
    current = [];
  };

  const eligibleWord = (index: number): { value: string; pos: Pos } | undefined => {
    const value = values[index];
    const pos = poses[index];
    const type = types[index];
    const lower = value?.toLowerCase() ?? "";
    if (value === undefined || pos === undefined || type !== "word" ||
      (pos !== "NOUN" && pos !== "ADJ") || lower.length < 3 || STOPWORDS.has(lower) || /^[A-Z]/.test(value)) {
      return undefined;
    }
    return { value, pos };
  };

  for (let index = 0; index <= values.length; index += 1) {
    const word = eligibleWord(index);
    if (word !== undefined) {
      current.push(word);
      continue;
    }
    const bridgesCompound = (values[index] === "-" || values[index] === "–" || values[index] === "—") &&
      current.length > 0 && eligibleWord(index + 1) !== undefined;
    if (!bridgesCompound) flush();
  }
  return stacks;
}

export function measureProse(
  text: string,
  concreteness: ReadonlyMap<string, number> = concretenessRatings,
): ProseMetrics {
  const prose = stripNonprose(text);
  const lexical = tokensFromText(prose);
  const rarity = rarityProfile(prose, lexical);
  const concreteValues = lexical.flatMap(({ lemma }) => {
    const rating = concreteness.get(lemma);
    return rating === undefined ? [] : [rating];
  });
  const sentences = (nlp.readDoc(prose).sentences().out() as string[])
    .map((sentence) => sentenceProfile(sentence, concreteness))
    .filter((profile): profile is NonNullable<typeof profile> => profile !== undefined);
  const high = sentences.filter(({ abstractRatio }) => abstractRatio >= 0.55);
  const stacks = nounStacks(prose, concreteness);
  const stackWeight = stacks.reduce((sum, stack) => sum + 1 + 0.5 * Math.max(0, stack.split(/\s+/).length - 3), 0);
  const styleCues = matchStyleCues(prose);
  const styleCueOccurrences = styleCues.reduce((sum, { count }) => sum + count, 0);
  const styleCueCount = styleCues.length;
  const lexicalWordCount = lexical.length;
  return {
    ...rarity,
    abstractRatio: concreteValues.length === 0 ? 0 : concreteValues.filter((rating) => rating <= 2.5).length / concreteValues.length,
    concretenessCoverage: concreteValues.length / Math.max(1, lexicalWordCount),
    eligibleSentenceCount: sentences.length,
    highAbstractSentenceCount: high.length,
    highAbstractSentenceRatio: high.length / Math.max(1, sentences.length),
    maxSentenceAbstractRatio: Math.max(0, ...sentences.map(({ abstractRatio }) => abstractRatio)),
    maxAbstractWordRun: Math.max(0, ...sentences.map(({ longestRun }) => longestRun)),
    nounStackCount: stacks.length,
    phraseLoadPer100Words: stackWeight / Math.max(1, lexicalWordCount) * 100,
    styleCueCount,
    styleCueLoadPer100Words: styleCueOccurrences / Math.max(1, lexicalWordCount) * 100,
    lexicalWordCount,
    sentences,
    stacks,
    styleCues,
  };
}
