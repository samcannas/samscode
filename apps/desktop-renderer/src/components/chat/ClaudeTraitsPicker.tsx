import {
  ProviderKind,
  type ClaudeCodeEffort,
  type ClaudeModelOptions,
  type ThreadId,
} from "@samscode/contracts";
import {
  applyClaudePromptEffortPrefix,
  getClaudeContextWindowOptions,
  getDefaultReasoningEffort,
  getReasoningEffortOptions,
  normalizeClaudeModelOptions,
  resolveClaudeContextWindow,
  resolveReasoningEffortForProvider,
  supportsClaudeFastMode,
  supportsClaudeThinkingToggle,
  supportsClaudeUltrathinkKeyword,
  isClaudeUltrathinkPrompt,
} from "@samscode/shared/model";
import { memo, useCallback, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";

const PROVIDER = "claudeAgent" as const satisfies ProviderKind;

const CLAUDE_EFFORT_LABELS: Record<ClaudeCodeEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
  ultrathink: "Ultrathink",
};
const CLAUDE_CONTEXT_WINDOW_LABELS = {
  "200k": "200K",
  "1m": "1M",
} as const;

const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

function stripInjectedUltrathinkPrefix(prompt: string): string {
  return prompt.startsWith(ULTRATHINK_PROMPT_PREFIX)
    ? prompt.slice(ULTRATHINK_PROMPT_PREFIX.length)
    : prompt;
}

function getSelectedClaudeTraits(
  model: string | null | undefined,
  prompt: string,
  modelOptions: ClaudeModelOptions | null | undefined,
): {
  effort: Exclude<ClaudeCodeEffort, "ultrathink"> | null;
  thinkingEnabled: boolean | null;
  fastModeEnabled: boolean;
  options: ReadonlyArray<ClaudeCodeEffort>;
  ultrathinkPromptControlled: boolean;
  ultrathinkActive: boolean;
  supportsFastMode: boolean;
  contextWindow: string | null;
  contextWindowOptions: ReadonlyArray<string>;
} {
  const options = getReasoningEffortOptions(PROVIDER, model);
  const defaultReasoningEffort = getDefaultReasoningEffort(PROVIDER) as Exclude<
    ClaudeCodeEffort,
    "ultrathink"
  >;
  const resolvedEffort = resolveReasoningEffortForProvider(PROVIDER, modelOptions?.effort);
  const effort =
    resolvedEffort && resolvedEffort !== "ultrathink" && options.includes(resolvedEffort)
      ? resolvedEffort
      : options.includes(defaultReasoningEffort)
        ? defaultReasoningEffort
        : null;
  const thinkingEnabled = supportsClaudeThinkingToggle(model)
    ? (modelOptions?.thinking ?? true)
    : null;
  const supportsFastMode = supportsClaudeFastMode(model);
  const ultrathinkActive =
    supportsClaudeUltrathinkKeyword(model) && isClaudeUltrathinkPrompt(prompt);
  const contextWindowOptions = getClaudeContextWindowOptions(model);
  const contextWindow = resolveClaudeContextWindow(model, modelOptions?.contextWindow);
  return {
    effort,
    thinkingEnabled,
    fastModeEnabled: supportsFastMode && modelOptions?.fastMode === true,
    options,
    ultrathinkPromptControlled:
      supportsClaudeUltrathinkKeyword(model) &&
      isClaudeUltrathinkPrompt(stripInjectedUltrathinkPrefix(prompt)),
    ultrathinkActive,
    supportsFastMode,
    contextWindow,
    contextWindowOptions,
  };
}

interface ClaudeTraitsMenuContentProps {
  threadId: ThreadId;
  model: string | null | undefined;
  onPromptChange: (prompt: string) => void;
}

