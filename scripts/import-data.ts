import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

type SourceName = "style" | "conversation" | "web" | "concreteness" | "glossary";

type SourceDefinition = {
  localName: string;
  url: string;
  sha256: string;
};

const sources: Record<SourceName, SourceDefinition> = {
  style: {
    localName: "ai-style-cues.md",
    url: "https://claudisms.ai/claudisms.md",
    sha256: "f4a09fa849b61712838d3e56c854ddf37a59417823acb348a330721615f73b2b",
  },
  conversation: {
    localName: "conversational-word-frequencies.json",
    url: "https://cdn.jsdelivr.net/npm/subtlex-word-frequencies@2.0.0/index.json",
    sha256: "271c5a5fbf332f60762cfa34b11394427c220099d96c589751b6bc77e5b32c1a",
  },
  web: {
    localName: "broad-web-word-counts.txt",
    url: "https://norvig.com/ngrams/count_1w.txt",
    sha256: "51df159fd3de12b20e403c108f526e96dbd723d9cabdd5f17955cdc16059e690",
  },
  concreteness: {
    localName: "concreteness-ratings.tsv",
    url: "https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt",
    sha256: "0b4082dbd38585b0ee1fd258145b7a50592f8d0d98e5fc6b6844ceef3cd8ecc8",
  },
  glossary: {
    localName: "computing-glossary.yml",
    url: "https://raw.githubusercontent.com/carpentries/glosario/a4a774b6dea3881a7794d63aee10fbb5d34321d1/glossary.yml",
    sha256: "93a6371add7275d643cacb060ae0b65749d1ffdff329064feeaeaf7152c3715f",
  },
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const sourceDirectory = argument("--source-dir");

async function loadSource(name: SourceName): Promise<string> {
  const definition = sources[name];
  const content = sourceDirectory === undefined
    ? await fetch(definition.url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not fetch ${definition.url}: ${response.status}`);
      return response.text();
    })
    : await readFile(resolve(sourceDirectory, definition.localName), "utf8");
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== definition.sha256) throw new Error(`${name} source SHA-256 changed: ${actual}`);
  return content;
}

function dataset(source: SourceName, entries: unknown) {
  return { schemaVersion: 1, sourceSha256: sources[source].sha256, entries };
}

function styleEntries(markdown: string) {
  let category = "";
  const entries: Array<{ category: string; cue: string; context?: string; guidance: string }> = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      category = line.slice(3).trim();
      continue;
    }
    const match = /^- \*\*(.+?)\*\*(.*?)\s+-\s+(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      const context = match[2].trim().replace(/^\((.*)\)$/, "$1");
      entries.push({
        category,
        cue: match[1],
        ...(context.length === 0 ? {} : { context }),
        guidance: match[3],
      });
    }
  }
  return entries;
}

function conversationalEntries(text: string): Array<[string, number]> {
  const rows = JSON.parse(text) as Array<{ word?: unknown; count?: unknown; value?: unknown }>;
  return rows.flatMap(({ word, count, value }) => {
    const frequency = Number(count ?? value);
    return typeof word === "string" && Number.isFinite(frequency) ? [[word.toLowerCase(), frequency]] : [];
  });
}

function webEntries(text: string): Array<[string, number]> {
  return text.trim().split(/\r?\n/).flatMap((line) => {
    const [word, rawCount] = line.split("\t");
    const count = Number(rawCount);
    return word !== undefined && Number.isFinite(count) ? [[word.toLowerCase(), count]] : [];
  });
}

function concretenessEntries(text: string): Array<[string, number]> {
  const [header, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const columns = header?.split("\t") ?? [];
  const wordIndex = columns.indexOf("Word");
  const ratingIndex = columns.indexOf("Conc.M");
  if (wordIndex < 0 || ratingIndex < 0) throw new Error("Concreteness source is missing Word or Conc.M");
  return lines.flatMap((line) => {
    const values = line.split("\t");
    const word = values[wordIndex];
    const rating = Number(values[ratingIndex]);
    return word !== undefined && Number.isFinite(rating) ? [[word.toLowerCase(), rating]] : [];
  });
}

function technicalTerms(text: string): string[] {
  const rows = parse(text) as unknown;
  if (!Array.isArray(rows)) throw new Error("Computing glossary must contain a top-level sequence");
  return [...new Set(rows.flatMap((row) => {
    const term = (row as { en?: { term?: unknown } }).en?.term;
    if (typeof term !== "string") return [];
    const words = term.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.map((word) => word.toLowerCase()) ?? [];
    return words.length === 0 ? [] : [words.join(" ")];
  }))].sort();
}

const [style, conversation, web, concreteness, glossary] = await Promise.all([
  loadSource("style"),
  loadSource("conversation"),
  loadSource("web"),
  loadSource("concreteness"),
  loadSource("glossary"),
]);

const outputs = {
  "ai-style-cues.json": dataset("style", styleEntries(style)),
  "conversational-word-frequencies.json": dataset("conversation", conversationalEntries(conversation)),
  "broad-web-word-counts.json": dataset("web", webEntries(web)),
  "concreteness-ratings.json": dataset("concreteness", concretenessEntries(concreteness)),
  "technical-terms.json": dataset("glossary", technicalTerms(glossary)),
};

await mkdir(resolve("data"), { recursive: true });
for (const [name, value] of Object.entries(outputs)) {
  await writeFile(resolve("data", name), `${JSON.stringify(value)}\n`);
}
console.log(`Imported ${Object.keys(outputs).length} normalized datasets`);
