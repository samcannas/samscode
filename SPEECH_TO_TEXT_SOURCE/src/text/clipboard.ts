import clipboard from "clipboardy";

export interface ClipboardSnapshot {
  text: string;
}

export async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  return { text: await clipboard.read() };
}

export async function restoreClipboard(snapshot: ClipboardSnapshot): Promise<void> {
  await clipboard.write(snapshot.text);
}

export async function writeClipboardText(text: string): Promise<void> {
  await clipboard.write(text);
}
