import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@samscode/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@samscode/shared/schemaJson";
import { Result, Schema } from "effect";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface RequestOptions {
  readonly timeoutMs?: number;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

const REQUEST_TIMEOUT_MS = 60_000;
const BROWSER_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const DESKTOP_RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 8_000, 8_000];
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

function isUpstreamSyncMethod(method: string): boolean {
  return method.startsWith("upstreamSync.");
}

function isUpstreamSyncChannel(channel: string): boolean {
  return channel.startsWith("upstreamSync.");
}

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly outboundQueue: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private state: TransportState = "connecting";
  private readonly url: string;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly suppressTransientConnectionWarnings: boolean;

  constructor(url?: string) {
    const bridgeUrl = window.desktopBridge?.getWsUrl();
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    this.url =
      url ??
      (bridgeUrl && bridgeUrl.length > 0
        ? bridgeUrl
        : envUrl && envUrl.length > 0
          ? envUrl
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`);
    this.reconnectDelaysMs = bridgeUrl ? DESKTOP_RECONNECT_DELAYS_MS : BROWSER_RECONNECT_DELAYS_MS;
    this.suppressTransientConnectionWarnings = bridgeUrl !== null && bridgeUrl !== undefined;
    this.connect();
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message: WsRequestEnvelope = { id, body };
    const encoded = JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
      if (isUpstreamSyncMethod(method)) {
        console.info("ws request started", {
          id,
          method,
          timeoutMs,
        });
      }
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              if (isUpstreamSyncMethod(method)) {
                console.error("ws request timed out", {
                  id,
                  method,
                  timeoutMs,
                });
              }
              reject(new Error(`Request timed out: ${method}`));
            }, timeoutMs)
          : null;

      this.pending.set(id, {
        method,
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(encoded);
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getState(): TransportState {
    return this.state;
  }

  dispose() {
    this.disposed = true;
    this.state = "disposed";
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      if (pending.timeout !== null) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    this.outboundQueue.length = 0;
    this.ws?.close();
    this.ws = null;
  }

  private connect() {
    if (this.disposed) {
      return;
    }

    this.state = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      this.ws = ws;
      this.state = "open";
      this.reconnectAttempt = 0;
      this.flushQueue();
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.disposed) {
        this.state = "disposed";
        return;
      }
      this.state = "closed";
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      if (!this.suppressTransientConnectionWarnings) {
        console.warn("WebSocket connection error", { type: event.type, url: this.url });
      }
    });
  }

  private handleMessage(raw: unknown) {
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      if (isUpstreamSyncChannel(message.channel)) {
        console.info("ws push received", {
          channel: message.channel,
          sequence: message.sequence,
          data: message.data,
        });
      }
      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
    this.pending.delete(message.id);

    if (message.error) {
      if (isUpstreamSyncMethod(pending.method)) {
        console.error("ws request failed", {
          id: message.id,
          method: pending.method,
          error: message.error.message,
        });
      }
      pending.reject(new Error(message.error.message));
      return;
    }

    if (isUpstreamSyncMethod(pending.method)) {
      console.info("ws request completed", {
        id: message.id,
        method: pending.method,
        result: message.result,
      });
    }
    pending.resolve(message.result);
  }

  private send(encodedMessage: string) {
    if (this.disposed) {
      return;
    }

    this.outboundQueue.push(encodedMessage);
    try {
      this.flushQueue();
    } catch {
      // Swallow: flushQueue has queued the message for retry on reconnect
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        this.ws.send(message);
      } catch (error) {
        this.outboundQueue.unshift(message);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ??
      this.reconnectDelaysMs[0]!;

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
