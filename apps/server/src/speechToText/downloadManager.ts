import { promises as fs } from "node:fs";

export async function downloadFileToPath(input: {
  url: string;
  destinationPath: string;
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => Promise<void> | void;
}): Promise<void> {
  const response = await fetch(input.url, {
    headers: {
      "user-agent": "Sam's Code",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const totalHeader = response.headers.get("content-length");
  const totalBytes =
    totalHeader && Number.isFinite(Number(totalHeader)) ? Number(totalHeader) : null;
  const handle = await fs.open(input.destinationPath, "w");
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      downloadedBytes += next.value.byteLength;
      await handle.write(next.value);
      await input.onProgress?.(downloadedBytes, totalBytes);
    }
  } finally {
    await handle.close();
  }
}
