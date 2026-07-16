import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventToInbound } from './event-to-inbound.js';
import type { NapcatConfig } from '../config.js';
import type {
  GroupMessageEvent,
  PrivateMessageEvent,
} from '../protocol/onebot-v11.js';

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
    maxTextLength: 4500,
    welcomeMessage: undefined,
    goodbyeMessage: undefined,
    ...overrides,
  };
}

describe('eventToInbound', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('converts private text message', async () => {
    const event: PrivateMessageEvent = {
      time: 1700000000,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: 42,
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'Hello bot' } }],
      raw_message: 'Hello bot',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    expect(result).not.toBeNull();
    expect(result?.platformId).toBe('qq:987654');
    expect(result?.threadId).toBeNull();
    expect(result?.inboundMessage.kind).toBe('chat');
    expect(result?.inboundMessage.id).toBe('42');
    expect(result?.inboundMessage.content).toMatchObject({
      sender: 'Alice',
      senderId: '987654',
      text: 'Hello bot',
      isFromMe: false,
      isMention: true,
    });
  });

  it('converts group text message with @ mention', async () => {
    const event: GroupMessageEvent = {
      time: 1700000001,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 99,
      group_id: 12345,
      user_id: 987654,
      message: [
        { type: 'at', data: { qq: '10000' } },
        { type: 'text', data: { text: ' hi' } },
      ],
      raw_message: '[CQ:at,qq=10000] hi',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    expect(result?.platformId).toBe('qq:group:12345');
    expect(result?.inboundMessage.content).toMatchObject({
      sender: 'Alice',
      senderId: '987654',
      text: ' hi',
      isMention: true,
    });
  });

  it('marks @all as mention when selfId is configured', async () => {
    const event: GroupMessageEvent = {
      time: 1700000001,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 100,
      group_id: 12345,
      user_id: 987654,
      message: [
        { type: 'at', data: { qq: 'all' } },
        { type: 'text', data: { text: ' broadcast' } },
      ],
      raw_message: '[CQ:at,qq=all] broadcast',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    expect((result?.inboundMessage.content as { isMention: boolean }).isMention).toBe(true);
  });

  it('does not mark group message as mention without @ when requireAtInGroup is true', async () => {
    const event: GroupMessageEvent = {
      time: 1700000002,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 101,
      group_id: 12345,
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'plain text' } }],
      raw_message: 'plain text',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    expect((result?.inboundMessage.content as { isMention: boolean }).isMention).toBe(false);
  });

  it('marks group message as mention when requireAtInGroup is false', async () => {
    const event: GroupMessageEvent = {
      time: 1700000003,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 102,
      group_id: 12345,
      user_id: 987654,
      message: [{ type: 'text', data: { text: 'plain text' } }],
      raw_message: 'plain text',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(
      baseConfig({ requireAtInGroup: false }),
      event,
    );
    expect((result?.inboundMessage.content as { isMention: boolean }).isMention).toBe(true);
  });

  it('downloads image attachments and includes reply id', async () => {
    const imageData = Buffer.from('fake-image');
    const response = new Response(imageData, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const event: GroupMessageEvent = {
      time: 1700000004,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 103,
      group_id: 12345,
      user_id: 987654,
      message: [
        { type: 'reply', data: { id: 77 } },
        { type: 'image', data: { file: 'abc.png', url: 'http://x/abc.png', name: 'abc.png' } },
        { type: 'text', data: { text: ' look' } },
      ],
      raw_message: '[CQ:image,file=abc.png] look',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    const content = result?.inboundMessage.content as {
      replyToMessageId: string;
      attachments: { name: string; mimeType: string; type: string }[];
    };
    expect(content.replyToMessageId).toBe('77');
    expect(content.attachments).toHaveLength(1);
    expect(content.attachments[0]).toMatchObject({
      name: 'abc.png',
      mimeType: 'image/png',
      type: 'image',
    });
  });

  it('falls back to placeholder when media download fails', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network'));

    const event: PrivateMessageEvent = {
      time: 1700000005,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: 44,
      user_id: 987654,
      message: [
        { type: 'file', data: { file: 'doc.pdf', url: 'http://x/doc.pdf' } },
      ],
      raw_message: '[CQ:file,file=doc.pdf]',
      font: 0,
      sender: { user_id: 987654, nickname: 'Alice' },
    };

    const result = await eventToInbound(baseConfig(), event);
    const content = result?.inboundMessage.content as {
      attachments: { name: string; type: string }[];
    };
    expect(content.attachments[0]?.name).toContain('doc.pdf');
    expect(content.attachments[0]?.name).toContain('下载失败');
  });

  it('skips messages from self', async () => {
    const event: PrivateMessageEvent = {
      time: 1700000006,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      sub_type: 'friend',
      message_id: 7,
      user_id: 10000,
      message: [{ type: 'text', data: { text: 'echo' } }],
      raw_message: 'echo',
      font: 0,
      sender: { user_id: 10000, nickname: 'Bot' },
    };

    expect(await eventToInbound(baseConfig(), event)).toBeNull();
  });

  it('ignores unknown events', async () => {
    const event = {
      time: 1700000007,
      self_id: 10000,
      post_type: 'notice',
      notice_type: 'group_upload',
    } as unknown as GroupMessageEvent;

    expect(await eventToInbound(baseConfig(), event)).toBeNull();
  });
});
