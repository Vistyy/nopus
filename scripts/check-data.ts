import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedCounts = {
  "ai-style-cues.json": 120,
  "broad-web-word-counts.json": 333_333,
  "concreteness-ratings.json": 39_954,
  "conversational-word-frequencies.json": 74_286,
  "technical-terms.json": 632,
};

for (const [name, expectedCount] of Object.entries(expectedCounts)) {
  const value = JSON.parse(await readFile(resolve("data", name), "utf8")) as {
    schemaVersion?: unknown;
    sourceSha256?: unknown;
    entries?: unknown;
  };
  if (value.schemaVersion !== 1 || typeof value.sourceSha256 !== "string" || !Array.isArray(value.entries)) {
    throw new Error(`${name} does not satisfy the normalized dataset envelope`);
  }
  if (value.entries.length !== expectedCount) {
    throw new Error(`${name} contains ${value.entries.length} entries; expected ${expectedCount}`);
  }
}

console.log(`Verified ${Object.keys(expectedCounts).length} normalized datasets`);
