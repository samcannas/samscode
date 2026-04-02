#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const port = Number.parseInt(process.env.SAMSCODE_MOCK_UPDATE_PORT ?? "31337", 10);
const rootDir = path.resolve(process.argv[2] ?? "release");

const contentTypes = new Map<string, string>([
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".zip", "application/zip"],
  [".exe", "application/vnd.microsoft.portable-executable"],
  [".dmg", "application/x-apple-diskimage"],
  [".appimage", "application/octet-stream"],
  [".blockmap", "application/octet-stream"],
]);

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(absolutePath);
      }
      return [absolutePath];
    }),
  );
  return nested.flat();
}

await access(rootDir);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/" || url.pathname === "/index.json") {
    const files = await listFiles(rootDir);
    const payload = await Promise.all(
      files.map(async (filePath) => {
        const fileInfo = await stat(filePath);
        return {
          path: path.relative(rootDir, filePath).replaceAll("\\", "/"),
          size: fileInfo.size,
        };
      }),
    );
    sendJson(res, 200, {
      rootDir,
      feedUrl: `http://127.0.0.1:${port}/`,
      files: payload.toSorted((left, right) => left.path.localeCompare(right.path)),
    });
    return;
  }

  const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!absolutePath.startsWith(rootDir)) {
    sendJson(res, 400, { error: "Path escapes update root." });
    return;
  }

  try {
    const fileInfo = await stat(absolutePath);
    if (!fileInfo.isFile()) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    res.writeHead(200, {
      "content-length": String(fileInfo.size),
      "content-type":
        contentTypes.get(path.extname(absolutePath).toLowerCase()) ?? "application/octet-stream",
    });
    createReadStream(absolutePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    [
      `Mock desktop update server listening on http://127.0.0.1:${port}/`,
      `Serving ${rootDir}`,
      `Set SAMSCODE_DESKTOP_UPDATE_FEED_URL=http://127.0.0.1:${port}/ before launching the packaged desktop app.`,
    ].join("\n"),
  );
});
