import { Effect, FileSystem, Path, Schema } from "effect";
import {
  type ServerRuntimeSettings,
  ServerRuntimeSettings as ServerRuntimeSettingsSchema,
  type ServerUpdateSettingsInput,
} from "@samscode/contracts";

import { ServerConfig } from "./config";

const SERVER_SETTINGS_FILE = "server-settings.json";
const DEFAULT_SERVER_SETTINGS: ServerRuntimeSettings = Schema.decodeUnknownSync(
  ServerRuntimeSettingsSchema,
)({});

let cachedSettings: ServerRuntimeSettings | null = null;
let cachedSettingsPath: string | null = null;

type ServerSettingsDeps = {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly stateDir: string;
};

function normalizeNullablePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mergeSettings(
  current: ServerRuntimeSettings,
  patch: ServerUpdateSettingsInput,
): ServerRuntimeSettings {
  return Schema.decodeUnknownSync(ServerRuntimeSettingsSchema)({
    ...current,
    ...(patch.codexBinaryPath !== undefined
      ? { codexBinaryPath: normalizeNullablePath(patch.codexBinaryPath) }
      : {}),
    ...(patch.codexHomePath !== undefined
      ? { codexHomePath: normalizeNullablePath(patch.codexHomePath) }
      : {}),
    ...(patch.claudeBinaryPath !== undefined
      ? { claudeBinaryPath: normalizeNullablePath(patch.claudeBinaryPath) }
      : {}),
    ...(patch.textGenerationProvider !== undefined
      ? { textGenerationProvider: patch.textGenerationProvider }
      : {}),
    ...(patch.textGenerationModel !== undefined
      ? { textGenerationModel: patch.textGenerationModel }
      : {}),
  });
}

function resolveSettingsPath(deps: ServerSettingsDeps): string {
  return deps.path.join(deps.stateDir, SERVER_SETTINGS_FILE);
}

export function readServerSettingsWith(
  deps: ServerSettingsDeps,
): Effect.Effect<ServerRuntimeSettings> {
  const settingsPath = resolveSettingsPath(deps);
  if (cachedSettings !== null && cachedSettingsPath === settingsPath) {
    return Effect.succeed(cachedSettings);
  }

  return deps.fileSystem.readFileString(settingsPath).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(ServerRuntimeSettingsSchema)(JSON.parse(raw)),
        catch: () => DEFAULT_SERVER_SETTINGS,
      }),
    ),
    Effect.catch(() => Effect.succeed(DEFAULT_SERVER_SETTINGS)),
    Effect.tap((loaded) =>
      Effect.sync(() => {
        cachedSettings = loaded;
        cachedSettingsPath = settingsPath;
      }),
    ),
  );
}

export function updateServerSettingsWith(
  deps: ServerSettingsDeps,
  patch: ServerUpdateSettingsInput,
) {
  return Effect.gen(function* () {
    const settingsPath = resolveSettingsPath(deps);
    const nextSettings = mergeSettings(yield* readServerSettingsWith(deps), patch);
    cachedSettings = nextSettings;
    cachedSettingsPath = settingsPath;

    yield* deps.fileSystem.makeDirectory(deps.stateDir, { recursive: true });
    const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    yield* deps.fileSystem.writeFileString(tempPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
    yield* deps.fileSystem
      .rename(tempPath, settingsPath)
      .pipe(
        Effect.catch(() =>
          deps.fileSystem
            .copyFile(tempPath, settingsPath)
            .pipe(
              Effect.flatMap(() =>
                deps.fileSystem.remove(tempPath).pipe(Effect.orElseSucceed(() => undefined)),
              ),
            ),
        ),
      );
    return nextSettings;
  });
}

export const getServerSettings = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig;
  return yield* readServerSettingsWith({ fileSystem, path, stateDir });
});

export const updateServerSettings = (patch: ServerUpdateSettingsInput) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig;
    return yield* updateServerSettingsWith({ fileSystem, path, stateDir }, patch);
  });
