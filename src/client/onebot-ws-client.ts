import WebSocket from 'ws';
import type {
  OneBotActionRequest,
  OneBotActionResponse,
  OneBotApiResult,
  OneBotEvent,
} from '../protocol/onebot-v11.js';

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface OneBotWsClientOptions {
  wsUrl: string;
  accessToken?: string;
  logger?: Logger;
  /** Initial heartbeat timeout in ms if no heartbeat interval is known yet. */
  defaultHeartbeatTimeoutMs?: number;
  /** API call timeout in ms. */
  apiTimeoutMs?: number;
  /** Minimum reconnect delay in ms. */
  minReconnectDelayMs?: number;
  /** Maximum reconnect delay in ms. */
  maxReconnectDelayMs?: number;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class OneBotWsClient {
  private wsUrl: string;
  private accessToken?: string;
  private logger: Logger;
  private defaultHeartbeatTimeoutMs: number;
  private apiTimeoutMs: number;
  private minReconnectDelayMs: number;
  private maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private intentionallyClosed = false;
  private disposed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private echoCounter = 0;
  private pendingCalls = new Map<string, PendingCall>();
  private eventListeners = new Set<(event: OneBotEvent) => void>();

  constructor(options: OneBotWsClientOptions) {
    this.wsUrl = options.wsUrl;
    this.accessToken = options.accessToken;
    this.logger = options.logger ?? consoleLogger();
    this.defaultHeartbeatTimeoutMs = options.defaultHeartbeatTimeoutMs ?? 35000;
    this.apiTimeoutMs = options.apiTimeoutMs ?? 30000;
    this.minReconnectDelayMs = options.minReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  onEvent(listener: (event: OneBotEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  connect(): void {
    if (this.disposed || this.ws) return;
    this.intentionallyClosed = false;
    this.openConnection();
  }

  async call<T = OneBotApiResult>(
    action: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(`OneBot API call failed: WebSocket is not connected`);
    }

    const echo = `${++this.echoCounter}`;
    const request: OneBotActionRequest = { action, params, echo };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(echo);
        reject(new Error(`OneBot API call timed out: ${action}`));
      }, this.apiTimeoutMs);

      this.pendingCalls.set(echo, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.sendJson(request);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopReconnect();
    this.stopHeartbeat();
    this.rejectPendingCalls(new Error('WebSocket client disposed'));
    this.closeConnection(1000, 'dispose');
  }

  private openConnection(): void {
    if (this.disposed || this.ws) return;

    this.logger.info('Connecting to OneBot WS server', { url: this.wsUrl });

    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    try {
      this.ws = new WebSocket(this.wsUrl, { headers });
    } catch (err) {
      this.logger.error('Failed to create WebSocket', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.logger.info('OneBot WS connected');
      this.resetHeartbeat(this.defaultHeartbeatTimeoutMs);
    });

    this.ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const data = Buffer.isBuffer(raw)
        ? raw.toString('utf-8')
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf-8')
          : Buffer.from(raw).toString('utf-8');
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      this.logger.warn('OneBot WS closed', {
        code,
        reason: reason.toString('utf-8'),
      });
      this.cleanupConnection();
      if (!this.intentionallyClosed && !this.disposed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.logger.error('OneBot WS error', err);
      // close handler will schedule reconnect
    });
  }

  private handleMessage(data: string): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn('Received invalid JSON from OneBot', { data, err });
      return;
    }

    if (typeof payload.echo === 'string') {
      this.handleApiResponse(payload as unknown as OneBotActionResponse);
      return;
    }

    if (typeof payload.post_type === 'string') {
      const event = payload as unknown as OneBotEvent;
      this.handleEvent(event);
      return;
    }

    this.logger.debug('Ignoring unknown OneBot payload', payload);
  }

  private handleApiResponse(response: OneBotActionResponse): void {
    const echo = response.echo;
    if (!echo) return;

    const pending = this.pendingCalls.get(echo);
    if (!pending) {
      this.logger.warn('Received response for unknown echo', { echo, response });
      return;
    }

    this.pendingCalls.delete(echo);
    clearTimeout(pending.timer);

    if (response.status !== 'ok' || response.retcode !== 0) {
      pending.reject(
        new Error(
          `OneBot API error: ${response.retcode} ${response.wording || response.message || ''}`.trim(),
        ),
      );
      return;
    }

    pending.resolve(response.data ?? null);
  }

  private handleEvent(event: OneBotEvent): void {
    this.resetHeartbeatFromEvent(event);
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.logger.error('Event listener threw', err);
      }
    }
  }

  private resetHeartbeatFromEvent(event: OneBotEvent): void {
    if (event.post_type === 'meta_event' && 'interval' in event) {
      const interval = (event as { interval?: number }).interval ?? 15000;
      this.resetHeartbeat(interval * 2 + 5000);
    } else {
      // Any inbound traffic keeps the connection alive.
      this.resetHeartbeat(this.defaultHeartbeatTimeoutMs);
    }
  }

  private resetHeartbeat(timeoutMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      if (this.disposed || !this.ws) return;
      this.logger.warn('OneBot heartbeat timeout, forcing reconnect');
      this.closeConnection(4000, 'heartbeat timeout');
      this.scheduleReconnect();
    }, timeoutMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    const base = Math.min(
      this.maxReconnectDelayMs,
      this.minReconnectDelayMs * 2 ** this.reconnectAttempt,
    );
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(this.minReconnectDelayMs, Math.round(base + jitter));
    this.reconnectAttempt++;

    this.logger.info('Scheduling OneBot WS reconnect', {
      attempt: this.reconnectAttempt,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.openConnection();
    }, delay);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeConnection(code: number, reason: string): void {
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // ignore
      }
      this.cleanupConnection();
    }
  }

  private cleanupConnection(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  private sendJson(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Cannot send: WebSocket is not open');
    }
    this.ws.send(JSON.stringify(payload));
  }

  private rejectPendingCalls(reason: Error): void {
    for (const pending of this.pendingCalls.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pendingCalls.clear();
  }
}

function consoleLogger(): Logger {
  return {
    debug: (message, ...args) => console.debug(`[onebot-ws] ${message}`, ...args),
    info: (message, ...args) => console.info(`[onebot-ws] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[onebot-ws] ${message}`, ...args),
    error: (message, ...args) => console.error(`[onebot-ws] ${message}`, ...args),
  };
}
