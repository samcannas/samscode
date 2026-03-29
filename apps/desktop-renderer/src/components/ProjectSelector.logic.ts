export function getAdjacentProjectIdInCycle<TProject extends { id: string }>(
  projects: readonly TProject[],
  activeProjectId: string | null,
  direction: 1 | -1,
): string | null {
  if (projects.length === 0) {
    return null;
  }

  const activeProjectIndex =
    activeProjectId === null ? -1 : projects.findIndex((project) => project.id === activeProjectId);

  if (activeProjectIndex < 0) {
    return direction === 1 ? (projects[0]?.id ?? null) : (projects.at(-1)?.id ?? null);
  }

  const nextProjectIndex = (activeProjectIndex + direction + projects.length) % projects.length;

  return projects[nextProjectIndex]?.id ?? null;
}
