import { WebSocketServer, WebSocket } from 'ws';
import type {
  OneBotActionRequest,
  OneBotActionResponse,
  OneBotEvent,
} from '../../src/protocol/onebot-v11.js';

export interface MockOneBotServerOptions {
  accessToken?: string;
}

export class MockOneBotServer {
  private wss: WebSocketServer | null = null;
  private accessToken?: string;
  private sockets = new Set<WebSocket>();
  private _connectionCount = 0;
  private actionHandler?: (
    request: OneBotActionRequest,
    socket: WebSocket,
  ) => void;

  constructor(options: MockOneBotServerOptions = {}) {
    this.accessToken = options.accessToken;
  }

  async start(): Promise<{ host: string; port: number; url: string }> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: 0 }, () => {
        const address = this.wss!.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('Failed to obtain server address'));
          return;
        }
        const port = address.port;
        const host = '127.0.0.1';
        const url = `ws://${host}:${port}`;
        resolve({ host, port, url });
      });

      this.wss.on('connection', (socket, req) => {
        if (this.accessToken) {
          const auth = req.headers.authorization ?? '';
          const match = /^Bearer\s+(.+)$/i.exec(auth);
          if (!match || match[1] !== this.accessToken) {
            socket.close(1008, 'invalid access token');
            return;
          }
        }

        this.sockets.add(socket);
        this._connectionCount++;
        socket.on('message', (raw) => {
          const data = Buffer.isBuffer(raw)
            ? raw.toString('utf-8')
            : Array.isArray(raw)
              ? Buffer.concat(raw).toString('utf-8')
              : Buffer.from(raw).toString('utf-8');
          this.handleMessage(socket, data);
        });
        socket.on('close', () => {
          this.sockets.delete(socket);
        });
      });

      this.wss.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.sockets) {
        socket.terminate();
      }
      this.sockets.clear();
      this.wss?.close(() => resolve());
    });
  }

  setActionHandler(
    handler: (request: OneBotActionRequest, socket: WebSocket) => void,
  ): void {
    this.actionHandler = handler;
  }

  sendResponse(socket: WebSocket, response: OneBotActionResponse): void {
    socket.send(JSON.stringify(response));
  }

  broadcastEvent(event: OneBotEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  getSockets(): WebSocket[] {
    return Array.from(this.sockets);
  }

  get connectionCount(): number {
    return this._connectionCount;
  }

  private handleMessage(socket: WebSocket, data: string): void {
    let request: OneBotActionRequest;
    try {
      request = JSON.parse(data) as OneBotActionRequest;
    } catch {
      return;
    }

    if (this.actionHandler) {
      this.actionHandler(request, socket);
      return;
    }

    // Default handler: echo back an empty success.
    this.sendResponse(socket, {
      status: 'ok',
      retcode: 0,
      data: null,
      message: '',
      echo: request.echo,
    });
  }
}
