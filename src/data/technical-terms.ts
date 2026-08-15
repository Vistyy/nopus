import technicalTermData from "../../data/technical-terms.json" with { type: "json" };

const termsByFirstWord = new Map<string, string[][]>();
for (const term of technicalTermData.entries) {
  const words = term.split(" ");
  const first = words[0];
  if (first === undefined) continue;
  const matches = termsByFirstWord.get(first) ?? [];
  matches.push(words);
  termsByFirstWord.set(first, matches);
}

export function matchedTechnicalWordIndexes(tokens: readonly string[]): ReadonlySet<number> {
  const normalized = tokens.map((token) => token.toLowerCase());
  const matched = new Set<number>();
  for (let start = 0; start < normalized.length; start += 1) {
    const first = normalized[start];
    if (first === undefined) continue;
    for (const term of termsByFirstWord.get(first) ?? []) {
      if (!term.every((word, offset) => normalized[start + offset] === word)) continue;
      for (let offset = 0; offset < term.length; offset += 1) matched.add(start + offset);
    }
  }
  return matched;
}

export function matchedTechnicalWords(tokens: readonly string[]): ReadonlySet<string> {
  const indexes = matchedTechnicalWordIndexes(tokens);
  return new Set([...indexes].flatMap((index) => {
    const token = tokens[index];
    return token === undefined ? [] : [token.toLowerCase()];
  }));
}
