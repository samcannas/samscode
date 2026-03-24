import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

function buildClaudeUserMessage(prompt: string): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  } as SDKUserMessage;
}

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant") {
    return "";
  }

  const content = message.message?.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const textBlock = block as { type?: unknown; text?: unknown };
      return textBlock.type === "text" && typeof textBlock.text === "string" ? textBlock.text : "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function cleanupTranscriptWithClaude(input: {
  readonly cwd: string;
  readonly prompt: string;
  readonly model: string;
}): Promise<string> {
  let latestAssistantText = "";

  for await (const message of query({
    prompt: (async function* () {
      yield buildClaudeUserMessage(input.prompt);
    })(),
    options: {
      cwd: input.cwd,
      model: input.model,
      pathToClaudeCodeExecutable: "claude",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: false,
      env: process.env,
      additionalDirectories: [input.cwd],
    },
  })) {
    const assistantText = extractAssistantText(message);
    if (assistantText.length > 0) {
      latestAssistantText = assistantText;
    }

    if (message.type === "result" && message.subtype !== "success") {
      throw new Error(message.errors[0] ?? "Claude cleanup failed.");
    }
  }

  return latestAssistantText.trim();
}
