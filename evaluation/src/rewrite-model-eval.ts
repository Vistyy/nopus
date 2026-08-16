import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";
import { evaluateProse, type ProseEvaluation } from "../../src/evaluate-prose.js";
import { buildRewriteInstruction } from "../../src/hook/handle-stop.js";

type JsonObject = Record<string, unknown>;
type HistoricalTurn = {
  id: string;
  context: JsonObject[];
  original: string;
  evaluation: ProseEvaluation;
};
type RewriteResult = {
  text: string;
  stopReason: string;
  usage: unknown;
  milliseconds: number;
  evaluation: ProseEvaluation;
};

const DEFAULT_SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
const DEFAULT_MODEL = "openai-codex/gpt-5.6-luna";
const SAMPLE_SIZE = 4;
const CANDIDATE_POOL_SIZE = 12;
const NOPUS_CUSTOM_TYPE = "nopus-rewrite";
const HIDDEN_RESPONSE_MARKER = "<!-- nopus:hidden-original-response -->\n";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function stateHome(): string {
  const configured = process.env.XDG_STATE_HOME?.trim();
  if (!configured) return join(homedir(), ".local", "state");
  if (!isAbsolute(configured)) throw new Error("XDG_STATE_HOME must be an absolute path.");
  return configured;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visibleText(message: unknown): string | undefined {
  if (!isObject(message)) return undefined;
  if (typeof message.content === "string") return message.content.trim() || undefined;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content.flatMap((block) => {
    if (!isObject(block)) return [];
    if (block.type === "text" && typeof block.text === "string") {
      return [block.text.startsWith(HIDDEN_RESPONSE_MARKER)
        ? block.text.slice(HIDDEN_RESPONSE_MARKER.length)
        : block.text];
    }
    if (block.type === "toolCall" && typeof block.name === "string") return [`[Called tool: ${block.name}]`];
    return [];
  }).join("\n").trim();
  return text || undefined;
}

function completedAssistantText(message: unknown): string | undefined {
  if (!isObject(message) || message.role !== "assistant" || message.stopReason !== "stop" || !Array.isArray(message.content)) {
    return undefined;
  }
  if (message.content.some((block) => isObject(block) && block.type === "toolCall")) return undefined;
  return visibleText(message);
}

function cleanMessage(message: JsonObject): JsonObject {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((block) => {
      if (!isObject(block) || block.type !== "text" || typeof block.text !== "string" ||
          !block.text.startsWith(HIDDEN_RESPONSE_MARKER)) return block;
      return { ...block, text: block.text.slice(HIDDEN_RESPONSE_MARKER.length) };
    }),
  };
}

async function sessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

function branchContext(entries: Map<string, JsonObject>, targetId: string): JsonObject[] | undefined {
  const branch: JsonObject[] = [];
  let id: string | undefined = targetId;
  while (id !== undefined) {
    const entry = entries.get(id);
    if (entry === undefined) return undefined;
    branch.push(entry);
    id = typeof entry.parentId === "string" ? entry.parentId : undefined;
  }
  branch.reverse();

  const messages: JsonObject[] = [];
  for (const entry of branch) {
    if (entry.type === "message" && isObject(entry.message) &&
        (entry.message.role === "user" || entry.message.role === "assistant" || entry.message.role === "toolResult")) {
      messages.push(cleanMessage(entry.message));
      continue;
    }
    if (entry.type === "custom_message" && entry.customType === NOPUS_CUSTOM_TYPE) continue;
    if (entry.type === "custom_message" || entry.type === "compaction" || entry.type === "branch_summary") return undefined;
  }
  return messages;
}

