import type { AgentCatalogEntry, ProviderKind } from "@samscode/contracts";

export interface ComposerAgentDefinition {
  id: string;
  name: string;
  description: string;
}

export interface ExplicitAgentMention {
  id: string;
  name: string;
  description: string;
}

const MENTION_NAME_SUFFIX = /(\s*\(agent\))$/i;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSearchValue(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function isMentionBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s.,!?;:()[\]{}]/.test(char);
}

function buildAgentAliases(agent: ComposerAgentDefinition): string[] {
  const aliases = [agent.id, agent.name];
  return Array.from(
    new Set(aliases.map((value) => normalizeWhitespace(value)).filter((value) => value.length > 0)),
  );
}

function findQuotedMentionMatch(
  text: string,
  startIndex: number,
  agents: readonly ComposerAgentDefinition[],
): { agent: ComposerAgentDefinition; rangeEnd: number } | null {
  if (text[startIndex + 1] !== '"') {
    return null;
  }
  const closingQuote = text.indexOf('"', startIndex + 2);
  if (closingQuote === -1) {
    return null;
  }
  const rawInner = text.slice(startIndex + 2, closingQuote).replace(MENTION_NAME_SUFFIX, "");
  const normalizedInner = normalizeSearchValue(rawInner);
  const agent = agents.find((candidate) =>
    buildAgentAliases(candidate).some((alias) => normalizeSearchValue(alias) === normalizedInner),
  );
  if (!agent || !isMentionBoundary(text[closingQuote + 1])) {
    return null;
  }
  return {
    agent,
    rangeEnd: closingQuote + 1,
  };
}

function findPlainMentionMatch(
  text: string,
  startIndex: number,
  agents: readonly ComposerAgentDefinition[],
): { agent: ComposerAgentDefinition; rangeEnd: number } | null {
  const candidates = agents
    .flatMap((agent) =>
      buildAgentAliases(agent).map((alias) => ({
        agent,
        alias,
        normalizedAlias: normalizeSearchValue(alias),
      })),
    )
    .toSorted((left, right) => right.alias.length - left.alias.length);
  const remainder = text.slice(startIndex + 1);
  const normalizedRemainder = remainder.toLowerCase();

  for (const candidate of candidates) {
    const alias = candidate.alias;
    if (!normalizedRemainder.startsWith(candidate.normalizedAlias)) {
      continue;
    }
    const rangeEnd = startIndex + 1 + alias.length;
    if (!isMentionBoundary(text[rangeEnd])) {
      continue;
    }
    return {
      agent: candidate.agent,
      rangeEnd,
    };
  }
  return null;
}

export function extractExplicitAgentMentions(input: {
  prompt: string;
  agents: readonly ComposerAgentDefinition[];
}): {
  mentions: ExplicitAgentMention[];
  promptWithoutMentions: string;
} {
  if (input.agents.length === 0 || input.prompt.length === 0) {
    return {
      mentions: [],
      promptWithoutMentions: input.prompt,
    };
  }

  const mentions: ExplicitAgentMention[] = [];
  const seen = new Set<string>();
  let output = "";
  let index = 0;

  while (index < input.prompt.length) {
    const current = input.prompt[index];
    const previous = index > 0 ? input.prompt[index - 1] : undefined;
    if (current !== "@" || !isMentionBoundary(previous)) {
      output += current;
      index += 1;
      continue;
    }

    const quotedMatch = findQuotedMentionMatch(input.prompt, index, input.agents);
    const plainMatch = findPlainMentionMatch(input.prompt, index, input.agents);
    const match = quotedMatch ?? plainMatch;
    if (!match) {
      output += current;
      index += 1;
      continue;
    }

    if (!seen.has(match.agent.id)) {
      seen.add(match.agent.id);
      mentions.push({
        id: match.agent.id,
        name: match.agent.name,
        description: match.agent.description,
      });
    }
    index = match.rangeEnd;
  }

  return {
    mentions,
    promptWithoutMentions: output
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  };
}

export function buildAgentOrchestrationPrompt(input: {
  provider: ProviderKind;
  prompt: string;
  mentions: readonly ExplicitAgentMention[];
}): string {
  if (input.mentions.length === 0) {
    return input.prompt;
  }

  const requestedAgentLines = input.mentions.map(
    (agent) => `- ${agent.id} (${agent.name}): ${agent.description}`,
  );
  const requestBody = input.prompt.trim();
  const taskBody = requestBody.length > 0 ? requestBody : "No additional task text was provided.";
  const harnessLabel = input.provider === "codex" ? "Codex" : "Claude Code";

  return [
    `The user explicitly requested these installed ${harnessLabel} agents for this turn:`,
    ...requestedAgentLines,
    "",
    "You must use every explicitly requested agent unless one is unavailable or impossible to use in context.",
    "Decide the best execution plan yourself using the repository, current thread context, and the user's task.",
    "Run independent agent work in parallel whenever it helps.",
    "Run dependent agent work sequentially whenever outputs need to feed later steps.",
    "Revisit earlier agents when validation or refinement is useful.",
    "Use the exact installed agent names shown above when delegating.",
    "Return one consolidated final answer to the user after the requested agent work is complete.",
    "",
    "User request:",
    taskBody,
  ].join("\n");
}

export function deriveProviderAvailableComposerAgents(input: {
  entries: readonly AgentCatalogEntry[];
  provider: ProviderKind;
}): ComposerAgentDefinition[] {
  return input.entries
    .filter((entry) => entry.supports.includes(input.provider))
    .filter((entry) => entry.installState[input.provider])
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
    }));
}
