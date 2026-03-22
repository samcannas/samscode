export class DesktopSttError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.cause = options?.cause;
  }
}

export class DependencyError extends DesktopSttError {}
export class CaptureError extends DesktopSttError {}
export class TranscriptionError extends DesktopSttError {}
export class ModelLoadError extends DesktopSttError {}
export class InsertionError extends DesktopSttError {}
