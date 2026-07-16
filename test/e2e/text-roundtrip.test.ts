import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOneBotNapCatAdapter } from '../../src/onebot-napcat.js';
import { MockOneBotServer } from '../fixtures/mock-onebot-server.js';
import { MinimalHost } from '../fixtures/minimal-host.js';
import type { OneBotActionRequest } from '../../src/protocol/onebot-v11.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('text roundtrip', () => {
  let server: MockOneBotServer;
  let requests: OneBotActionRequest[] = [];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    requests = [];
    server = new MockOneBotServer();
    const info = await server.start();

    process.env.NAPCAT_WS_URL = info.url;
    process.env.NAPCAT_SELF_ID = '10000';

    server.setActionHandler((req, socket) => {
      requests.push(req);

      if (req.action === 'get_login_info') {
        server.sendResponse(socket, {
          status: 'ok',
          retcode: 0,
          data: { user_id: 10000, nickname: 'TestBot' },
          message: '',
          echo: req.echo,
        });
        return;
      }

      server.sendResponse(socket, {
        status: 'ok',
        retcode: 0,
        data: { message_id: Math.floor(Math.random() * 100000) },
        message: '',
        echo: req.echo,
      });
    });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await server.stop();
  });

  it('receives private text and sends a reply', async () => {
    const adapter = createOneBotNapCatAdapter({ logger: noopLogger });
    const host = new MinimalHost(adapter);
    await host.start();
    await waitFor(() => adapter.isConnected());

    server.broadcastEvent({
      time: Math.floor(Date.now() / 1000),
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: 101,
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'Hello from QQ' } }],
      raw_message: 'Hello from QQ',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    });

    await waitFor(() => host.inbound.length === 1);
    expect(host.inbound[0]).toMatchObject({
      platformId: 'qq:987654',
      threadId: null,
      message: {
        id: '101',
        kind: 'chat',
        content: {
          sender: 'Alice',
          senderId: '987654',
          text: 'Hello from QQ',
          isFromMe: false,
        },
      },
    });

    await host.sendOutbound('qq:987654', 'Hi Alice!');

    await waitFor(() => requests.some((r) => r.action === 'send_private_msg'));
    const privateReq = requests.find((r) => r.action === 'send_private_msg');
    expect(privateReq?.params).toMatchObject({
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'Hi Alice!' } }],
    });

    await host.stop();
  });

  it('receives group text and sends a group reply', async () => {
    const adapter = createOneBotNapCatAdapter({ logger: noopLogger });
    const host = new MinimalHost(adapter);
    await host.start();
    await waitFor(() => adapter.isConnected());

    server.broadcastEvent({
      time: Math.floor(Date.now() / 1000),
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 202,
      group_id: 12345,
      user_id: 987654,
      message: [
        { type: 'at', data: { qq: '10000' } },
        { type: 'text', data: { text: ' group question' } },
      ],
      raw_message: '[CQ:at,qq=10000] group question',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    });

    await waitFor(() => host.inbound.length === 1);
    expect(host.inbound[0]).toMatchObject({
      platformId: 'qq:group:12345',
      threadId: null,
      message: {
        id: '202',
        kind: 'chat',
        content: {
          sender: 'Alice',
          senderId: '987654',
          text: ' group question',
          isFromMe: false,
        },
      },
    });

    await host.sendOutbound('qq:group:12345', 'Reply to group');

    await waitFor(() => requests.some((r) => r.action === 'send_group_msg'));
    const groupReq = requests.find((r) => r.action === 'send_group_msg');
    expect(groupReq?.params).toMatchObject({
      group_id: 12345,
      message: [{ type: 'text', data: { text: 'Reply to group' } }],
    });

    await host.stop();
  });
});
