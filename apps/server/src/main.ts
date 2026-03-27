/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import { Config, Data, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@samscode/shared/Net";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { fixPath, resolveBaseDir } from "./os-jank";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { Server } from "./wsServer";
import { ServerLoggerLive } from "./serverLogger";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly samscodeHome: Option.Option<string>;
  readonly authToken: Option.Option<string>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "samscode/main/CliConfig",
) {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.succeed({
      cwd: process.cwd(),
      fixPath: Effect.sync(fixPath),
    } satisfies CliConfigShape),
  );
}

const CliEnvConfig = Config.all({
  mode: Config.string("SAMSCODE_MODE").pipe(
    Config.option,
    Config.map(
      Option.match<RuntimeMode, string>({
        onNone: () => "headless",
        onSome: (value) => (value === "desktop" ? "desktop" : "headless"),
      }),
    ),
  ),
  port: Config.port("SAMSCODE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("SAMSCODE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  samscodeHome: Config.string("SAMSCODE_HOME").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  desktopRendererUrl: Config.url("SAMSCODE_DESKTOP_RENDERER_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  authToken: Config.string("SAMSCODE_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("SAMSCODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("SAMSCODE_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.asEffect().pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );

      const mode = Option.getOrElse(input.mode, () => env.mode);

      const port = yield* Option.match(input.port, {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (env.port) {
            return Effect.succeed(env.port);
          }
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      });

      const desktopRendererUrl = env.desktopRendererUrl;
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(input.samscodeHome) ?? env.samscodeHome,
      );
      const derivedPaths = yield* deriveServerPaths(baseDir, desktopRendererUrl);
      const authToken = Option.getOrUndefined(input.authToken) ?? env.authToken;
      const autoBootstrapProjectFromCwd = resolveBooleanFlag(
        input.autoBootstrapProjectFromCwd,
        env.autoBootstrapProjectFromCwd ?? mode === "headless",
      );
      const logWebSocketEvents = resolveBooleanFlag(
        input.logWebSocketEvents,
        env.logWebSocketEvents ?? Boolean(desktopRendererUrl),
      );
      const host =
        Option.getOrUndefined(input.host) ??
        env.host ??
        (mode === "desktop" ? "127.0.0.1" : undefined);

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        host,
        baseDir,
        ...derivedPaths,
        desktopRendererUrl,
        authToken,
        autoBootstrapProjectFromCwd,
        logWebSocketEvents,
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) =>
  Layer.empty.pipe(
    Layer.provideMerge(makeServerRuntimeServicesLayer()),
    Layer.provideMerge(makeServerProviderLayer()),
    Layer.provideMerge(ProviderHealthLive),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );

const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    const { start, stopSignal } = yield* Server;
    yield* cliConfig.fixPath;

    const config = yield* ServerConfig;

    yield* start;

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const { authToken, desktopRendererUrl, ...safeConfig } = config;
    yield* Effect.logInfo("Sam's Code running", {
      ...safeConfig,
      desktopRendererUrl: desktopRendererUrl?.toString(),
      bindUrl,
      authEnabled: Boolean(authToken),
    });

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["headless", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const samscodeHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all Sam's Code data (equivalent to SAMSCODE_HOME)."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to SAMSCODE_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

export const scCli = Command.make("sc", {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  samscodeHome: samscodeHomeFlag,
  authToken: authTokenFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(
  Command.withDescription("Run the Sam's Code server."),
  Command.withHandler((input) => Effect.scoped(makeServerProgram(input))),
);
