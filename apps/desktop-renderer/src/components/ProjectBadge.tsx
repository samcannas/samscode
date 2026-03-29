/**
 * Colored two-letter badge for projects, matching the JetBrains project icon style.
 */

const PROJECT_BADGE_COLORS = [
  { bg: "bg-orange-600", text: "text-white" },
  { bg: "bg-emerald-600", text: "text-white" },
  { bg: "bg-violet-600", text: "text-white" },
  { bg: "bg-sky-600", text: "text-white" },
  { bg: "bg-rose-600", text: "text-white" },
  { bg: "bg-amber-500", text: "text-neutral-900" },
  { bg: "bg-teal-600", text: "text-white" },
  { bg: "bg-pink-600", text: "text-white" },
] as const;

function getProjectBadgeColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return PROJECT_BADGE_COLORS[Math.abs(hash) % PROJECT_BADGE_COLORS.length]!;
}

function getProjectInitials(name: string): string {
  const parts = name.split(/[\s_\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface ProjectBadgeProps {
  name: string;
  size?: "sm" | "md";
  className?: string;
}

export function ProjectBadge({ name, size = "sm", className = "" }: ProjectBadgeProps) {
  const color = getProjectBadgeColor(name);
  const initials = getProjectInitials(name);
  const sizeClasses =
    size === "md" ? "size-6 text-[11px] rounded-[4px]" : "size-[18px] text-[9px] rounded-[3px]";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-bold leading-none ${sizeClasses} ${color.bg} ${color.text} ${className}`}
    >
      {initials}
    </span>
  );
}
