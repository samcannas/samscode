import { spawn, spawnSync } from "node:child_process";
import { resolveCliBinary } from "./src/provider/resolveCliBinary";
const bin = resolveCliBinary("codex");
console.log("bin", bin);
const app = spawn(bin, ["app-server"], { shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
app.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
app.stdout.on("data", () => {});
setTimeout(() => {
  const result = spawnSync(bin, ["--version"], { shell: process.platform === "win32", encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "pipe"] });
  console.log(JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2));
  app.kill();
}, 2000);
