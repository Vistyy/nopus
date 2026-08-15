import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import nopusExtension, { latestAssistantText } from "../../src/pi/extension.js";

type Handler = (event: any, context: any) => Promise<any> | any;

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
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    sendMessage(message: any, options: any) {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  nopusExtension(pi);
  return { handlers, messages, commands };
}

const difficult = [
  "Explicit approval requires authority evidence.",
  "Each decision requires explicit condition evidence.",
  "Authority approval requires explicit evidence.",
  "Explicit authority requires approval evidence.",
].join(" ");

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

test("queues exactly one hidden rewrite continuation before Pi settles", async () => {
  const harness = extensionHarness();
  const context = { ui: { notify() {} } };
  await harness.handlers.get("session_start")?.({}, context);
  await harness.handlers.get("agent_end")?.({ messages: [assistant(difficult)] }, context);
  await harness.handlers.get("agent_end")?.({ messages: [assistant(difficult)] }, context);

  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0]?.message.customType, "nopus-rewrite");
  assert.equal(harness.messages[0]?.message.display, false);
  assert.deepEqual(harness.messages[0]?.options, { deliverAs: "followUp", triggerTurn: true });

  await harness.handlers.get("agent_settled")?.({}, context);
  await harness.handlers.get("agent_end")?.({ messages: [assistant(difficult)] }, context);
  assert.equal(harness.messages.length, 2);
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

test("keeps only the current instruction during a rewrite", async () => {
  const harness = extensionHarness();
  await harness.handlers.get("agent_end")?.({ messages: [assistant(difficult)] }, {});
  const current = { role: "custom", customType: "nopus-rewrite", content: "current" };
  const result = await harness.handlers.get("context")?.({
    messages: [
      { role: "custom", customType: "nopus-rewrite", content: "old" },
      { role: "user", content: "next" },
      current,
    ],
  }, {});
  assert.deepEqual(result.messages, [{ role: "user", content: "next" }, current]);
});

test("registers the nopus command", () => {
  const harness = extensionHarness();
  assert.ok(harness.commands.has("nopus"));
});
