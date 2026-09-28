/**
 * Administrator command handler.
 *
 * Commands are intercepted before being passed to the NanoClaw host. They
 * directly call OneBot group-management APIs and reply with a short status
 * message.
 */

import type { NapcatConfig } from './config.js';
import type { OneBotWsClient } from './client/onebot-ws-client.js';
import {
  ACTIONS,
  isPrivateMessageEvent,
  isGroupMessageEvent,
  type OneBotEvent,
  type OneBotApiResult,
  type GetStatusResult,
  type GroupMemberInfo,
  type LoginInfo,
} from './protocol/onebot-v11.js';
import {
  allowGroup,
  allowUser,
  blockGroup,
  blockUser,
  isAdmin,
} from './allowlist.js';

export interface AdminCommandContext {
  config: NapcatConfig;
  client: OneBotWsClient;
  event: OneBotEvent;
  platformId: string;
  sendReply(text: string): Promise<void>;
}

export async function handleAdminCommand(
  ctx: AdminCommandContext,
  rawText: string,
): Promise<boolean> {
  const text = rawText.trim();
  if (!text.startsWith('/')) return false;

  const senderId = extractSenderId(ctx.event);
  if (!senderId || !isAdmin(ctx.config, senderId)) return false;

  const parts = text.split(/\s+/);
  const command = parts[0];

  switch (command) {
    case '/status':
      await handleStatus(ctx);
      return true;
    case '/mute':
      await handleMute(ctx, parts);
      return true;
    case '/kick':
      await handleKick(ctx, parts);
      return true;
    case '/allow':
      await handleAllow(ctx, parts);
      return true;
    case '/block':
      await handleBlock(ctx, parts);
      return true;
    default:
      return false;
  }
}

async function handleStatus(ctx: AdminCommandContext): Promise<void> {
  try {
    const [status, login] = await Promise.all([
      ctx.client.call<GetStatusResult>(ACTIONS.GET_STATUS, {}),
      ctx.client.call<LoginInfo>(ACTIONS.GET_LOGIN_INFO, {}),
    ]);

    const onlineText = status.online ? '在线' : '离线';
    const goodText = status.good ? '正常' : '异常';

    await ctx.sendReply(
      `状态：${onlineText} / ${goodText}\n` +
        `登录：${login.nickname || ''} (${login.user_id})`,
    );
  } catch (err) {
    await ctx.sendReply(`获取状态失败：${formatApiError(err)}`);
  }
}

async function handleMute(
  ctx: AdminCommandContext,
  parts: string[],
): Promise<void> {
  const DEFAULT_DURATION = 600;

  const { groupId, userId, duration } = await parseGroupUserArgs(
    ctx,
    parts,
    DEFAULT_DURATION,
    true,
  );
  if (!groupId || !userId) return;

  try {
    await ctx.client.call<OneBotApiResult>(ACTIONS.SET_GROUP_BAN, {
      group_id: groupId,
      user_id: userId,
      duration,
    });
    const action = duration === 0 ? '解除禁言' : `禁言 ${duration} 秒`;
    const display = await resolveDisplayName(ctx, groupId, userId);
    await ctx.sendReply(`已${action} ${display}`);
  } catch (err) {
    await ctx.sendReply(`禁言操作失败：${formatApiError(err)}`);
  }
}

async function handleKick(
  ctx: AdminCommandContext,
  parts: string[],
): Promise<void> {
  const { groupId, userId } = await parseGroupUserArgs(ctx, parts, 0, false);
  if (!groupId || !userId) return;

  try {
    await ctx.client.call<OneBotApiResult>(ACTIONS.SET_GROUP_KICK, {
      group_id: groupId,
      user_id: userId,
      reject_add_request: false,
    });
    const display = await resolveDisplayName(ctx, groupId, userId);
    await ctx.sendReply(`已将 ${display} 移出群 ${groupId}`);
  } catch (err) {
    await ctx.sendReply(`踢人操作失败：${formatApiError(err)}`);
  }
}

async function handleAllow(
  ctx: AdminCommandContext,
  parts: string[],
): Promise<void> {
  if (parts.length < 3) {
    await ctx.sendReply('用法：/allow user <qq> 或 /allow group <群号>');
    return;
  }

  const [, scope, id] = parts;
  if (!/^\d+$/.test(id)) {
    await ctx.sendReply('ID 必须是数字');
    return;
  }

  if (scope === 'user') {
    allowUser(ctx.config, id);
    await ctx.sendReply(`已将用户 ${id} 加入白名单`);
  } else if (scope === 'group') {
    allowGroup(ctx.config, id);
    await ctx.sendReply(`已将群 ${id} 加入白名单`);
  } else {
    await ctx.sendReply('用法：/allow user <qq> 或 /allow group <群号>');
  }
}

