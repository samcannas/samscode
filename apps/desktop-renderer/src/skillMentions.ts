import type { ProviderKind, SkillCatalogEntry } from "@samscode/contracts";

export interface ComposerSkillDefinition {
  id: string;
  name: string;
  description: string;
}

export interface ExplicitSkillMention {
  id: string;
  name: string;
  description: string;
}

function isSkillBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s.,!?;:()[\]{}]/.test(char);
}

export function extractExplicitSkillMentions(input: {
  prompt: string;
  skills: readonly ComposerSkillDefinition[];
}): {
  mentions: ExplicitSkillMention[];
  promptWithoutMentions: string;
} {
  if (input.skills.length === 0 || input.prompt.length === 0) {
    return {
      mentions: [],
      promptWithoutMentions: input.prompt,
    };
  }

  const skillsById = new Map(input.skills.map((skill) => [skill.id.toLowerCase(), skill]));
  const mentions: ExplicitSkillMention[] = [];
  const seen = new Set<string>();
  let output = "";
  let index = 0;

  while (index < input.prompt.length) {
    const current = input.prompt[index];
    const previous = index > 0 ? input.prompt[index - 1] : undefined;
    if (current !== "/" || !isSkillBoundary(previous)) {
      output += current;
      index += 1;
      continue;
    }

    let end = index + 1;
    while (/[a-z0-9-]/i.test(input.prompt[end] ?? "")) {
      end += 1;
    }

    const rawId = input.prompt.slice(index + 1, end).toLowerCase();
    const skill = skillsById.get(rawId);
    if (!skill || !isSkillBoundary(input.prompt[end])) {
      output += current;
      index += 1;
      continue;
    }

    if (!seen.has(skill.id)) {
      seen.add(skill.id);
      mentions.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      });
    }
    index = end;
  }

  return {
    mentions,
    promptWithoutMentions: output
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  };
}

export function deriveProviderAvailableComposerSkills(input: {
  entries: readonly SkillCatalogEntry[];
  provider: ProviderKind;
}): ComposerSkillDefinition[] {
  return input.entries
    .filter((entry) => entry.supports.includes(input.provider))
    .filter((entry) => entry.installState[input.provider])
    .filter((entry) => entry.userInvocable)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
    }));
}
