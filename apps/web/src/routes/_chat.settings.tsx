import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  type ProviderKind,
  type SpeechToTextState,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
} from "@samscode/contracts";
import { getModelOptions, normalizeModelSlug } from "@samscode/shared/model";
import {
  getAppModelOptions,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  MAX_CUSTOM_MODEL_LENGTH,
  MODEL_PROVIDER_SETTINGS,
  patchCustomModels,
  useAppSettings,
} from "../appSettings";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { APP_VERSION } from "../branding";
import { SidebarInset } from "~/components/ui/sidebar";
import { updateSpeechToTextState, useSpeechToTextState } from "~/speechToText/speechToTextState";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

function formatByteSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const { loading: speechToTextLoading, state: speechToTextState } = useSpeechToTextState();
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [speechToTextActionError, setSpeechToTextActionError] = useState<string | null>(null);
  const [speechToTextBusyKey, setSpeechToTextBusyKey] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;
  const speechToTextInstalledModels = speechToTextState?.installedModels ?? [];
  const speechToTextCatalog = speechToTextState?.catalog ?? [];
  const activeSpeechDownload = speechToTextState?.activeDownload ?? null;
  const speechToTextSettings = speechToTextState?.settings ?? null;
  const runtimeStatusLabel =
    speechToTextState?.runtimeStatus === "ready"
      ? "Ready"
      : speechToTextState?.runtimeStatus === "downloading"
        ? "Downloading runtime"
        : speechToTextState?.runtimeStatus === "error"
          ? "Error"
          : "Missing runtime";
  const speechToTextRepairModelId = speechToTextState?.selectedModelId
    ? speechToTextState.selectedModelId
    : (speechToTextInstalledModels[0]?.id ??
      speechToTextCatalog.find((entry) => entry.recommended)?.id ??
      null);

  const gitTextGenerationModelOptions = getAppModelOptions(
    "codex",
    settings.customCodexModels,
    settings.textGenerationModel,
  );
  const speechCleanupCodexModelOptions = getAppModelOptions(
    "codex",
    settings.customCodexModels,
    speechToTextSettings?.cleanupModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
  );
  const speechCleanupClaudeModelOptions = getAppModelOptions(
    "claudeAgent",
    settings.customClaudeModels,
    speechToTextSettings?.cleanupModel ?? undefined,
  );
  const speechCleanupModelOptions = [
    ...speechCleanupCodexModelOptions.map((option) => ({ ...option, provider: "codex" as const })),
    ...speechCleanupClaudeModelOptions.map((option) => ({
      ...option,
      provider: "claudeAgent" as const,
    })),
  ];
  const selectedGitTextGenerationModelLabel =
    gitTextGenerationModelOptions.find(
      (option) =>
        option.slug === (settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL),
    )?.name ?? settings.textGenerationModel;
  const selectedCleanupModeLabel =
    speechToTextSettings?.refinementMode === "draft-only" ? "STT only" : "STT + cleanup";
  const selectedSpeechCleanupModelLabel =
    speechCleanupModelOptions.find((option) => option.slug === speechToTextSettings?.cleanupModel)
      ?.name ??
    speechToTextSettings?.cleanupModel ??
    selectedGitTextGenerationModelLabel;

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  const runSpeechToTextAction = useCallback(
    async (busyKey: string, action: () => Promise<SpeechToTextState>) => {
      setSpeechToTextActionError(null);
      setSpeechToTextBusyKey(busyKey);
      try {
        const nextState = await action();
        updateSpeechToTextState(nextState);
      } catch (error) {
        setSpeechToTextActionError(
          error instanceof Error ? error.message : "Speech-to-text action failed.",
        );
      } finally {
        setSpeechToTextBusyKey(null);
      }
    },
    [],
  );

  const downloadSpeechModel = useCallback(
    async (modelId: string) => {
      const api = ensureNativeApi();
      await runSpeechToTextAction(`download:${modelId}`, () =>
        api.speechToText.downloadModel({ modelId }),
      );
    },
    [runSpeechToTextAction],
  );

  const deleteSpeechModel = useCallback(
    async (modelId: string) => {
      const api = ensureNativeApi();
      await runSpeechToTextAction(`delete:${modelId}`, () =>
        api.speechToText.deleteModel({ modelId }),
      );
    },
    [runSpeechToTextAction],
  );

  const selectSpeechModel = useCallback(
    async (modelId: string) => {
      const api = ensureNativeApi();
      await runSpeechToTextAction(`select:${modelId}`, () =>
        api.speechToText.selectModel({ modelId }),
      );
    },
    [runSpeechToTextAction],
  );

  const updateSpeechToTextPreferences = useCallback(
    async (patch: Partial<NonNullable<typeof speechToTextSettings>>) => {
      const api = ensureNativeApi();
      const current = speechToTextState?.settings;
      if (!current) {
        return;
      }
      await runSpeechToTextAction("preferences", () =>
        api.speechToText.updatePreferences({
          ...current,
          ...patch,
        }),
      );
    },
    [runSpeechToTextAction, speechToTextState?.settings],
  );

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how Sam's Code looks across the app.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-primary/60 bg-primary/8 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setTheme(option.value)}
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-xs">{option.description}</span>
                        </span>
                        {selected ? (
                          <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Selected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
                </p>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Timestamp format</p>
                    <p className="text-xs text-muted-foreground">
                      System default follows your browser or OS time format. <code>12-hour</code>{" "}
                      and <code>24-hour</code> force the hour cycle.
                    </p>
                  </div>
                  <Select
                    value={settings.timestampFormat}
                    onValueChange={(value) => {
                      if (value !== "locale" && value !== "12-hour" && value !== "24-hour") return;
                      updateSettings({
                        timestampFormat: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-40" aria-label="Timestamp format">
                      <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      <SelectItem value="locale">{TIMESTAMP_FORMAT_LABELS.locale}</SelectItem>
                      <SelectItem value="12-hour">{TIMESTAMP_FORMAT_LABELS["12-hour"]}</SelectItem>
                      <SelectItem value="24-hour">{TIMESTAMP_FORMAT_LABELS["24-hour"]}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                {settings.timestampFormat !== defaults.timestampFormat ? (
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSettings({
                          timestampFormat: defaults.timestampFormat,
                        })
                      }
                    >
                      Restore default
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p>Binary source</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                      {codexBinaryPath || "PATH"}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {slug}
                                  </code>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Git</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure the model used for generating commit messages, PR titles, and branch
                  names.
                </p>
              </div>

              <div className="flex flex-col gap-4 rounded-lg border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">Text generation model</p>
                  <p className="text-xs text-muted-foreground">
                    Model used for auto-generated git content.
                  </p>
                </div>
                <Select
                  value={settings.textGenerationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL}
                  onValueChange={(value) => {
                    if (value) {
                      updateSettings({
                        textGenerationModel: value,
                      });
                    }
                  }}
                >
                  <SelectTrigger
                    className="w-full shrink-0 sm:w-48"
                    aria-label="Git text generation model"
                  >
                    <SelectValue>{selectedGitTextGenerationModelLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end">
                    {gitTextGenerationModelOptions.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              {settings.textGenerationModel !== defaults.textGenerationModel ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        textGenerationModel: defaults.textGenerationModel,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Speech-to-Text</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Manage the local Whisper runtime and on-device transcription models used by the
                  composer microphone button.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Runtime status</p>
                    <p className="text-xs text-muted-foreground">
                      {speechToTextLoading
                        ? "Checking local speech-to-text runtime status."
                        : speechToTextState?.available === false
                          ? "Speech-to-text is disabled for non-local servers unless explicitly enabled."
                          : activeSpeechDownload?.type === "runtime"
                            ? (activeSpeechDownload.message ?? "Downloading Whisper runtime.")
                            : "The server manages the local whisper.cpp runtime automatically."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="rounded-full border border-border bg-background px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-foreground">
                      {speechToTextLoading ? "Loading" : runtimeStatusLabel}
                    </span>
                    {!speechToTextLoading &&
                    speechToTextState?.available !== false &&
                    speechToTextRepairModelId &&
                    (speechToTextState?.runtimeStatus === "missing" ||
                      speechToTextState?.runtimeStatus === "error") ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={speechToTextBusyKey !== null}
                        onClick={() => void downloadSpeechModel(speechToTextRepairModelId)}
                      >
                        {speechToTextBusyKey === `download:${speechToTextRepairModelId}`
                          ? "Working..."
                          : speechToTextState.runtimeStatus === "error"
                            ? "Repair runtime"
                            : "Download runtime"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background px-3 py-3">
                  <div className="mb-2">
                    <p className="text-sm font-medium text-foreground">
                      Selected speech-to-text model
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Only installed models can be selected for the composer microphone.
                    </p>
                  </div>
                  <Select
                    value={speechToTextState?.selectedModelId ?? undefined}
                    onValueChange={(value) => {
                      if (!value) return;
                      void selectSpeechModel(value);
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label="Selected speech-to-text model"
                      disabled={
                        speechToTextInstalledModels.length === 0 || speechToTextBusyKey !== null
                      }
                    >
                      <SelectValue>
                        {speechToTextInstalledModels.find(
                          (entry) => entry.id === speechToTextState?.selectedModelId,
                        )?.name ?? "No installed speech-to-text models"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {speechToTextInstalledModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                {speechToTextSettings ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-3">
                    <div className="mb-2">
                      <p className="text-sm font-medium text-foreground">
                        Selected refinement model
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Model used for transcript cleanup when STT + cleanup is enabled.
                      </p>
                    </div>
                    <Select
                      value={speechToTextSettings.cleanupModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL}
                      onValueChange={(value) => {
                        if (!value) return;
                        void updateSpeechToTextPreferences({ cleanupModel: value });
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label="Selected refinement model"
                        disabled={speechToTextBusyKey !== null}
                      >
                        <SelectValue>{selectedSpeechCleanupModelLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectGroup>
                          <SelectGroupLabel>Codex</SelectGroupLabel>
                          {speechCleanupCodexModelOptions.map((option) => (
                            <SelectItem key={`codex:${option.slug}`} value={option.slug}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        {speechCleanupClaudeModelOptions.length > 0 ? (
                          <>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectGroupLabel>Claude</SelectGroupLabel>
                              {speechCleanupClaudeModelOptions.map((option) => (
                                <SelectItem key={`claude:${option.slug}`} value={option.slug}>
                                  {option.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </>
                        ) : null}
                      </SelectPopup>
                    </Select>
                  </div>
                ) : null}

                {speechToTextSettings ? (
                  <div className="space-y-4 rounded-lg border border-border bg-background px-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Speech-to-text preferences
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Configure one-pass transcription and optional transcript cleanup.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-medium text-foreground">Language</p>
                        <Select
                          value={speechToTextSettings.language}
                          onValueChange={(value) => {
                            if (!value) return;
                            void updateSpeechToTextPreferences({ language: value });
                          }}
                        >
                          <SelectTrigger className="w-full" disabled={speechToTextBusyKey !== null}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="auto">Auto detect</SelectItem>
                            <SelectItem value="en">English</SelectItem>
                          </SelectPopup>
                        </Select>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-medium text-foreground">Quality profile</p>
                        <Select
                          value={speechToTextSettings.qualityProfile}
                          onValueChange={(value) => {
                            if (!value) return;
                            void updateSpeechToTextPreferences({
                              qualityProfile: value as typeof speechToTextSettings.qualityProfile,
                            });
                          }}
                        >
                          <SelectTrigger className="w-full" disabled={speechToTextBusyKey !== null}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="fast">Fast</SelectItem>
                            <SelectItem value="balanced">Balanced</SelectItem>
                            <SelectItem value="quality">Quality</SelectItem>
                          </SelectPopup>
                        </Select>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-medium text-foreground">Cleanup</p>
                        <p className="mb-2 text-xs text-muted-foreground">
                          The selected speech-to-text model always produces the final transcript.
                        </p>
                        <Select
                          value={speechToTextSettings.refinementMode}
                          onValueChange={(value) => {
                            if (!value) return;
                            void updateSpeechToTextPreferences({
                              refinementMode: value as typeof speechToTextSettings.refinementMode,
                            });
                          }}
                        >
                          <SelectTrigger className="w-full" disabled={speechToTextBusyKey !== null}>
                            <SelectValue>{selectedCleanupModeLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="draft-only">STT only</SelectItem>
                            <SelectItem value="refine-on-stop">STT + cleanup</SelectItem>
                          </SelectPopup>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Voice activity detector
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Use whisper.cpp VAD during transcription for cleaner utterances.
                          </p>
                        </div>
                        <Switch
                          checked={speechToTextSettings.useVad}
                          disabled={speechToTextBusyKey !== null}
                          onCheckedChange={(checked) =>
                            void updateSpeechToTextPreferences({ useVad: checked })
                          }
                          aria-label="Enable speech-to-text VAD"
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">Model warmup</p>
                          <p className="text-xs text-muted-foreground">
                            Prewarm the selected model to reduce cold-start latency.
                          </p>
                        </div>
                        <Switch
                          checked={speechToTextSettings.warmupEnabled}
                          disabled={speechToTextBusyKey !== null}
                          onCheckedChange={(checked) =>
                            void updateSpeechToTextPreferences({ warmupEnabled: checked })
                          }
                          aria-label="Enable speech-to-text model warmup"
                        />
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-xs font-medium text-foreground">Prompt</span>
                      <textarea
                        className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                        value={speechToTextSettings.prompt}
                        disabled={speechToTextBusyKey !== null}
                        onChange={(event) => {
                          void updateSpeechToTextPreferences({ prompt: event.currentTarget.value });
                        }}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Installed models</p>
                    <p className="text-xs text-muted-foreground">
                      Remove models you no longer need from local app storage.
                    </p>
                  </div>
                  {speechToTextInstalledModels.length > 0 ? (
                    <div className="space-y-2">
                      {speechToTextInstalledModels.map((model) => (
                        <div
                          key={model.id}
                          className="flex flex-col gap-3 rounded-lg border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{model.name}</p>
                              <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600">
                                Installed
                              </span>
                              {model.selected ? (
                                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatByteSize(model.sizeBytes)}
                            </p>
                          </div>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={speechToTextBusyKey !== null}
                            onClick={() => void deleteSpeechModel(model.id)}
                          >
                            {speechToTextBusyKey === `delete:${model.id}`
                              ? "Removing..."
                              : "Uninstall"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                      No speech-to-text models are installed yet.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Supported models</p>
                    <p className="text-xs text-muted-foreground">
                      Download curated Whisper models into Sam's Code storage.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {speechToTextCatalog.map((model) => {
                      const isInstalled = speechToTextInstalledModels.some(
                        (entry) => entry.id === model.id,
                      );
                      const isDownloadingModel =
                        activeSpeechDownload?.type === "model" &&
                        activeSpeechDownload.modelId === model.id;
                      const statusText = isDownloadingModel
                        ? `${formatByteSize(activeSpeechDownload.downloadedBytes)} / ${formatByteSize(activeSpeechDownload.totalBytes ?? model.sizeBytes)}`
                        : isInstalled
                          ? "Installed"
                          : `${formatByteSize(model.sizeBytes)} • ${model.language}`;
                      return (
                        <div
                          key={model.id}
                          className="flex flex-col gap-3 rounded-lg border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{model.name}</p>
                              {model.recommended ? (
                                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                                  Recommended
                                </span>
                              ) : null}
                              {isInstalled ? (
                                <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600">
                                  Installed
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {model.description}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
                          </div>
                          <Button
                            size="xs"
                            variant={isInstalled ? "outline" : "default"}
                            disabled={
                              isInstalled || speechToTextBusyKey !== null || isDownloadingModel
                            }
                            onClick={() => void downloadSpeechModel(model.id)}
                          >
                            {isDownloadingModel
                              ? "Downloading..."
                              : isInstalled
                                ? "Installed"
                                : "Download"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {speechToTextState?.errorMessage || speechToTextActionError ? (
                  <p className="text-xs text-destructive">
                    {speechToTextActionError ?? speechToTextState?.errorMessage}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Threads</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose the default workspace mode for newly created draft threads.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Default to New worktree</p>
                  <p className="text-xs text-muted-foreground">
                    New threads start in New worktree mode instead of Local.
                  </p>
                </div>
                <Switch
                  checked={settings.defaultThreadEnvMode === "worktree"}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      defaultThreadEnvMode: checked ? "worktree" : "local",
                    })
                  }
                  aria-label="Default new threads to New worktree mode"
                />
              </div>

              {settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">About</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Application version and environment information.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Version</p>
                  <p className="text-xs text-muted-foreground">
                    Current version of the application.
                  </p>
                </div>
                <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
              </div>
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
