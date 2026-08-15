import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configuredNopusConfig, type NopusConfig } from "../config/nopus-config.js";
import { updateNopusConfig } from "../config/update-nopus-config.js";
import { evaluateProse, type ProseEvaluation } from "../evaluate-prose.js";
import { buildRewriteInstruction } from "../hook/handle-stop.js";

const CUSTOM_TYPE = "nopus-rewrite";

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
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
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

export default function nopusExtension(pi: ExtensionAPI): void {
  let config: NopusConfig = { complexitySensitivity: "medium", includeEvidence: true };
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

  pi.registerCommand("nopus", {
    description: "Inspect, configure, or toggle nopus prose rewrites",
    handler: async (rawArgs, ctx) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const action = args[0] ?? "status";

      if (action === "status") {
        ctx.ui.notify(
          `nopus is ${active ? "on" : "off"}; sensitivity ${config.complexitySensitivity}; evidence ${config.includeEvidence ? "on" : "off"}.`,
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
      if (action === "evidence" || action === "sensitivity" || action === "low" || action === "medium" || action === "high") {
        try {
          const update = updateNopusConfig(args);
          config = update.config;
          ctx.ui.notify(`${update.confirmation}\nConfiguration: ${update.path}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      ctx.ui.notify("Usage: /nopus [status|on|off|check|low|medium|high|sensitivity LEVEL|evidence on|off]", "warning");
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

  pi.on("agent_end", async (event, ctx) => {
    if (!active || rewriteQueued) return;
    const text = latestAssistantText(event.messages);
    if (text === undefined) return;
    const evaluation = evaluate(text);
    if (evaluation.retry) {
      queueRewrite(evaluation, () => ctx.ui.notify("nopus requested a clearer rewrite.", "info"));
    }
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
      messages: event.messages.filter((message, index) =>
        !isRewriteMessage(message) || index === latestRewriteIndex
      ),
    };
  });
}
