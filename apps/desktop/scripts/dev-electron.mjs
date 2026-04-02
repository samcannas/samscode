import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";
import waitOn from "wait-on";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const port = Number(process.env.ELECTRON_RENDERER_PORT ?? 5733);
const devServerUrl = `http://localhost:${port}`;
const serverDir = join(desktopDir, "../server");
const requiredFiles = [
  "dist-electron/main.js",
  "dist-electron/preload.js",
  "../server/dist/index.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.js", "preload.js"]) },
  { directory: "../server/dist", files: new Set(["index.mjs"]) },
];
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let serverBundleWatcher = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function killChildTreeByPid(pid, signal) {
  if (process.platform === "win32" || typeof pid !== "number") {
    return;
  }

  spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function cleanupStaleDevApps() {
  if (process.platform === "win32") {
    return;
  }

  spawnSync("pkill", ["-f", "--", `--samscode-dev-root=${desktopDir}`], { stdio: "ignore" });
}

function startServerBundleWatcher() {
  if (serverBundleWatcher) {
    return;
  }

  serverBundleWatcher = spawn("bun", ["x", "tsdown", "--watch"], {
    cwd: serverDir,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  serverBundleWatcher.once("exit", (code, signal) => {
    const exitedWatcher = serverBundleWatcher;
    serverBundleWatcher = null;

    if (shuttingDown) {
      return;
    }

    console.error(
      `[desktop-dev] server bundle watcher exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    );

    if (exitedWatcher) {
      setTimeout(() => {
        if (!shuttingDown && serverBundleWatcher === null) {
          startServerBundleWatcher();
        }
      }, restartDebounceMs).unref();
    }
  });
}

async function stopServerBundleWatcher() {
  const watcher = serverBundleWatcher;
  if (!watcher) {
    return;
  }

  serverBundleWatcher = null;

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    watcher.once("exit", finish);
    watcher.kill("SIGTERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      watcher.kill("SIGKILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const app = spawn(
    resolveElectronPath(),
    [`--samscode-dev-root=${desktopDir}`, "dist-electron/main.js"],
    {
      cwd: desktopDir,
      env: {
        ...childEnv,
        SAMSCODE_DESKTOP_RENDERER_URL: devServerUrl,
      },
      stdio: "inherit",
    },
  );

  currentApp = app;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally = signal !== null || code !== 0;
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "TERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "KILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = watch(
      join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (process.platform === "win32") {
    return;
  }

  // Kill direct children as a final fallback in case normal shutdown leaves stragglers.
  spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], { stdio: "ignore" });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  await stopServerBundleWatcher();
  killChildTree("TERM");
  await new Promise((resolve) => {
    setTimeout(resolve, childTreeGracePeriodMs);
  });
  killChildTree("KILL");

  process.exit(exitCode);
}

startServerBundleWatcher();
await waitOn({
  resources: [`tcp:${port}`, ...requiredFiles.map((filePath) => `file:${filePath}`)],
});

startWatchers();
cleanupStaleDevApps();
startApp();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
