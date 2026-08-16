import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import nopusExtension, { latestAssistantText } from "../../src/pi/extension.js";

type Handler = (event: any, context: any) => Promise<any> | any;
type MarkdownTransformer = (markdown: string, context: {
  messageType: "user" | "assistant" | "assistant-thinking";
  isStreaming: boolean;
  availableWidth: number;
}) => string;

function assistant(text: string, stopReason = "stop") {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
  };
}

function extensionHarness() {
  const handlers = new Map<string, Handler>();
  const messages: Array<{ message: any; options: any }> = [];
  const commands = new Map<string, any>();
  let markdownTransformer: MarkdownTransformer | undefined;
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerMarkdownTransformer(transformer: MarkdownTransformer) {
      markdownTransformer = transformer;
    },
    sendMessage(message: any, options: any) {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  nopusExtension(pi);
  return { handlers, messages, commands, getMarkdownTransformer: () => markdownTransformer };
}

const difficult = [
  "Explicit approval requires authority evidence.",
  "Each decision requires explicit condition evidence.",
  "Authority approval requires explicit evidence.",
  "Explicit authority requires approval evidence.",
].join(" ");

const renderContext = {
  messageType: "assistant" as const,
  isStreaming: false,
  availableWidth: 80,
};

test("extracts only a completed assistant response", () => {
  assert.equal(latestAssistantText([
    assistant("earlier"),
    assistant("aborted", "aborted"),
  ]), "earlier");
  assert.equal(latestAssistantText([{
    role: "assistant",
    content: [{ type: "toolCall", name: "read" }],
    stopReason: "stop",
  }]), undefined);
});

test("hides a rejected response and queues exactly one rewrite before Pi settles", async () => {
  const harness = extensionHarness();
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  const first = await harness.handlers.get("message_end")?.({ message: assistant(difficult) }, context);
  await harness.handlers.get("message_end")?.({ message: assistant(difficult) }, context);

  assert.equal(harness.messages.length, 1);
  assert.deepEqual(notifications, [{ message: "nopus requested a clearer rewrite.", level: "info" }]);
  assert.equal(harness.messages[0]?.message.customType, "nopus-rewrite");
  assert.equal(harness.messages[0]?.message.display, false);
  assert.deepEqual(harness.messages[0]?.options, { deliverAs: "followUp", triggerTurn: true });

  const markedText = first.message.content[0].text;
  assert.match(markedText, /^<!-- nopus:hidden-original-response -->/);
  assert.equal(harness.getMarkdownTransformer()?.(markedText, renderContext), "");
  assert.equal(harness.getMarkdownTransformer()?.("ordinary response", renderContext), "ordinary response");
  assert.equal(harness.getMarkdownTransformer()?.(markedText, { ...renderContext, messageType: "user" }), markedText);

  await harness.handlers.get("agent_settled")?.({}, context);
  await harness.handlers.get("message_end")?.({ message: assistant(difficult) }, context);
  assert.equal(harness.messages.length, 2);
});

test("can keep the rejected response visible while still requesting a rewrite", async () => {
  const previousPath = process.env.NOPUS_CONFIG;
  process.env.NOPUS_CONFIG = join(mkdtempSync(join(tmpdir(), "nopus-pi-test-")), "config.json");
  try {
    const harness = extensionHarness();
    await harness.commands.get("nopus").handler("extra-simple on", { ui: { notify() {} } });
    await harness.commands.get("nopus").handler("hide-original off", { ui: { notify() {} } });
    const replacement = await harness.handlers.get("message_end")?.(
      { message: assistant(difficult) },
      { ui: { notify() {} } },
    );
    assert.equal(replacement, undefined);
    assert.equal(harness.messages.length, 1);
    assert.match(String(harness.messages[0]?.message.content), /short, simple answer to the user's current request/);
    const markedText = `<!-- nopus:hidden-original-response -->\n${difficult}`;
    assert.equal(harness.getMarkdownTransformer()?.(markedText, renderContext), markedText);
  } finally {
    if (previousPath === undefined) delete process.env.NOPUS_CONFIG;
    else process.env.NOPUS_CONFIG = previousPath;
  }
});

test("keeps the rejected response text in model context without the display marker", async () => {
  const harness = extensionHarness();
  const replacement = await harness.handlers.get("message_end")?.(
    { message: assistant(difficult) },
    { ui: { notify() {} } },
  );
  const current = { role: "custom", customType: "nopus-rewrite", content: "current" };
  const result = await harness.handlers.get("context")?.({
    messages: [
      { role: "custom", customType: "nopus-rewrite", content: "old" },
      replacement.message,
      current,
    ],
  }, {});

  assert.deepEqual(result.messages, [assistant(difficult), current]);
});

test("removes old rewrite instructions from later model context", async () => {
  const harness = extensionHarness();
  const result = await harness.handlers.get("context")?.({
    messages: [
      { role: "custom", customType: "nopus-rewrite", content: "old" },
      { role: "user", content: "next" },
    ],
  }, {});
  assert.deepEqual(result.messages, [{ role: "user", content: "next" }]);
});

test("registers the nopus command", () => {
  const harness = extensionHarness();
  assert.ok(harness.commands.has("nopus"));
});
