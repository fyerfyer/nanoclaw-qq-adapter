import { describe, it, expect, vi } from 'vitest';
import { handleNoticeEvent, type NoticeContext } from './notices.js';
import type { NapcatConfig } from '../config.js';
import type { OneBotWsClient } from '../client/onebot-ws-client.js';
import type {
  GroupIncreaseNoticeEvent,
  GroupDecreaseNoticeEvent,
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

function makeCtx(config: NapcatConfig): NoticeContext & {
  client: OneBotWsClient & { call: ReturnType<typeof vi.fn> };
} {
  return {
    config,
    client: { call: vi.fn() } as unknown as OneBotWsClient & {
      call: ReturnType<typeof vi.fn>;
    },
  };
}

describe('handleNoticeEvent', () => {
  it('sends welcome message on group_increase', async () => {
    const ctx = makeCtx(baseConfig({ welcomeMessage: '欢迎 {user_id}！' }));
    const event: GroupIncreaseNoticeEvent = {
      time: 1,
      self_id: 10000,
      post_type: 'notice',
      notice_type: 'group_increase',
      sub_type: 'approve',
      group_id: 12345,
      operator_id: 1,
      user_id: 987654,
    };

    await handleNoticeEvent(ctx, event);

    expect(ctx.client.call).toHaveBeenCalledWith('send_group_msg', {
      group_id: 12345,
      message: [{ type: 'text', data: { text: '欢迎 987654！' } }],
    });
  });

  it('sends goodbye message on group_decrease', async () => {
    const ctx = makeCtx(baseConfig({ goodbyeMessage: '再见 {user_id}' }));
    const event: GroupDecreaseNoticeEvent = {
      time: 1,
      self_id: 10000,
      post_type: 'notice',
      notice_type: 'group_decrease',
      sub_type: 'leave',
      group_id: 12345,
      operator_id: 987654,
      user_id: 987654,
    };

    await handleNoticeEvent(ctx, event);

    expect(ctx.client.call).toHaveBeenCalledWith('send_group_msg', {
      group_id: 12345,
      message: [{ type: 'text', data: { text: '再见 987654' } }],
    });
  });

  it('does nothing when messages are not configured', async () => {
    const ctx = makeCtx(baseConfig());
    const event: GroupIncreaseNoticeEvent = {
      time: 1,
      self_id: 10000,
      post_type: 'notice',
      notice_type: 'group_increase',
      sub_type: 'approve',
      group_id: 12345,
      operator_id: 1,
      user_id: 987654,
    };

    await handleNoticeEvent(ctx, event);
    expect(ctx.client.call).not.toHaveBeenCalled();
  });
});
