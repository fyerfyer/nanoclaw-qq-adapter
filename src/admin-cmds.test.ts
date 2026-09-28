import { describe, it, expect, vi, type Mock } from 'vitest';
import { handleAdminCommand, type AdminCommandContext } from './admin-cmds.js';
import type { NapcatConfig } from './config.js';
import type { OneBotWsClient } from './client/onebot-ws-client.js';
import type {
  GroupMessageEvent,
  PrivateMessageEvent,
} from './protocol/onebot-v11.js';

function baseConfig(overrides: Partial<NapcatConfig> = {}): NapcatConfig {
  return {
    wsUrl: 'ws://localhost:3001',
    accessToken: undefined,
    selfId: '10000',
    allowedUsers: new Set(),
    allowedGroups: new Set(),
    blockedUsers: new Set(),
    blockedGroups: new Set(),
    admins: new Set(['111']),
    requireAtInGroup: true,
    maxTextLength: 4500,
    welcomeMessage: undefined,
    goodbyeMessage: undefined,
    ...overrides,
  };
}

function groupEvent(userId: number): GroupMessageEvent {
  return {
    time: 1,
    self_id: 10000,
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: 1,
    group_id: 12345,
    user_id: userId,
    message: [],
    raw_message: '',
    font: 0,
    sender: { user_id: userId, nickname: 'Admin' },
  };
}

function privateEvent(userId: number): PrivateMessageEvent {
  return {
    time: 1,
    self_id: 10000,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: 1,
    user_id: userId,
    message: [],
    raw_message: '',
    font: 0,
    sender: { user_id: userId, nickname: 'Admin' },
  };
}

function makeCtx(
  config: NapcatConfig,
  event: GroupMessageEvent | PrivateMessageEvent,
  platformId: string,
): AdminCommandContext & { replies: string[]; callMock: Mock } {
  const replies: string[] = [];
  const callMock = vi.fn();
  return {
    config,
    client: { call: callMock } as unknown as OneBotWsClient,
    event,
    platformId,
    sendReply(text: string) {
      replies.push(text);
      return Promise.resolve();
    },
    replies,
    callMock,
  };
}

describe('handleAdminCommand', () => {
  it('ignores non-admin messages', async () => {
    const config = baseConfig();
    const ctx = makeCtx(config, groupEvent(999), 'qq:group:12345');
    const handled = await handleAdminCommand(ctx, '/status');
    expect(handled).toBe(false);
    expect(ctx.replies).toHaveLength(0);
  });

  it('does not intercept non-command text even from admins', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    expect(await handleAdminCommand(ctx, 'hello world')).toBe(false);
  });

  it('returns false for unknown admin commands', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    expect(await handleAdminCommand(ctx, '/unknown')).toBe(false);
  });

  it('/status reports status and login info', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock
      .mockResolvedValueOnce({ online: true, good: true })
      .mockResolvedValueOnce({ user_id: 10000, nickname: 'Bot' });

    const handled = await handleAdminCommand(ctx, '/status');
    expect(handled).toBe(true);
    expect(ctx.callMock).toHaveBeenCalledWith('get_status', {});
    expect(ctx.callMock).toHaveBeenCalledWith('get_login_info', {});
    expect(ctx.replies[0]).toContain('在线');
    expect(ctx.replies[0]).toContain('Bot');
  });

  it('/mute bans user in the current group', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock.mockResolvedValue(null);

    const handled = await handleAdminCommand(ctx, '/mute 222 120');
    expect(handled).toBe(true);
    expect(ctx.callMock).toHaveBeenCalledWith('set_group_ban', {
      group_id: 12345,
      user_id: 222,
      duration: 120,
    });
    expect(ctx.replies[0]).toContain('禁言 120 秒');
  });

  it('/mute shows the member card with QQ number', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock
      .mockResolvedValueOnce(null) // set_group_ban
      .mockResolvedValueOnce({ user_id: 222, nickname: 'Nick', card: '群名片' });

    await handleAdminCommand(ctx, '/mute 222 60');
    expect(ctx.callMock).toHaveBeenCalledWith('get_group_member_info', {
      group_id: 12345,
      user_id: 222,
    });
    expect(ctx.replies[0]).toContain('已禁言 60 秒 群名片(222)');
  });

  it('/kick falls back to bare QQ when member lookup fails', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock
      .mockResolvedValueOnce(null) // set_group_kick
      .mockRejectedValue(new Error('member not found')); // get_group_member_info

    await handleAdminCommand(ctx, '/kick 222');
    expect(ctx.replies[0]).toContain('已将 222 移出群 12345');
  });

  it('/kick removes user from the current group', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock.mockResolvedValue(null);

    const handled = await handleAdminCommand(ctx, '/kick 222');
    expect(handled).toBe(true);
    expect(ctx.callMock).toHaveBeenCalledWith('set_group_kick', {
      group_id: 12345,
      user_id: 222,
      reject_add_request: false,
    });
  });

  it('/mute in private requires group id', async () => {
    const ctx = makeCtx(baseConfig(), privateEvent(111), 'qq:111');

    const handled = await handleAdminCommand(ctx, '/mute 222');
    expect(handled).toBe(true);
    expect(ctx.replies[0]).toContain('私聊用法');
    expect(ctx.callMock).not.toHaveBeenCalledWith(
      'set_group_ban',
      expect.anything(),
    );
  });

  it('/allow user mutates allowlist', async () => {
    const config = baseConfig({ blockedUsers: new Set(['222']) });
    const ctx = makeCtx(config, privateEvent(111), 'qq:111');

    const handled = await handleAdminCommand(ctx, '/allow user 222');
    expect(handled).toBe(true);
    expect(config.allowedUsers.has('222')).toBe(true);
    expect(config.blockedUsers.has('222')).toBe(false);
  });

  it('/block group mutates blocklist', async () => {
    const config = baseConfig({ allowedGroups: new Set(['10']) });
    const ctx = makeCtx(config, privateEvent(111), 'qq:111');

    const handled = await handleAdminCommand(ctx, '/block group 10');
    expect(handled).toBe(true);
    expect(config.blockedGroups.has('10')).toBe(true);
    expect(config.allowedGroups.has('10')).toBe(false);
  });

  it('/mute maps NOT_GROUP_ADMIN to a plain explanation', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock.mockRejectedValue(
      new Error('OneBot API error: 1200 ERR_NOT_GROUP_ADMIN'),
    );

    const handled = await handleAdminCommand(ctx, '/mute 222 60');
    expect(handled).toBe(true);
    expect(ctx.replies[0]).toContain('机器人不是该群管理员');
    expect(ctx.replies[0]).not.toContain('OneBot API error');
  });

  it('/kick maps get-Uid Error to a plain explanation', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock.mockRejectedValue(
      new Error('OneBot API error: 1200 get Uid Error'),
    );

    const handled = await handleAdminCommand(ctx, '/kick 123456789');
    expect(handled).toBe(true);
    expect(ctx.replies[0]).toContain('不在该群内或不存在');
  });

  it('keeps unknown OneBot errors with code and wording', async () => {
    const ctx = makeCtx(baseConfig(), groupEvent(111), 'qq:group:12345');
    ctx.callMock.mockRejectedValue(
      new Error('OneBot API error: 1400 something weird'),
    );

    await handleAdminCommand(ctx, '/kick 123456789');
    expect(ctx.replies[0]).toContain('1400');
    expect(ctx.replies[0]).toContain('something weird');
  });
});
