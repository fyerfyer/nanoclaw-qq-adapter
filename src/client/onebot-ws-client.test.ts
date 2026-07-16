import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OneBotWsClient, type Logger } from './onebot-ws-client.js';
import { MockOneBotServer } from '../../test/fixtures/mock-onebot-server.js';
import type {
  LoginInfo,
  PrivateMessageEvent,
} from '../protocol/onebot-v11.js';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error('waitFor timed out');
}

describe('OneBotWsClient', () => {
  let server: MockOneBotServer;
  let serverUrl: string;
  let clients: OneBotWsClient[] = [];

  beforeEach(async () => {
    server = new MockOneBotServer();
    const info = await server.start();
    serverUrl = info.url;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      client.dispose();
    }
    await server.stop();
  });

  function createClient(options?: {
    accessToken?: string;
    defaultHeartbeatTimeoutMs?: number;
    apiTimeoutMs?: number;
    minReconnectDelayMs?: number;
  }): OneBotWsClient {
    const client = new OneBotWsClient({
      wsUrl: serverUrl,
      logger: noopLogger,
      apiTimeoutMs: 500,
      ...options,
    });
    clients.push(client);
    return client;
  }

  it('calls get_login_info and receives response', async () => {
    server.setActionHandler((req, socket) => {
      if (req.action === 'get_login_info') {
        server.sendResponse(socket, {
          status: 'ok',
          retcode: 0,
          data: { user_id: 123456, nickname: 'Bot' },
          message: '',
          echo: req.echo,
        });
      }
    });

    const client = createClient();
    client.connect();
    await waitFor(() => client.isConnected());

    const result = await client.call<LoginInfo>('get_login_info', {});
    expect(result.user_id).toBe(123456);
    expect(result.nickname).toBe('Bot');
  });

  it('emits events received from server', async () => {
    const client = createClient();
    const events: PrivateMessageEvent[] = [];
    client.onEvent((event) => {
      if (event.post_type === 'message' && 'message_type' in event) {
        events.push(event as PrivateMessageEvent);
      }
    });
    client.connect();
    await waitFor(() => client.isConnected());

    const event: PrivateMessageEvent = {
      time: Date.now(),
      self_id: 123456,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: 1,
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'hello' } }],
      raw_message: 'hello',
      font: 0,
      sender: { user_id: 987654, nickname: 'User' },
    };
    server.broadcastEvent(event);

    await waitFor(() => events.length === 1);
    expect(events[0]?.message[0]?.type).toBe('text');
  });

  it('reconnects after server closes connection', async () => {
    server.setActionHandler((req, socket) => {
      if (req.action === 'get_login_info') {
        server.sendResponse(socket, {
          status: 'ok',
          retcode: 0,
          data: { user_id: 123456, nickname: 'Bot' },
          message: '',
          echo: req.echo,
        });
      }
    });

    const client = createClient({ minReconnectDelayMs: 50 });
    client.connect();
    await waitFor(() => client.isConnected());

    // Force-close from server side.
    for (const socket of server.getSockets()) {
      socket.terminate();
    }
    await waitFor(() => !client.isConnected());
    await waitFor(() => client.isConnected(), 5000);

    const result = await client.call<LoginInfo>('get_login_info', {});
    expect(result.user_id).toBe(123456);
  });

  it('rejects pending calls when connection drops', async () => {
    // Server receives but never responds.
    server.setActionHandler(() => {
      // no-op
    });

    const client = createClient({ minReconnectDelayMs: 50 });
    client.connect();
    await waitFor(() => client.isConnected());

    const pending = client.call('get_login_info', {});

    // Close server to drop connection.
    await server.stop();
    await expect(pending).rejects.toThrow(/disconnected|timed out/i);
  });

  it('reconnects on heartbeat timeout', async () => {
    const initialConnections = server.connectionCount;
    const client = createClient({
      defaultHeartbeatTimeoutMs: 200,
      minReconnectDelayMs: 50,
    });
    client.connect();
    await waitFor(() => client.isConnected());

    // Send one heartbeat to arm the timeout based on interval.
    server.broadcastEvent({
      time: Date.now(),
      self_id: 123456,
      post_type: 'meta_event',
      meta_event_type: 'heartbeat',
      status: {},
      interval: 50,
    });

    // Stop sending heartbeats; client should detect timeout and reconnect.
    await waitFor(() => server.connectionCount > initialConnections, 5000);
    expect(client.isConnected()).toBe(true);
  });

  it('sends authorization header when access token is configured', async () => {
    const token = 'super-secret';
    await server.stop();
    server = new MockOneBotServer({ accessToken: token });
    const info = await server.start();
    serverUrl = info.url;

    server.setActionHandler((req, socket) => {
      server.sendResponse(socket, {
        status: 'ok',
        retcode: 0,
        data: null,
        message: '',
        echo: req.echo,
      });
    });

    const client = createClient({ accessToken: token });
    client.connect();
    await waitFor(() => client.isConnected());

    await client.call('get_login_info', {});
  });
});
