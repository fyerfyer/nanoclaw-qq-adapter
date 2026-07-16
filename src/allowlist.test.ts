import { describe, it, expect } from 'vitest';
import {
  checkAccess,
  isAdmin,
  allowUser,
  allowGroup,
  blockUser,
  blockGroup,
} from './allowlist.js';
import type { NapcatConfig } from './config.js';
import type {
  PrivateMessageEvent,
  GroupMessageEvent,
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

const privateEvent = (userId: number): PrivateMessageEvent => ({
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
  sender: { user_id: userId, nickname: 'User' },
});

const groupEvent = (groupId: number, userId: number): GroupMessageEvent => ({
  time: 1,
  self_id: 10000,
  post_type: 'message',
  message_type: 'group',
  sub_type: 'normal',
  message_id: 1,
  group_id: groupId,
  user_id: userId,
  message: [],
  raw_message: '',
  font: 0,
  sender: { user_id: userId, nickname: 'User' },
});

describe('isAdmin', () => {
  it('returns true for configured admins', () => {
    expect(isAdmin(baseConfig(), '111')).toBe(true);
    expect(isAdmin(baseConfig(), '222')).toBe(false);
  });
});

describe('checkAccess', () => {
  it('allows all private messages by default', () => {
    const decision = checkAccess(baseConfig(), privateEvent(123));
    expect(decision.allowed).toBe(true);
  });

  it('blocks private messages from blocked users', () => {
    const decision = checkAccess(
      baseConfig({ blockedUsers: new Set(['123']) }),
      privateEvent(123),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('blocked');
  });

  it('allows only whitelisted private users when whitelist is set', () => {
    const config = baseConfig({ allowedUsers: new Set(['456']) });
    expect(checkAccess(config, privateEvent(456)).allowed).toBe(true);
    expect(checkAccess(config, privateEvent(123)).allowed).toBe(false);
  });

  it('allows all groups by default', () => {
    expect(checkAccess(baseConfig(), groupEvent(10, 123)).allowed).toBe(true);
  });

  it('blocks messages from blocked groups', () => {
    const decision = checkAccess(
      baseConfig({ blockedGroups: new Set(['10']) }),
      groupEvent(10, 123),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('group blocked');
  });

  it('allows only whitelisted groups when whitelist is set', () => {
    const config = baseConfig({ allowedGroups: new Set(['20']) });
    expect(checkAccess(config, groupEvent(20, 123)).allowed).toBe(true);
    expect(checkAccess(config, groupEvent(10, 123)).allowed).toBe(false);
  });
});

describe('list mutations', () => {
  it('allowUser adds to allowlist and removes from blocklist', () => {
    const config = baseConfig({ blockedUsers: new Set(['123']) });
    allowUser(config, '123');
    expect(config.allowedUsers.has('123')).toBe(true);
    expect(config.blockedUsers.has('123')).toBe(false);
  });

  it('blockUser adds to blocklist and removes from allowlist', () => {
    const config = baseConfig({ allowedUsers: new Set(['123']) });
    blockUser(config, '123');
    expect(config.blockedUsers.has('123')).toBe(true);
    expect(config.allowedUsers.has('123')).toBe(false);
  });

  it('allowGroup and blockGroup mutate group sets', () => {
    const config = baseConfig();
    allowGroup(config, '10');
    expect(config.allowedGroups.has('10')).toBe(true);
    blockGroup(config, '10');
    expect(config.blockedGroups.has('10')).toBe(true);
    expect(config.allowedGroups.has('10')).toBe(false);
  });
});
