import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deliver, splitText } from './deliver.js';
import { OneBotWsClient } from '../client/onebot-ws-client.js';
import { MockOneBotServer } from '../../test/fixtures/mock-onebot-server.js';
import type { NapcatConfig } from '../config.js';
import type { OneBotActionRequest } from '../protocol/onebot-v11.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function baseConfig(overrides: Partial<NapcatConfig> = {}): NapcatConfig {
  return {
    wsUrl: 'ws://localhost:3001',
    accessToken: undefined,
    selfId: '10000',
    allowedUsers: new Set(),
    allowedGroups: new Set(),
    blockedUsers: new Set(),
    blockedGroups: new Set(),
    admins: new Set(),
    requireAtInGroup: true,
    maxTextLength: 20,
    welcomeMessage: undefined,
    goodbyeMessage: undefined,
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('deliver', () => {
  let server: MockOneBotServer;
  let client: OneBotWsClient;
  let requests: OneBotActionRequest[] = [];

  beforeEach(async () => {
    server = new MockOneBotServer();
    const info = await server.start();
    requests = [];

    server.setActionHandler((req, socket) => {
      requests.push(req);
      server.sendResponse(socket, {
        status: 'ok',
        retcode: 0,
        data: { message_id: 1 },
        message: '',
        echo: req.echo,
      });
    });

    client = new OneBotWsClient({
      wsUrl: info.url,
      logger: noopLogger,
      apiTimeoutMs: 500,
    });
    client.connect();
    await waitFor(() => client.isConnected());
  });

  afterEach(async () => {
    client.dispose();
    await server.stop();
  });

  it('sends private message', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 100 }), client },
      'qq:987654',
      null,
      { kind: 'chat', content: { text: 'hi there' } },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.action).toBe('send_private_msg');
    expect(requests[0]?.params).toMatchObject({
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'hi there' } }],
    });
  });

  it('sends group message', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 100 }), client },
      'qq:group:12345',
      null,
      { kind: 'chat', content: { text: 'group reply' } },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.action).toBe('send_group_msg');
    expect(requests[0]?.params).toMatchObject({
      group_id: 12345,
      message: [{ type: 'text', data: { text: 'group reply' } }],
    });
  });

  it('splits long text', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 10 }), client },
      'qq:987654',
      null,
      { kind: 'chat', content: { text: '1234567890ABCDEF' } },
    );

    expect(requests).toHaveLength(2);
    const first = requests[0]?.params as { message: { data: { text: string } }[] };
    const second = requests[1]?.params as { message: { data: { text: string } }[] };
    expect(first.message[0]?.data.text).toBe('1234567890');
    expect(second.message[0]?.data.text).toBe('ABCDEF');
  });

  it('sends image attachment as base64 segment', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 100 }), client },
      'qq:group:12345',
      null,
      {
        kind: 'chat',
        content: {
          text: 'here is a pic',
          attachments: [
            {
              name: 'pic.png',
              mimeType: 'image/png',
              data: Buffer.from('png-data').toString('base64'),
              type: 'image',
            },
          ],
        },
      },
    );

    expect(requests).toHaveLength(1);
    const params = requests[0]?.params as { message: { type: string; data: { file: string } }[] };
    expect(params.message[0]?.type).toBe('image');
    expect(params.message[0]?.data.file).toMatch(/^base64:\/\//);
    expect(params.message[1]?.type).toBe('text');
  });

  it('sends attachment-only message when text is empty', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 100 }), client },
      'qq:987654',
      null,
      {
        kind: 'chat',
        content: {
          text: '',
          attachments: [
            {
              name: 'pic.png',
              mimeType: 'image/png',
              data: Buffer.from('png-data').toString('base64'),
              type: 'image',
            },
          ],
        },
      },
    );

    expect(requests).toHaveLength(1);
    const params = requests[0]?.params as { message: { type: string }[] };
    expect(params.message[0]?.type).toBe('image');
  });

  it('splits text but keeps attachments only in first message', async () => {
    await deliver(
      { config: baseConfig({ maxTextLength: 10 }), client },
      'qq:987654',
      null,
      {
        kind: 'chat',
        content: {
          text: '1234567890ABCDEF',
          attachments: [
            {
              name: 'voice.mp3',
              mimeType: 'audio/mpeg',
              data: Buffer.from('mp3').toString('base64'),
              type: 'record',
            },
          ],
        },
      },
    );

    expect(requests).toHaveLength(2);
    const first = requests[0]?.params as { message: { type: string }[] };
    const second = requests[1]?.params as { message: { type: string }[] };
    expect(first.message[0]?.type).toBe('record');
    expect(second.message[0]?.type).toBe('text');
  });

  it('throws on invalid platform id', async () => {
    await expect(
      deliver(
        { config: baseConfig(), client },
        'telegram:channel',
        null,
        { kind: 'chat', content: { text: 'oops' } },
      ),
    ).rejects.toThrow(/Invalid OneBot platform ID/);
  });
});

describe('splitText', () => {
  it('returns empty array for empty text', () => {
    expect(splitText('', 10)).toEqual([]);
  });

  it('returns single chunk when under limit', () => {
    expect(splitText('hello', 10)).toEqual(['hello']);
  });

  it('keeps short paragraphs together when under limit', () => {
    expect(splitText('a\nb\nc', 3)).toEqual(['a\nb', 'c']);
  });

  it('splits oversized paragraphs by character limit', () => {
    expect(splitText('1234567890ABC', 10)).toEqual([
      '1234567890',
      'ABC',
    ]);
  });
});
