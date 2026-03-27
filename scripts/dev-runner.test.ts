import * as NodeServices from "@effect/platform-node/NodeServices";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  createDevRunnerEnv,
  findFirstAvailableOffset,
  resolveModePortOffsets,
  resolveOffset,
} from "./dev-runner.ts";

it.layer(NodeServices.layer)("dev-runner", (it) => {
  describe("resolveOffset", () => {
    it.effect("uses explicit SAMSCODE_PORT_OFFSET when provided", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: 12, devInstance: undefined });
        assert.deepStrictEqual(result, {
          offset: 12,
          source: "SAMSCODE_PORT_OFFSET=12",
        });
      }),
    );

    it.effect("hashes non-numeric instance values", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: undefined, devInstance: "feature-branch" });
        assert.ok(result.offset >= 1);
        assert.ok(result.offset <= 3000);
      }),
    );

    it.effect("throws for negative port offset", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.try({
            try: () => resolveOffset({ portOffset: -1, devInstance: undefined }),
            catch: (cause) => String(cause),
          }),
        );

        assert.ok(error.includes("Invalid SAMSCODE_PORT_OFFSET"));
      }),
    );
  });

  describe("createDevRunnerEnv", () => {
    it.effect("defaults SAMSCODE_HOME to ~/.samscode when not provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          rendererOffset: 0,
          samscodeHome: undefined,
          authToken: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
        });

        assert.equal(env.SAMSCODE_HOME, resolve(homedir(), ".samscode"));
      }),
    );

    it.effect("supports explicit typed overrides", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: {},
          serverOffset: 0,
          rendererOffset: 0,
          samscodeHome: "/tmp/custom-samscode",
          authToken: "secret",
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: true,
          host: "0.0.0.0",
          port: 4222,
        });

        assert.equal(env.SAMSCODE_HOME, resolve("/tmp/custom-samscode"));
        assert.equal(env.SAMSCODE_PORT, "4222");
        assert.equal(env.VITE_WS_URL, "ws://localhost:4222");
        assert.equal(env.ELECTRON_RENDERER_PORT, "5733");
        assert.equal(env.SAMSCODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "0");
        assert.equal(env.SAMSCODE_LOG_WS_EVENTS, "1");
        assert.equal(env.SAMSCODE_HOST, "0.0.0.0");
      }),
    );

    it.effect("does not force websocket logging on in dev mode when unset", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            SAMSCODE_LOG_WS_EVENTS: "keep-me-out",
          },
          serverOffset: 0,
          rendererOffset: 0,
          samscodeHome: undefined,
          authToken: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
        });

        assert.equal(env.SAMSCODE_LOG_WS_EVENTS, undefined);
      }),
    );

    it.effect("forwards explicit websocket logging false without coercing it away", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          rendererOffset: 0,
          samscodeHome: undefined,
          authToken: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: false,
          host: undefined,
          port: undefined,
        });

        assert.equal(env.SAMSCODE_LOG_WS_EVENTS, "0");
      }),
    );

    it.effect("uses custom samscodeHome when provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          rendererOffset: 0,
          samscodeHome: "/tmp/my-samscode",
          authToken: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
        });

        assert.equal(env.SAMSCODE_HOME, resolve("/tmp/my-samscode"));
      }),
    );
  });

  describe("findFirstAvailableOffset", () => {
    it.effect("returns the starting offset when required ports are available", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireRendererPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 0);
      }),
    );

    it.effect("advances until all required ports are available", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733, 3774, 5734]);
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireRendererPort: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.equal(offset, 2);
      }),
    );

    it.effect("allows offsets where only non-required ports exceed max", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 59_803,
          requireServerPort: true,
          requireRendererPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 59_803);
      }),
    );
  });

  describe("resolveModePortOffsets", () => {
    it.effect("uses a shared fallback offset for dev mode", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev",
          startOffset: 0,
          hasExplicitServerPort: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, rendererOffset: 1 });
      }),
    );

    it.effect("shifts only server offset for dev:server", () =>
      Effect.gen(function* () {
        const taken = new Set([3773]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, rendererOffset: 1 });
      }),
    );

    it.effect("respects explicit server port override for dev:server", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: true,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, rendererOffset: 0 });
      }),
    );
  });
});
