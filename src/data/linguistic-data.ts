import broadFrequencyData from "../../data/broad-web-word-counts.json" with { type: "json" };
import concretenessData from "../../data/concreteness-ratings.json" with { type: "json" };
import conversationalFrequencyData from "../../data/conversational-word-frequencies.json" with { type: "json" };

function numericMap(entries: Array<Array<string | number>>): ReadonlyMap<string, number> {
  return new Map(entries.flatMap((entry) => {
    const [word, value] = entry;
    return typeof word === "string" && typeof value === "number" ? [[word, value] as const] : [];
  }));
}

function total(values: ReadonlyMap<string, number>): number {
  let result = 0;
  for (const value of values.values()) result += value;
  return result;
}

export const concretenessRatings = numericMap(concretenessData.entries);

const conversationalFrequencies = numericMap(conversationalFrequencyData.entries);
const broadFrequencies = numericMap(broadFrequencyData.entries);
const conversationalTotal = total(conversationalFrequencies);
const broadTotal = total(broadFrequencies);

function zipf(count: number, corpusTotal: number): number {
  if (count <= 0 || corpusTotal <= 0) return 0;
  return Math.log10(count / corpusTotal * 1_000_000_000);
}

export function conversationalZipf(word: string): number {
  return zipf(conversationalFrequencies.get(word) ?? 0, conversationalTotal);
}

export function broadZipf(word: string): number {
  return zipf(broadFrequencies.get(word) ?? 0, broadTotal);
}
