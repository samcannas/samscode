export const DEFAULT_TRANSCRIPT_CLEANUP_WORD_THRESHOLD = 3;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function shouldSkipTranscriptCleanup(text: string): boolean {
  return countWords(text) <= DEFAULT_TRANSCRIPT_CLEANUP_WORD_THRESHOLD;
}

export function buildTranscriptCleanupPrompt(input: {
  readonly language: string;
  readonly prompt: string;
}): string {
  const languageLine =
    input.language === "auto"
      ? "The transcript language may vary. Preserve the speaker's original language."
      : `The transcript language is ${input.language}. Preserve that language.`;

  return [
    languageLine,
    input.prompt.trim().length > 0 ? `Additional guidance: ${input.prompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
