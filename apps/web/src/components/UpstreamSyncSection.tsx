import {
  type UpstreamSyncDecision,
  type UpstreamSyncReleaseCandidate,
  DEFAULT_MODEL_BY_PROVIDER,
} from "@samscode/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { inferProviderForModel } from "@samscode/shared/model";

import { ensureNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { truncateTitle } from "~/truncateTitle";
import {
  upstreamSyncQueryKeys,
  upstreamSyncReleaseQueryOptions,
  upstreamSyncStatusQueryOptions,
} from "~/lib/upstreamSyncReactQuery";
import { useStore } from "~/store";

const DECISION_OPTIONS: Array<{ value: Exclude<UpstreamSyncDecision, "pending">; label: string }> =
  [
    { value: "adapt", label: "Adapt" },
    { value: "adopt", label: "Adopt" },
    { value: "ignore", label: "Ignore" },
    { value: "defer", label: "Defer" },
    { value: "already-present", label: "Already present" },
  ];

function candidateDecisionLabel(candidate: UpstreamSyncReleaseCandidate): string {
  if (candidate.decision === "pending") {
    return "Choose decision";
  }
  return (
    DECISION_OPTIONS.find((option) => option.value === candidate.decision)?.label ??
    candidate.decision
  );
}

function commitShortSha(commitSha: string): string {
  return commitSha.slice(0, 7);
}

function buildImplementationThreadTitle(input: string): string {
  return truncateTitle(input, 50);
}

export function UpstreamSyncSection(props: {
  serverCwd: string | null;
  enableAssistantStreaming: boolean;
}) {
  const { serverCwd, enableAssistantStreaming } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const [activeReleaseTag, setActiveReleaseTag] = useState<string | null>(null);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [isFetchingNextRelease, setIsFetchingNextRelease] = useState(false);
  const [isStartingImplementation, setIsStartingImplementation] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const statusQuery = useQuery(upstreamSyncStatusQueryOptions({ cwd: serverCwd }));
  const releaseQuery = useQuery(
    upstreamSyncReleaseQueryOptions({
      cwd: serverCwd,
      tag: activeReleaseTag,
      enabled: activeReleaseTag !== null,
    }),
  );

  const currentProject = useMemo(() => {
    if (!serverCwd) {
      return null;
    }
    return projects.find((project) => project.cwd === serverCwd) ?? null;
  }, [projects, serverCwd]);

  useEffect(() => {
    const nextTag = statusQuery.data?.activeReleaseTag ?? null;
    if (!nextTag) {
      return;
    }
    setActiveReleaseTag((existing) => existing ?? nextTag);
  }, [statusQuery.data?.activeReleaseTag]);

  useEffect(() => {
    const release = releaseQuery.data;
    if (!release) {
      return;
    }
    setNoteDrafts((existing) => {
      const nextDrafts = { ...existing };
      for (const candidate of release.candidates) {
        if (!Object.hasOwn(existing, candidate.id)) {
          nextDrafts[candidate.id] = candidate.note ?? "";
        }
      }
      return nextDrafts;
    });
  }, [releaseQuery.data]);

  const selectedCandidateCount =
    releaseQuery.data?.candidates.filter(
      (candidate) => candidate.decision === "adopt" || candidate.decision === "adapt",
    ).length ?? 0;

  const refreshStatus = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: upstreamSyncQueryKeys.all });
  }, [queryClient]);

  const reviewNextRelease = useCallback(async () => {
    if (!serverCwd || isFetchingNextRelease) {
      return;
    }
    setIsFetchingNextRelease(true);
    try {
      const api = ensureNativeApi();
      const release = await api.upstreamSync.fetchNextRelease({ cwd: serverCwd });
      if (!release) {
        toastManager.add({
          type: "info",
          title: "No newer T3 releases",
          description: "This repo is already caught up with the latest fetched upstream release.",
        });
        await refreshStatus();
        return;
      }
      queryClient.setQueryData(upstreamSyncQueryKeys.release(serverCwd, release.tag), release);
      setActiveReleaseTag(release.tag);
      await refreshStatus();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not review next release",
        description: error instanceof Error ? error.message : "Upstream sync fetch failed.",
      });
    } finally {
      setIsFetchingNextRelease(false);
    }
  }, [isFetchingNextRelease, queryClient, refreshStatus, serverCwd]);

  const saveCandidateDecision = useCallback(
    async (
      candidate: UpstreamSyncReleaseCandidate,
      decision: UpstreamSyncDecision,
      note: string,
    ) => {
      if (!serverCwd || !activeReleaseTag) {
        return;
      }
      setBusyCandidateId(candidate.id);
      try {
        const api = ensureNativeApi();
        const nextRelease = await api.upstreamSync.updateCandidate({
          cwd: serverCwd,
          tag: activeReleaseTag,
          candidateId: candidate.id,
          decision,
          note,
        });
        queryClient.setQueryData(
          upstreamSyncQueryKeys.release(serverCwd, activeReleaseTag),
          nextRelease,
        );
        await refreshStatus();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Could not save ${candidate.title}`,
          description: error instanceof Error ? error.message : "Upstream candidate update failed.",
        });
      } finally {
        setBusyCandidateId(null);
      }
    },
    [activeReleaseTag, queryClient, refreshStatus, serverCwd],
  );

  const onDecisionChange = useCallback(
    (
      candidate: UpstreamSyncReleaseCandidate,
      decision: Exclude<UpstreamSyncDecision, "pending">,
    ) => {
      const note = noteDrafts[candidate.id] ?? candidate.note ?? "";
      void saveCandidateDecision(candidate, decision, note);
    },
    [noteDrafts, saveCandidateDecision],
  );

  const onNoteBlur = useCallback(
    (candidate: UpstreamSyncReleaseCandidate) => {
      const nextNote = noteDrafts[candidate.id] ?? "";
      if ((candidate.note ?? "") === nextNote) {
        return;
      }
      void saveCandidateDecision(candidate, candidate.decision, nextNote);
    },
    [noteDrafts, saveCandidateDecision],
  );

  const startImplementationThread = useCallback(async () => {
    if (!serverCwd || !activeReleaseTag || !currentProject || isStartingImplementation) {
      return;
    }
    setIsStartingImplementation(true);
    try {
      const api = ensureNativeApi();
      const promptResult = await api.upstreamSync.generateImplementationPrompt({
        cwd: serverCwd,
        tag: activeReleaseTag,
      });
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const provider = inferProviderForModel(
        currentProject.model || DEFAULT_MODEL_BY_PROVIDER.codex,
      );
      const matchingThread =
        threads.find((thread) => thread.projectId === currentProject.id) ?? null;

      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: currentProject.id,
        title: buildImplementationThreadTitle(promptResult.threadTitle),
        model: currentProject.model || DEFAULT_MODEL_BY_PROVIDER.codex,
        interactionMode: "default",
        branch: matchingThread?.branch ?? null,
        worktreePath: matchingThread?.worktreePath ?? null,
        createdAt,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: promptResult.prompt,
          attachments: [],
        },
        provider,
        model: currentProject.model || DEFAULT_MODEL_BY_PROVIDER.codex,
        assistantDeliveryMode: enableAssistantStreaming ? "streaming" : "buffered",
        interactionMode: "default",
        createdAt,
      });
      const snapshot = await api.orchestration.getSnapshot();
      syncServerReadModel(snapshot);
      toastManager.add({
        type: "success",
        title: `Started ${promptResult.releaseTag} implementation thread`,
        description: `Queued ${promptResult.selectedCandidateIds.length} selected upstream changes for implementation.`,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not start implementation thread",
        description:
          error instanceof Error ? error.message : "Failed to create the implementation thread.",
      });
    } finally {
      setIsStartingImplementation(false);
    }
  }, [
    activeReleaseTag,
    currentProject,
    enableAssistantStreaming,
    isStartingImplementation,
    navigate,
    serverCwd,
    syncServerReadModel,
    threads,
  ]);

  const canImplement =
    selectedCandidateCount > 0 && currentProject !== null && activeReleaseTag !== null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">T3 Upstream Sync</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Review upstream T3 releases, choose what to adopt, and launch an implementation thread
            for the selected changes.
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void reviewNextRelease()}
          disabled={!serverCwd || isFetchingNextRelease}
        >
          {isFetchingNextRelease ? "Reviewing..." : "Review next release"}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-border bg-background px-3 py-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-foreground">Tracked repo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusQuery.data?.upstreamRepo ?? "Loading upstream metadata..."}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">Fork origin</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusQuery.data?.baseReleaseTag ?? "Resolving..."}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">Current parity</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusQuery.data?.lastFullyTriagedReleaseTag ?? "Resolving..."}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">Next upstream release</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusQuery.data?.nextReleaseTag ??
                statusQuery.data?.latestReleaseTag ??
                "No newer release found"}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-foreground">Metadata files</p>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">
              {statusQuery.data?.metadataPath ?? "Preparing upstream metadata..."}
            </p>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">
              {statusQuery.data?.areasPath ?? "Preparing area policies..."}
            </p>
          </div>
        </div>

        {!currentProject ? (
          <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
            Upstream sync can review this repo now, but implementation threads stay disabled until
            the current workspace root is present in the project list.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background px-3 py-3 text-xs text-muted-foreground">
            Implementation target project:{" "}
            <span className="font-medium text-foreground">{currentProject.name}</span>
          </div>
        )}

        {statusQuery.error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive">
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : "Could not load upstream sync status."}
          </div>
        ) : null}

        {releaseQuery.error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive">
            {releaseQuery.error instanceof Error
              ? releaseQuery.error.message
              : "Could not load release details."}
          </div>
        ) : null}

        {releaseQuery.data ? (
          <div className="space-y-4 rounded-xl border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{releaseQuery.data.tag}</h3>
                  {releaseQuery.data.triagedAt ? (
                    <Badge variant="outline">Triaged</Badge>
                  ) : (
                    <Badge variant="outline">In review</Badge>
                  )}
                  {selectedCandidateCount > 0 ? (
                    <Badge variant="outline">{selectedCandidateCount} selected</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {releaseQuery.data.name ?? "Upstream release"}
                  {releaseQuery.data.publishedAt
                    ? ` • ${new Date(releaseQuery.data.publishedAt).toLocaleString()}`
                    : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {releaseQuery.data.previousTag
                    ? `Compared against ${releaseQuery.data.previousTag}`
                    : "No previous upstream tag recorded."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canImplement || isStartingImplementation}
                  onClick={() => void startImplementationThread()}
                >
                  {isStartingImplementation ? "Starting..." : "Implement selected changes"}
                </Button>
              </div>
            </div>

            {releaseQuery.data.releaseNotes.trim().length > 0 ? (
              <details className="rounded-lg border border-border bg-background px-3 py-3">
                <summary className="cursor-pointer text-xs font-medium text-foreground">
                  Release notes
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {releaseQuery.data.releaseNotes}
                </pre>
              </details>
            ) : null}

            <div className="space-y-3">
              {releaseQuery.data.candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className="rounded-lg border border-border bg-background px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{candidate.title}</p>
                        <Badge variant="outline">{candidate.category}</Badge>
                        <Badge variant="outline">{commitShortSha(candidate.commitSha)}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {candidate.areas.map((area) => (
                          <span
                            key={`${candidate.id}:${area}`}
                            className="rounded bg-muted px-1.5 py-0.5 text-foreground/80"
                          >
                            {area}
                          </span>
                        ))}
                      </div>
                      {candidate.summary.trim().length > 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">{candidate.summary}</p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Recommended:{" "}
                        <span className="font-medium text-foreground">
                          {candidate.recommendedDecision}
                        </span>
                        {candidate.recommendedReason ? ` - ${candidate.recommendedReason}` : ""}
                      </p>
                    </div>

                    <Select
                      value={candidate.decision === "pending" ? "" : candidate.decision}
                      onValueChange={(value) => {
                        if (!value || !DECISION_OPTIONS.some((option) => option.value === value)) {
                          return;
                        }
                        onDecisionChange(
                          candidate,
                          value as Exclude<UpstreamSyncDecision, "pending">,
                        );
                      }}
                    >
                      <SelectTrigger
                        className="w-44"
                        aria-label={`Decision for ${candidate.title}`}
                      >
                        <SelectValue>{candidateDecisionLabel(candidate)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end">
                        {DECISION_OPTIONS.map((option) => (
                          <SelectItem key={`${candidate.id}:${option.value}`} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-foreground">Fork notes</span>
                      <Textarea
                        value={noteDrafts[candidate.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((existing) => ({
                            ...existing,
                            [candidate.id]: event.target.value,
                          }))
                        }
                        onBlur={() => onNoteBlur(candidate)}
                        placeholder="Why keep, adapt, skip, or defer this upstream change?"
                        rows={3}
                      />
                    </label>

                    <div className="space-y-2">
                      <a
                        className="block text-xs text-primary underline-offset-2 hover:underline"
                        href={candidate.commitUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open upstream commit
                      </a>
                      <details className="rounded-md border border-border bg-background px-2 py-2">
                        <summary className="cursor-pointer text-xs font-medium text-foreground">
                          Changed files ({candidate.changedFiles.length})
                        </summary>
                        <div className="mt-2 max-h-40 overflow-auto space-y-1">
                          {candidate.changedFiles.length > 0 ? (
                            candidate.changedFiles.map((filePath) => (
                              <code
                                key={`${candidate.id}:${filePath}`}
                                className="block text-[11px] text-muted-foreground"
                              >
                                {filePath}
                              </code>
                            ))
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              No changed file metadata available.
                            </p>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>

                  {busyCandidateId === candidate.id ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">Saving decision...</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
            Review the next upstream release to load candidate changes and start triaging what
            should land in Sam's Code.
          </div>
        )}
      </div>
    </section>
  );
}
