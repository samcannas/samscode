declare module "naudiodon" {
  import { EventEmitter } from "node:events";

  export const SampleFormat16Bit: number;

  export interface NaudiodonDevice {
    id: number;
    name: string;
    maxInputChannels?: number;
    maxOutputChannels?: number;
    defaultSampleRate?: number;
    hostAPIName?: string;
  }

  export interface AudioIOOptions {
    inOptions?: {
      channelCount: number;
      sampleFormat: number;
      sampleRate: number;
      deviceId?: number;
      closeOnError?: boolean;
    };
    outOptions?: unknown;
  }

  export class AudioIO extends EventEmitter {
    constructor(options: AudioIOOptions);
    on(event: string, listener: (...args: any[]) => void): this;
    pipe<T>(destination: T): T;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    start(): void;
    quit(): void;
  }

  export function getDevices(): NaudiodonDevice[];
}

declare module "@nut-tree/nut-js" {
  export const keyboard: {
    pressKey(...keys: Key[]): Promise<void>;
    releaseKey(...keys: Key[]): Promise<void>;
  };

  export enum Key {
    LeftCmd = "LeftCmd",
    LeftControl = "LeftControl",
    V = "V"
  }
}