async function turnsFromSession(path: string): Promise<HistoricalTurn[]> {
  const entries = new Map<string, JsonObject>();
  const nopusTurn = new Map<string, boolean>();
  const candidates: Array<{ id: string; message: JsonObject }> = [];
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as unknown;
    if (!isObject(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id : undefined;
    const parentId = typeof entry.parentId === "string" ? entry.parentId : undefined;
    const startsNopusTurn = entry.type === "custom_message" && entry.customType === NOPUS_CUSTOM_TYPE;
    const inheritedNopusTurn = parentId !== undefined && nopusTurn.get(parentId) === true;
    const isUser = entry.type === "message" && isObject(entry.message) && entry.message.role === "user";
    const inNopusTurn = isUser ? false : startsNopusTurn || inheritedNopusTurn;
    if (id !== undefined) {
      entries.set(id, entry);
      nopusTurn.set(id, inNopusTurn);
    }
    if (!inNopusTurn && id !== undefined && entry.type === "message" && isObject(entry.message) &&
        completedAssistantText(entry.message) !== undefined) {
      candidates.push({ id, message: entry.message });
    }
  }

  const turns: HistoricalTurn[] = [];
  for (const candidate of candidates) {
    const original = completedAssistantText(candidate.message);
    if (original === undefined || original.length > 12_000) continue;
    const evaluation = evaluateProse(original, { complexitySensitivity: "medium" });
    if (!evaluation.retry) continue;
    const context = branchContext(entries, candidate.id);
    if (context === undefined || context.length < 2 || JSON.stringify(context).length > 100_000) continue;
    turns.push({
      id: createHash("sha256").update(path).update("\0").update(candidate.id).digest("hex").slice(0, 16),
      context: context.slice(0, -1),
      original,
      evaluation,
    });
  }
  return turns;
}

function selectTurns(turns: HistoricalTurn[]): HistoricalTurn[] {
  const unique = new Map<string, HistoricalTurn>();
  for (const turn of turns) {
    const key = createHash("sha256").update(turn.original).digest("hex");
    if (!unique.has(key)) unique.set(key, turn);
  }
  const ordered = [...unique.values()].sort((left, right) => {
    const leftWords = left.original.split(/\s+/).length;
    const rightWords = right.original.split(/\s+/).length;
    return leftWords - rightWords || left.id.localeCompare(right.id);
  });
  if (ordered.length < CANDIDATE_POOL_SIZE) throw new Error(`Only ${ordered.length} eligible historical turns were found.`);
  return Array.from({ length: CANDIDATE_POOL_SIZE }, (_, index) =>
    ordered[Math.round(index * (ordered.length - 1) / (CANDIDATE_POOL_SIZE - 1))]!
  );
}

function outputText(message: { content: unknown }): string {
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((block) =>
    isObject(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []
  ).join("\n").trim();
}

async function privateWrite(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function reviewMessage(message: JsonObject): string {
  const role = message.role === "toolResult" ? "Tool result" : message.role === "assistant" ? "Assistant" : "User";
  return `#### ${role}\n\n${visibleText(message) ?? "[No text]"}`;
}

async function main(): Promise<void> {
  const sessionsRoot = resolve(argument("--sessions") ?? DEFAULT_SESSIONS_ROOT);
  const evaluationRoot = resolve(argument("--root") ?? join(stateHome(), "nopus", "evaluation", "pi-corpus", "v1", "rewrite-model-eval"));
  const modelName = argument("--model") ?? DEFAULT_MODEL;
  const root = join(evaluationRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  const runtime = await ModelRuntime.create();
  const resolved = resolveCliModel({ cliModel: modelName, cliThinking: "medium", modelRuntime: runtime });
  if (resolved.error || resolved.model === undefined) throw new Error(resolved.error ?? `Could not resolve ${modelName}.`);
  if (await runtime.getAuth(resolved.model) === undefined) throw new Error(`No authentication is available for ${modelName}.`);
  const model = resolved.model;
  const turns = selectTurns((await Promise.all(
    (await sessionFiles(sessionsRoot)).map(turnsFromSession),
  )).flat());

  const manifest = {
    schemaVersion: 3,
    startedAt: new Date().toISOString(),
    model: `${model.provider}/${model.id}`,
    thinking: "medium",
    sessionsRootHash: createHash("sha256").update(sessionsRoot).digest("hex"),
    selected: [] as JsonObject[],
  };
  const resultsPath = join(root, "results.jsonl");
  let review = "# Nopus rewrite review\n\nThe labels are randomized.\nJudge each rewrite as an initial answer using the available conversation branch.\n\n";
  const summary = {
    attemptedContexts: 0,
    generatedComplexResponses: 0,
    acceptedByMediumPolicy: { normal: 0, extraSimple: 0 },
  };

  for (const turn of turns) {
    if (summary.generatedComplexResponses >= SAMPLE_SIZE) break;
    summary.attemptedContexts += 1;
    const generatedOriginal = await runtime.completeSimple(model, {
      systemPrompt: "You are a coding assistant. Answer the current request using the conversation context.",
      messages: turn.context as any[],
    }, {
      reasoning: "medium",
      cacheRetention: "none",
      maxRetries: 0,
      signal: AbortSignal.timeout(120_000),
    });
    const original = outputText(generatedOriginal);
    if (generatedOriginal.stopReason !== "stop" || original.length === 0) {
      process.stdout.write(`Skipped ${turn.id}: original generation ended with ${generatedOriginal.stopReason}.\n`);
      continue;
    }
    const originalEvaluation = evaluateProse(original, { complexitySensitivity: "medium" });
    if (!originalEvaluation.retry) {
      process.stdout.write(`Skipped ${turn.id}: Luna's response did not trigger nopus.\n`);
      continue;
    }

    const variants: Record<string, RewriteResult> = {};
    for (const [name, extraSimple] of [["normal", false], ["extraSimple", true]] as const) {
      const instruction = buildRewriteInstruction(originalEvaluation, true, extraSimple);
      const started = Date.now();
      const response = await runtime.completeSimple(model, {
        systemPrompt: "You are a coding assistant. Follow the latest instruction in the conversation.",
        messages: [
          ...turn.context as any[],
          generatedOriginal,
          { role: "user", content: instruction, timestamp: Date.now() },
        ],
      }, {
        reasoning: "medium",
        cacheRetention: "none",
        maxRetries: 0,
        signal: AbortSignal.timeout(120_000),
      });
      const text = outputText(response);
      if (response.stopReason !== "stop" || text.length === 0) {
        throw new Error(`${name} rewrite failed for ${turn.id}: ${response.stopReason} ${response.errorMessage ?? ""}`.trim());
      }
      variants[name] = {
        text,
        stopReason: response.stopReason,
        usage: response.usage,
        milliseconds: Date.now() - started,
        evaluation: evaluateProse(text, { complexitySensitivity: "medium" }),
      };
    }

    const normal = variants.normal;
    const extraSimple = variants.extraSimple;
    if (normal === undefined || extraSimple === undefined) throw new Error(`Incomplete rewrite pair for ${turn.id}.`);
    if (!normal.evaluation.retry) summary.acceptedByMediumPolicy.normal += 1;
    if (!extraSimple.evaluation.retry) summary.acceptedByMediumPolicy.extraSimple += 1;
    const reviewIndex = summary.generatedComplexResponses;
    summary.generatedComplexResponses += 1;
    const normalIsA = reviewIndex % 2 === 0;
    const rewriteA = normalIsA ? normal : extraSimple;
    const rewriteB = normalIsA ? extraSimple : normal;
    const conversation = turn.context.map(reviewMessage).join("\n\n");
    review += [
      `## Example ${reviewIndex + 1}`,
      "",
      "### Conversation before the original response",
      "",
      conversation,
      "",
      "### Original Luna response",
      "",
      original,
      "",
      "### Rewrite A",
      "",
      rewriteA.text,
      "",
      "### Rewrite B",
      "",
      rewriteB.text,
      "",
      "### Human review",
      "",
      "- Which rewrite is the better initial answer: A, B, or tie?",
      "- Does each rewrite keep the main conclusion and immediate action?",
      "- Does each rewrite keep conditions or warnings that could change that action?",
      "- Does the shorter rewrite defer only information that can safely wait?",
      "- Does either rewrite change or invent anything important?",
      "",
    ].join("\n");

    manifest.selected.push({
      id: turn.id,
      contextHash: createHash("sha256").update(JSON.stringify(turn.context)).digest("hex"),
      generatedOriginalHash: createHash("sha256").update(original).digest("hex"),
      normalInstructionHash: createHash("sha256").update(buildRewriteInstruction(originalEvaluation, true, false)).digest("hex"),
      extraSimpleInstructionHash: createHash("sha256").update(buildRewriteInstruction(originalEvaluation, true, true)).digest("hex"),
    });
    const record = {
      id: turn.id,
      model: `${model.provider}/${model.id}`,
      thinking: "medium",
      context: turn.context,
      original,
      originalUsage: generatedOriginal.usage,
      originalEvaluation,
      variants,
      normalLabel: normalIsA ? "A" : "B",
    };
    await writeFile(resultsPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "a" });
    await chmod(resultsPath, 0o600);
    process.stdout.write(`Evaluated ${turn.id}.\n`);
  }

  await privateWrite(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await privateWrite(join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await privateWrite(join(root, "review.md"), review);
  if (summary.generatedComplexResponses < SAMPLE_SIZE) {
    throw new Error(`Only ${summary.generatedComplexResponses} Luna responses triggered nopus after ${summary.attemptedContexts} attempts.`);
  }
  process.stdout.write(`Private results: ${resultsPath}\n`);
  process.stdout.write(`Human review: ${join(root, "review.md")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
