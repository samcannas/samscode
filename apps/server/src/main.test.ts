import * as Http from "node:http";
import { resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/unstable/cli/Command";
import { FetchHttpClient } from "effect/unstable/http";
import { beforeEach } from "vitest";
import { NetService } from "@samscode/shared/Net";

import { CliConfig, scCli, type CliConfigShape } from "./main";
import { ServerConfig, type ServerConfigShape } from "./config";
import { Open, type OpenShape } from "./open";
import { Server, type ServerShape } from "./wsServer";

const start = vi.fn(() => undefined);
const stop = vi.fn(() => undefined);
let resolvedConfig: ServerConfigShape | null = null;
const serverStart = Effect.acquireRelease(
  Effect.gen(function* () {
    resolvedConfig = yield* ServerConfig;
    start();
    return {} as unknown as Http.Server;
  }),
  () => Effect.sync(() => stop()),
);
const findAvailablePort = vi.fn((preferred: number) => Effect.succeed(preferred));

// Shared service layer used by this CLI test suite.
const testLayer = Layer.mergeAll(
  Layer.succeed(CliConfig, {
    cwd: "/tmp/t3-test-workspace",
    fixPath: Effect.void,
  } satisfies CliConfigShape),
  Layer.succeed(NetService, {
    canListenOnHost: () => Effect.succeed(true),
    isPortAvailableOnLoopback: () => Effect.succeed(true),
    reserveLoopbackPort: () => Effect.succeed(0),
    findAvailablePort,
  }),
  Layer.succeed(Server, {
    start: serverStart,
    stopSignal: Effect.void,
  } satisfies ServerShape),
  Layer.succeed(Open, {
    openInEditor: () => Effect.void,
  } satisfies OpenShape),
  FetchHttpClient.layer,
  NodeServices.layer,
);

const runCli = (args: ReadonlyArray<string>, env: Record<string, string> = {}) => {
  return Command.runWith(scCli, { version: "0.0.0-test" })(args).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            ...env,
          },
        }),
      ),
    ),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  resolvedConfig = null;
  start.mockImplementation(() => undefined);
  stop.mockImplementation(() => undefined);
  findAvailablePort.mockImplementation((preferred: number) => Effect.succeed(preferred));
});

it.layer(testLayer)("server CLI command", (it) => {
  it.effect("parses all CLI flags and wires scoped start/stop", () =>
    Effect.gen(function* () {
      yield* runCli([
        "--mode",
        "desktop",
        "--port",
        "4010",
        "--host",
        "0.0.0.0",
        "--home-dir",
        "/tmp/t3-cli-home",
        "--auth-token",
        "auth-secret",
      ]);

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.port, 4010);
      assert.equal(resolvedConfig?.host, "0.0.0.0");
      assert.equal(resolvedConfig?.baseDir, resolve("/tmp/t3-cli-home"));
      assert.equal(resolvedConfig?.stateDir, resolve("/tmp/t3-cli-home/userdata"));
      assert.equal(resolvedConfig?.desktopRendererUrl, undefined);
      assert.equal(resolvedConfig?.authToken, "auth-secret");
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, false);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
      assert.equal(stop.mock.calls.length, 1);
    }),
  );

  it.effect("supports --token as an alias for --auth-token", () =>
    Effect.gen(function* () {
      yield* runCli(["--token", "token-secret"]);

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.authToken, "token-secret");
    }),
  );

  it.effect("uses env fallbacks when flags are not provided", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SAMSCODE_MODE: "desktop",
        SAMSCODE_PORT: "4999",
        SAMSCODE_HOST: "100.88.10.4",
        SAMSCODE_HOME: "/tmp/t3-env-home",
        SAMSCODE_DESKTOP_RENDERER_URL: "http://localhost:5733",
        SAMSCODE_AUTH_TOKEN: "env-token",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.port, 4999);
      assert.equal(resolvedConfig?.host, "100.88.10.4");
      assert.equal(resolvedConfig?.baseDir, resolve("/tmp/t3-env-home"));
      assert.equal(resolvedConfig?.stateDir, resolve("/tmp/t3-env-home/dev"));
      assert.equal(resolvedConfig?.desktopRendererUrl?.toString(), "http://localhost:5733/");
      assert.equal(resolvedConfig?.authToken, "env-token");
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, false);
      assert.equal(resolvedConfig?.logWebSocketEvents, true);
      assert.equal(findAvailablePort.mock.calls.length, 0);
    }),
  );

  it.effect("prefers --mode over SAMSCODE_MODE", () =>
    Effect.gen(function* () {
      findAvailablePort.mockImplementation((_preferred: number) => Effect.succeed(4666));
      yield* runCli(["--mode", "headless"], {
        SAMSCODE_MODE: "desktop",
      });

      assert.deepStrictEqual(findAvailablePort.mock.calls, [[3773]]);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "headless");
      assert.equal(resolvedConfig?.port, 4666);
      assert.equal(resolvedConfig?.host, undefined);
    }),
  );

  it.effect("uses dynamic port discovery in headless mode when port is omitted", () =>
    Effect.gen(function* () {
      findAvailablePort.mockImplementation((_preferred: number) => Effect.succeed(5444));
      yield* runCli([]);

      assert.deepStrictEqual(findAvailablePort.mock.calls, [[3773]]);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.port, 5444);
      assert.equal(resolvedConfig?.mode, "headless");
    }),
  );

  it.effect("uses fixed localhost defaults in desktop mode", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SAMSCODE_MODE: "desktop",
      });

      assert.equal(findAvailablePort.mock.calls.length, 0);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.port, 3773);
      assert.equal(resolvedConfig?.host, "127.0.0.1");
      assert.equal(resolvedConfig?.mode, "desktop");
    }),
  );

  it.effect("allows overriding desktop host with --host", () =>
    Effect.gen(function* () {
      yield* runCli(["--host", "0.0.0.0"], {
        SAMSCODE_MODE: "desktop",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.host, "0.0.0.0");
    }),
  );

  it.effect("supports CLI and env for bootstrap/log websocket toggles", () =>
    Effect.gen(function* () {
      yield* runCli(["--auto-bootstrap-project-from-cwd"], {
        SAMSCODE_MODE: "desktop",
        SAMSCODE_LOG_WS_EVENTS: "false",
        SAMSCODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, true);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
    }),
  );

  it.effect("does not start server for invalid --mode values", () =>
    Effect.gen(function* () {
      yield* runCli(["--mode", "invalid"]);

      assert.equal(start.mock.calls.length, 0);
      assert.equal(stop.mock.calls.length, 0);
    }),
  );

  it.effect("does not start server for out-of-range --port values", () =>
    Effect.gen(function* () {
      yield* runCli(["--port", "70000"]);

      // effect/unstable/cli renders help/errors for parse failures and returns success.
      assert.equal(start.mock.calls.length, 0);
      assert.equal(stop.mock.calls.length, 0);
    }),
  );
});