export const ClaudeTraitsMenuContent = memo(function ClaudeTraitsMenuContentImpl({
  threadId,
  model,
  onPromptChange,
}: ClaudeTraitsMenuContentProps) {
  const draft = useComposerThreadDraft(threadId);
  const prompt = draft.prompt;
  const modelOptions = draft.modelOptions?.[PROVIDER];
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const {
    effort,
    thinkingEnabled,
    fastModeEnabled,
    options,
    ultrathinkPromptControlled,
    ultrathinkActive,
    supportsFastMode,
    contextWindow,
    contextWindowOptions,
  } = getSelectedClaudeTraits(model, prompt, modelOptions);
  const defaultReasoningEffort = getDefaultReasoningEffort(PROVIDER);

  const handleEffortChange = useCallback(
    (value: ClaudeCodeEffort) => {
      if (!value) return;
      const nextEffort = options.find((option) => option === value);
      if (!nextEffort) return;
      if (nextEffort === "ultrathink") {
        const nextPrompt =
          prompt.trim().length === 0
            ? ULTRATHINK_PROMPT_PREFIX
            : applyClaudePromptEffortPrefix(prompt, "ultrathink");
        onPromptChange(nextPrompt);
        return;
      }
      if (ultrathinkActive) {
        onPromptChange(stripInjectedUltrathinkPrefix(prompt));
      }
      setProviderModelOptions(
        threadId,
        PROVIDER,
        normalizeClaudeModelOptions(model, {
          ...modelOptions,
          effort: nextEffort,
        }),
        { persistSticky: true },
      );
    },
    [
      ultrathinkActive,
      model,
      modelOptions,
      onPromptChange,
      threadId,
      setProviderModelOptions,
      options,
      prompt,
    ],
  );

  if (effort === null && thinkingEnabled === null) {
    return null;
  }

  return (
    <>
      {effort ? (
        <>
          <MenuGroup>
            <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Effort</div>
            {ultrathinkPromptControlled ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                Remove Ultrathink from the prompt to change effort.
              </div>
            ) : null}
            <MenuRadioGroup value={effort} onValueChange={handleEffortChange}>
              {options.map((option) => (
                <MenuRadioItem key={option} value={option} disabled={ultrathinkPromptControlled}>
                  {CLAUDE_EFFORT_LABELS[option]}
                  {option === defaultReasoningEffort ? " (default)" : ""}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : thinkingEnabled !== null ? (
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Thinking</div>
          <MenuRadioGroup
            value={thinkingEnabled ? "on" : "off"}
            onValueChange={(value) => {
              setProviderModelOptions(
                threadId,
                PROVIDER,
                normalizeClaudeModelOptions(model, {
                  ...modelOptions,
                  thinking: value === "on",
                }),
                { persistSticky: true },
              );
            }}
          >
            <MenuRadioItem value="on">On (default)</MenuRadioItem>
            <MenuRadioItem value="off">Off</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      ) : null}
      {supportsFastMode ? (
        <>
          <MenuDivider />
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
            <MenuRadioGroup
              value={fastModeEnabled ? "on" : "off"}
              onValueChange={(value) => {
                setProviderModelOptions(
                  threadId,
                  PROVIDER,
                  normalizeClaudeModelOptions(model, {
                    ...modelOptions,
                    fastMode: value === "on",
                  }),
                  { persistSticky: true },
                );
              }}
            >
              <MenuRadioItem value="off">off</MenuRadioItem>
              <MenuRadioItem value="on">on</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
      {contextWindowOptions.length > 0 ? (
        <>
          <MenuDivider />
          <MenuGroup>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              Context Window
            </div>
            <MenuRadioGroup
              value={contextWindow ?? "200k"}
              onValueChange={(value) => {
                setProviderModelOptions(
                  threadId,
                  PROVIDER,
                  normalizeClaudeModelOptions(model, {
                    ...modelOptions,
                    contextWindow: value === "200k" ? undefined : value,
                  }),
                  { persistSticky: true },
                );
              }}
            >
              {contextWindowOptions.map((option) => (
                <MenuRadioItem key={option} value={option}>
                  {CLAUDE_CONTEXT_WINDOW_LABELS[
                    option as keyof typeof CLAUDE_CONTEXT_WINDOW_LABELS
                  ] ?? option}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </>
      ) : null}
    </>
  );
});

export const ClaudeTraitsPicker = memo(function ClaudeTraitsPicker({
  threadId,
  model,
  onPromptChange,
}: ClaudeTraitsMenuContentProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const draft = useComposerThreadDraft(threadId);
  const prompt = draft.prompt;
  const modelOptions = draft.modelOptions?.[PROVIDER];
  const {
    effort,
    thinkingEnabled,
    fastModeEnabled,
    ultrathinkActive,
    supportsFastMode,
    contextWindow,
  } = getSelectedClaudeTraits(model, prompt, modelOptions);
  const triggerLabel = [
    ultrathinkActive
      ? "Ultrathink"
      : effort
        ? CLAUDE_EFFORT_LABELS[effort]
        : thinkingEnabled === null
          ? null
          : `Thinking ${thinkingEnabled ? "On" : "Off"}`,
    ...(supportsFastMode && fastModeEnabled ? ["Fast"] : []),
    ...(contextWindow && contextWindow !== "200k"
      ? [
          CLAUDE_CONTEXT_WINDOW_LABELS[
            contextWindow as keyof typeof CLAUDE_CONTEXT_WINDOW_LABELS
          ] ?? contextWindow,
        ]
      : []),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
          />
        }
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <ClaudeTraitsMenuContent
          threadId={threadId}
          model={model}
          onPromptChange={onPromptChange}
        />
      </MenuPopup>
    </Menu>
  );
});
