/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect";

export const DEFAULT_PORT = 3773;

export type RuntimeMode = "headless" | "desktop";

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly keybindingsConfigPath: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
}

/**
 * ServerConfigShape - Process/runtime configuration required by the server.
 */
export interface ServerConfigShape extends ServerDerivedPaths {
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly host: string | undefined;
  readonly cwd: string;
  readonly baseDir: string;
  readonly desktopRendererUrl: URL | undefined;
  readonly authToken: string | undefined;
  readonly autoBootstrapProjectFromCwd: boolean;
  readonly logWebSocketEvents: boolean;
}

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfigShape["baseDir"],
  desktopRendererUrl: ServerConfigShape["desktopRendererUrl"],
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(baseDir, desktopRendererUrl !== undefined ? "dev" : "userdata");
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  return {
    stateDir,
    dbPath,
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
  };
});

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends ServiceMap.Service<ServerConfig, ServerConfigShape>()(
  "samscode/config/ServerConfig",
) {
  static readonly layerTest = (cwd: string, baseDirOrPrefix: string | { prefix: string }) =>
    Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const desktopRendererUrl = undefined;

        const fs = yield* FileSystem.FileSystem;
        const baseDir =
          typeof baseDirOrPrefix === "string"
            ? baseDirOrPrefix
            : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
        const derivedPaths = yield* deriveServerPaths(baseDir, desktopRendererUrl);

        yield* fs.makeDirectory(derivedPaths.stateDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.logsDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true });

        return {
          cwd,
          baseDir,
          ...derivedPaths,
          mode: "headless",
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
          port: 0,
          host: undefined,
          authToken: undefined,
          desktopRendererUrl,
        } satisfies ServerConfigShape;
      }),
    );
}
