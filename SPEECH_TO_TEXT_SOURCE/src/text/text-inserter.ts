export type PasteStrategy = "clipboard+shortcut";

export interface InsertTextOptions {
  restoreClipboard?: boolean;
  ensureTrailingSpace?: boolean;
  pasteStrategy?: PasteStrategy;
}

export interface TextInserter {
  insert(text: string, options?: InsertTextOptions): Promise<void>;
}
