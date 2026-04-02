import * as FS from "node:fs";

export interface ServerBootstrapConfig {
  readonly authToken?: string;
}

function readBootstrapFdValue(env: NodeJS.ProcessEnv): number | null {
  const rawFd = env.SAMSCODE_BOOTSTRAP_FD?.trim();
  if (!rawFd) return null;
  const fd = Number(rawFd);
  return Number.isInteger(fd) && fd >= 0 ? fd : null;
}

export function readBootstrapConfig(env: NodeJS.ProcessEnv = process.env): ServerBootstrapConfig {
  const fd = readBootstrapFdValue(env);
  if (fd === null) {
    return {};
  }

  let raw = "";
  try {
    raw = FS.readFileSync(fd, "utf8");
  } catch {
    return {};
  } finally {
    try {
      FS.closeSync(fd);
    } catch {
      // Ignore close errors for inherited bootstrap descriptors.
    }
  }

  if (raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as { authToken?: unknown };
    return typeof parsed.authToken === "string" && parsed.authToken.trim().length > 0
      ? { authToken: parsed.authToken }
      : {};
  } catch {
    return {};
  }
}
