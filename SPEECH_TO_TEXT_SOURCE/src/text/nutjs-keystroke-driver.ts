import { keyboard, Key } from "@nut-tree/nut-js";
import { InsertionError } from "../common/errors.js";

export class NutjsKeystrokeDriver {
  async pasteForCurrentPlatform(): Promise<void> {
    try {
      if (process.platform === "darwin") {
        await keyboard.pressKey(Key.LeftCmd, Key.V);
        await keyboard.releaseKey(Key.V, Key.LeftCmd);
        return;
      }

      if (process.platform === "win32") {
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.V, Key.LeftControl);
        return;
      }

      throw new InsertionError(`Unsupported platform for text insertion: ${process.platform}`);
    } catch (error) {
      throw new InsertionError("Failed to send paste shortcut", { cause: error });
    }
  }
}
