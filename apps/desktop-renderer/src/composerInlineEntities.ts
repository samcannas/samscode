export type ComposerInlineEntityKind = "agent" | "skill";

export interface ComposerInlineEntityDefinition {
  kind: ComposerInlineEntityKind;
  id: string;
  label: string;
}

export function inlineEntityTokenText(entity: {
  kind: ComposerInlineEntityKind;
  id: string;
}): string {
  return `${entity.kind === "agent" ? "@" : "/"}${entity.id}`;
}
