import styleCueData from "../../data/ai-style-cues.json" with { type: "json" };

export type StyleCueMatch = {
  cue: string;
  count: number;
  guidance: string;
};

// These source-derived phrases can be recorded as weak evidence with an exact match.
// A match is not a rewrite decision, and context-dependent source entries remain data only.
const LITERAL_CUE_ALLOWLIST = new Set([
  "at the end of the day",
  "field notes from the frontier",
  "first wave of a multi-year transition",
  "here's where it gets interesting",
  "i can't stop thinking about",
  "lean into",
  "load-bearing",
  "paradigm shift",
  "that's the whole game",
  "the whole game",
  "worth sitting with",
  "worth talking about",
]);

const literalCues = new Map<string, string>();
for (const entry of styleCueData.entries) {
  const candidates = entry.cue.match(/"([^"]+)"/g)
    ?.map((value) => value.slice(1, -1).toLowerCase()) ?? [];
  for (const cue of candidates) {
    if (LITERAL_CUE_ALLOWLIST.has(cue)) literalCues.set(cue, entry.guidance);
  }
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchStyleCues(text: string): StyleCueMatch[] {
  const lower = text.toLowerCase();
  return [...literalCues].flatMap(([cue, guidance]) => {
    const matches = lower.match(new RegExp(`(?<![a-z0-9])${escaped(cue)}(?![a-z0-9])`, "g"));
    return matches === null ? [] : [{ cue, count: matches.length, guidance }];
  });
}
