import type { InsertTextOptions, TextInserter } from "./text-inserter.js";
import { snapshotClipboard, restoreClipboard, writeClipboardText } from "./clipboard.js";
import { sleep } from "../common/fs.js";
import { InsertionError } from "../common/errors.js";
import { NutjsKeystrokeDriver } from "./nutjs-keystroke-driver.js";

export class MacosTextInserter implements TextInserter {
  constructor(private readonly driver = new NutjsKeystrokeDriver()) {}

  async insert(text: string, options: InsertTextOptions = {}): Promise<void> {
    if (process.platform !== "darwin") {
      throw new InsertionError("MacosTextInserter can only be used on macOS");
    }

    const finalText = options.ensureTrailingSpace ? `${text} ` : text;
    const snapshot = options.restoreClipboard !== false ? await snapshotClipboard() : null;

    await writeClipboardText(finalText);
    await sleep(50);
    await this.driver.pasteForCurrentPlatform();

    if (snapshot) {
      await sleep(250);
      await restoreClipboard(snapshot);
    }
  }
}
