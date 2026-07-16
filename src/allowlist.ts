/**
 * Access control (allowlist / blocklist) and admin checks.
 */

import type { NapcatConfig } from './config.js';
import type {
  OneBotEvent,
  PrivateMessageEvent,
  GroupMessageEvent,
} from './protocol/onebot-v11.js';

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

export function isAdmin(config: NapcatConfig, userId: string): boolean {
  return config.admins.has(userId);
}

export function checkAccess(
  config: NapcatConfig,
  event: OneBotEvent,
): AccessDecision {
  if (isPrivateMessageEvent(event)) {
    return checkPrivateAccess(config, event);
  }
  if (isGroupMessageEvent(event)) {
    return checkGroupAccess(config, event);
  }
  return { allowed: true };
}

function checkPrivateAccess(
  config: NapcatConfig,
  event: PrivateMessageEvent,
): AccessDecision {
  const userId = String(event.user_id);

  if (config.blockedUsers.has(userId)) {
    return { allowed: false, reason: 'user blocked' };
  }

  if (config.allowedUsers.size > 0 && !config.allowedUsers.has(userId)) {
    return { allowed: false, reason: 'user not in allowlist' };
  }

  return { allowed: true };
}

function checkGroupAccess(
  config: NapcatConfig,
  event: GroupMessageEvent,
): AccessDecision {
  const groupId = String(event.group_id);
  const userId = String(event.user_id);

  if (config.blockedGroups.has(groupId)) {
    return { allowed: false, reason: 'group blocked' };
  }

  if (config.blockedUsers.has(userId)) {
    return { allowed: false, reason: 'user blocked' };
  }

  if (config.allowedGroups.size > 0 && !config.allowedGroups.has(groupId)) {
    return { allowed: false, reason: 'group not in allowlist' };
  }

  return { allowed: true };
}

export function allowUser(config: NapcatConfig, userId: string): void {
  config.allowedUsers.add(userId);
  config.blockedUsers.delete(userId);
}

export function allowGroup(config: NapcatConfig, groupId: string): void {
  config.allowedGroups.add(groupId);
  config.blockedGroups.delete(groupId);
}

export function blockUser(config: NapcatConfig, userId: string): void {
  config.blockedUsers.add(userId);
  config.allowedUsers.delete(userId);
}

export function blockGroup(config: NapcatConfig, groupId: string): void {
  config.blockedGroups.add(groupId);
  config.allowedGroups.delete(groupId);
}

function isPrivateMessageEvent(
  event: OneBotEvent,
): event is PrivateMessageEvent {
  return (
    event.post_type === 'message' &&
    (event as PrivateMessageEvent).message_type === 'private'
  );
}

function isGroupMessageEvent(
  event: OneBotEvent,
): event is GroupMessageEvent {
  return (
    event.post_type === 'message' &&
    (event as GroupMessageEvent).message_type === 'group'
  );
}