async function handleBlock(
  ctx: AdminCommandContext,
  parts: string[],
): Promise<void> {
  if (parts.length < 3) {
    await ctx.sendReply('用法：/block user <qq> 或 /block group <群号>');
    return;
  }

  const [, scope, id] = parts;
  if (!/^\d+$/.test(id)) {
    await ctx.sendReply('ID 必须是数字');
    return;
  }

  if (scope === 'user') {
    blockUser(ctx.config, id);
    await ctx.sendReply(`已将用户 ${id} 加入黑名单`);
  } else if (scope === 'group') {
    blockGroup(ctx.config, id);
    await ctx.sendReply(`已将群 ${id} 加入黑名单`);
  } else {
    await ctx.sendReply('用法：/block user <qq> 或 /block group <群号>');
  }
}

async function parseGroupUserArgs(
  ctx: AdminCommandContext,
  parts: string[],
  defaultDuration: number,
  supportsDuration: boolean,
): Promise<{ groupId?: number; userId?: number; duration: number }> {
  const event = ctx.event;

  if (isGroupMessageEvent(event)) {
    // /mute <qq> [seconds]
    if (parts.length < 2) {
      await ctx.sendReply('用法：/mute <qq> [秒数]');
      return { duration: defaultDuration };
    }
    const groupId = event.group_id;
    const userId = Number(parts[1]);
    const duration = supportsDuration
      ? parts.length >= 3
        ? Number(parts[2])
        : defaultDuration
      : 0;

    if (Number.isNaN(userId) || userId <= 0) {
      await ctx.sendReply('QQ 号必须是数字');
      return { duration };
    }
    return { groupId, userId, duration };
  }

  if (isPrivateMessageEvent(event)) {
    // /mute <group> <qq> [seconds]
    if (parts.length < 3) {
      await ctx.sendReply('私聊用法：/mute <群号> <qq> [秒数]');
      return { duration: defaultDuration };
    }
    const groupId = Number(parts[1]);
    const userId = Number(parts[2]);
    const duration = supportsDuration
      ? parts.length >= 4
        ? Number(parts[3])
        : defaultDuration
      : 0;

    if (Number.isNaN(groupId) || groupId <= 0) {
      await ctx.sendReply('群号必须是数字');
      return { duration };
    }
    if (Number.isNaN(userId) || userId <= 0) {
      await ctx.sendReply('QQ 号必须是数字');
      return { duration };
    }
    return { groupId, userId, duration };
  }

  await ctx.sendReply('该命令仅支持私聊或群聊');
  return { duration: defaultDuration };
}

/**
 * Best-effort human-readable name for a group member: group card, then
 * nickname, then the bare QQ number when the lookup fails.
 */
async function resolveDisplayName(
  ctx: AdminCommandContext,
  groupId: number,
  userId: number,
): Promise<string> {
  try {
    const info = await ctx.client.call<GroupMemberInfo>(
      ACTIONS.GET_GROUP_MEMBER_INFO,
      { group_id: groupId, user_id: userId },
    );
    const name = info.card || info.nickname;
    if (name) return `${name}(${userId})`;
  } catch {
    // Fall through to the bare QQ number.
  }
  return String(userId);
}

function extractSenderId(event: OneBotEvent): string | undefined {
  if (isPrivateMessageEvent(event) || isGroupMessageEvent(event)) {
    return String(event.user_id);
  }
  return undefined;
}

/**
 * Translates raw OneBot API errors into short, actionable Chinese feedback.
 * Known NapCat wordings are mapped to plain causes; anything else keeps the
 * original code and wording so admins can still report the exact failure.
 */
function formatApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = /OneBot API error:\s*(\d+)\s*(.*)/.exec(raw);
  if (!match) return raw;

  const code = match[1];
  const wording = (match[2] || '').trim();

  if (/NOT_GROUP_ADMIN/i.test(wording)) {
    return '机器人不是该群管理员，请先在群设置中把机器人设为管理员';
  }
  if (/get uid error/i.test(wording)) {
    return '目标 QQ 不在该群内或不存在，请检查 QQ 号是否正确';
  }

  return `OneBot 接口错误（码 ${code}）${wording ? `：${wording}` : ''}`;
}
