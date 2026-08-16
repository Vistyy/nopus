import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configuredNopusConfig, type NopusConfig } from "../config/nopus-config.js";
import { updateNopusConfig } from "../config/update-nopus-config.js";
import { evaluateProse, type ProseEvaluation } from "../evaluate-prose.js";
import { buildRewriteInstruction } from "../hook/handle-stop.js";

const CUSTOM_TYPE = "nopus-rewrite";
const HIDDEN_RESPONSE_MARKER = "<!-- nopus:hidden-original-response -->\n";

type AssistantLike = {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
};

function textFromAssistant(message: AssistantLike): string | undefined {
  if (message.role !== "assistant" || message.stopReason !== "stop" || !Array.isArray(message.content)) return undefined;
  const text = message.content.flatMap((block) => {
    if (typeof block !== "object" || block === null) return [];
    const value = block as { type?: unknown; text?: unknown };
    if (value.type !== "text" || typeof value.text !== "string") return [];
    return [value.text.startsWith(HIDDEN_RESPONSE_MARKER)
      ? value.text.slice(HIDDEN_RESPONSE_MARKER.length)
      : value.text];
  }).join("\n").trim();
  return text.length === 0 ? undefined : text;
}

export function latestAssistantText(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textFromAssistant(messages[index] as AssistantLike);
    if (text !== undefined) return text;
  }
  return undefined;
}

function latestAssistantTextFromEntries(entries: readonly unknown[]): string | undefined {
  const messages = entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const value = entry as { type?: unknown; message?: unknown };
    return value.type === "message" ? [value.message] : [];
  });
  return latestAssistantText(messages);
}

function evaluationSummary(evaluation: ProseEvaluation): string {
  if (!evaluation.retry) return "nopus accepts the latest response.";
  return `nopus recommends a rewrite (${evaluation.signals.join(", ")}).`;
}

function stripHiddenResponseMarker<T>(message: T): T {
  if (typeof message !== "object" || message === null) return message;
  const value = message as { role?: unknown; content?: unknown };
  if (value.role !== "assistant" || !Array.isArray(value.content)) return message;
  return {
    ...value,
    content: value.content.map((block) => {
      if (typeof block !== "object" || block === null) return block;
      const content = block as { type?: unknown; text?: unknown };
      if (content.type !== "text" || typeof content.text !== "string" || !content.text.startsWith(HIDDEN_RESPONSE_MARKER)) {
        return block;
      }
      return { ...content, text: content.text.slice(HIDDEN_RESPONSE_MARKER.length) };
    }),
  } as T;
}

export default function nopusExtension(pi: ExtensionAPI): void {
  let config: NopusConfig = {
    complexitySensitivity: "medium",
    includeEvidence: true,
    pi: { hideOriginalResponse: true },
  };
  let active = true;
  let rewriteQueued = false;

  const evaluate = (text: string) => evaluateProse(text, {
    complexitySensitivity: config.complexitySensitivity,
  });

  const queueRewrite = (evaluation: ProseEvaluation, notify: () => void): void => {
    rewriteQueued = true;
    pi.sendMessage({
      customType: CUSTOM_TYPE,
      content: buildRewriteInstruction(evaluation, config.includeEvidence),
      display: false,
      details: { signals: evaluation.signals },
    }, {
      deliverAs: "followUp",
      triggerTurn: true,
    });
    notify();
  };

  pi.registerMarkdownTransformer((markdown, context) => {
    if (config.pi.hideOriginalResponse && context.messageType === "assistant" && markdown.startsWith(HIDDEN_RESPONSE_MARKER)) {
      return "";
    }
    return markdown;
  });

  pi.registerCommand("nopus", {
    description: "Inspect, configure, or toggle nopus prose rewrites",
    handler: async (rawArgs, ctx) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const action = args[0] ?? "status";

      if (action === "status") {
        ctx.ui.notify(
          `nopus is ${active ? "on" : "off"}; sensitivity ${config.complexitySensitivity}; evidence ${config.includeEvidence ? "on" : "off"}; hide original ${config.pi.hideOriginalResponse ? "on" : "off"}.`,
          "info",
        );
        return;
      }
      if (action === "on" || action === "off") {
        active = action === "on";
        ctx.ui.notify(`nopus is ${active ? "on" : "off"} for this session.`, "info");
        return;
      }
      if (action === "check") {
        const text = latestAssistantTextFromEntries(ctx.sessionManager.getBranch());
        if (text === undefined) {
          ctx.ui.notify("nopus could not find a completed assistant response.", "warning");
          return;
        }
        const evaluation = evaluate(text);
        ctx.ui.notify(evaluationSummary(evaluation), evaluation.retry ? "warning" : "info");
        return;
      }
      if (action === "evidence" || action === "hide-original" || action === "sensitivity" || action === "low" || action === "medium" || action === "high") {
        try {
          const update = updateNopusConfig(args);
          config = update.config;
          ctx.ui.notify(`${update.confirmation}\nConfiguration: ${update.path}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      ctx.ui.notify("Usage: /nopus [status|on|off|check|low|medium|high|sensitivity LEVEL|evidence on|off|hide-original on|off]", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    active = true;
    rewriteQueued = false;
    try {
      config = configuredNopusConfig();
    } catch (error) {
      active = false;
      ctx.ui.notify(`nopus is off: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!active || rewriteQueued) return;
    const text = textFromAssistant(event.message);
    if (text === undefined) return;
    const evaluation = evaluate(text);
    if (!evaluation.retry) return;

    queueRewrite(evaluation, () => ctx.ui.notify("nopus requested a clearer rewrite.", "info"));
    if (!config.pi.hideOriginalResponse || event.message.role !== "assistant") return;
    return {
      message: {
        ...event.message,
        content: event.message.content.map((block) =>
          block.type === "text" && block.text.length > 0
            ? { ...block, text: `${HIDDEN_RESPONSE_MARKER}${block.text}` }
            : block
        ),
      },
    };
  });

  pi.on("agent_settled", async () => {
    rewriteQueued = false;
  });

  pi.on("context", async (event) => {
    const isRewriteMessage = (message: unknown): boolean => {
      const value = message as { role?: unknown; customType?: unknown };
      return value.role === "custom" && value.customType === CUSTOM_TYPE;
    };
    let latestRewriteIndex = -1;
    if (rewriteQueued) {
      for (let index = 0; index < event.messages.length; index += 1) {
        if (isRewriteMessage(event.messages[index])) latestRewriteIndex = index;
      }
    }
    return {
      messages: event.messages
        .filter((message, index) => !isRewriteMessage(message) || index === latestRewriteIndex)
        .map(stripHiddenResponseMarker),
    };
  });
}
