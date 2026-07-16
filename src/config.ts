/**
 * Adapter configuration, read from environment variables.
 */

export interface NapcatConfig {
  /** NapCat forward WebSocket URL, e.g. ws://127.0.0.1:3001 */
  wsUrl: string;
  /** Optional access token sent as Bearer authorization. */
  accessToken: string | undefined;
  /** Bot's own QQ number, used to filter self-messages and detect @ mentions. */
  selfId: string | undefined;
  /** Allowed private users; empty means allow all. */
  allowedUsers: Set<string>;
  /** Allowed groups; empty means allow all. */
  allowedGroups: Set<string>;
  /** Blocked users. */
  blockedUsers: Set<string>;
  /** Blocked groups. */
  blockedGroups: Set<string>;
  /** Admin QQ numbers. */
  admins: Set<string>;
  /** Whether group messages must @ the bot to be considered a mention. */
  requireAtInGroup: boolean;
  /** Maximum characters per outgoing message before splitting. */
  maxTextLength: number;
  /** Optional welcome message for new group members. */
  welcomeMessage: string | undefined;
  /** Optional goodbye message for leaving group members. */
  goodbyeMessage: string | undefined;
}

function parseIdList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NapcatConfig {
  const wsUrl = env.NAPCAT_WS_URL?.trim();
  if (!wsUrl) {
    throw new Error('Missing required environment variable NAPCAT_WS_URL');
  }

  const selfId = env.NAPCAT_SELF_ID?.trim() || undefined;
  const maxTextLength = parseInt(env.NAPCAT_MAX_TEXT_LENGTH || '4500', 10);
  if (Number.isNaN(maxTextLength) || maxTextLength <= 0) {
    throw new Error('NAPCAT_MAX_TEXT_LENGTH must be a positive integer');
  }

  return {
    wsUrl,
    accessToken: env.NAPCAT_ACCESS_TOKEN?.trim() || undefined,
    selfId,
    allowedUsers: parseIdList(env.NAPCAT_ALLOWED_USERS),
    allowedGroups: parseIdList(env.NAPCAT_ALLOWED_GROUPS),
    blockedUsers: parseIdList(env.NAPCAT_BLOCKED_USERS),
    blockedGroups: parseIdList(env.NAPCAT_BLOCKED_GROUPS),
    admins: parseIdList(env.NAPCAT_ADMINS),
    requireAtInGroup: env.NAPCAT_REQUIRE_AT_IN_GROUP !== 'false',
    maxTextLength,
    welcomeMessage: env.NAPCAT_WELCOME_MSG?.trim() || undefined,
    goodbyeMessage: env.NAPCAT_GOODBYE_MSG?.trim() || undefined,
  };
}
