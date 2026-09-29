/**
 * Adapter configuration, read from environment variables.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const NAPCAT_ENV_KEYS = [
  'NAPCAT_WS_URL',
  'NAPCAT_ACCESS_TOKEN',
  'NAPCAT_SELF_ID',
  'NAPCAT_ALLOWED_USERS',
  'NAPCAT_ALLOWED_GROUPS',
  'NAPCAT_BLOCKED_USERS',
  'NAPCAT_BLOCKED_GROUPS',
  'NAPCAT_ADMINS',
  'NAPCAT_REQUIRE_AT_IN_GROUP',
  'NAPCAT_MAX_TEXT_LENGTH',
  'NAPCAT_WELCOME_MSG',
  'NAPCAT_GOODBYE_MSG',
] as const;

/**
 * NanoClaw's service intentionally keeps .env values out of process.env.
 * Read only the adapter's own keys so a service-launched host gets the same
 * configuration as an interactive `pnpm` invocation. Explicit environment
 * variables still win over values from the file.
 */
function readDotEnv(projectRoot = process.cwd()): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(join(projectRoot, '.env'), 'utf8');
  } catch {
    return {};
  }

  const wanted = new Set<string>(NAPCAT_ENV_KEYS);
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match || !wanted.has(match[1])) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, projectRoot = process.cwd()): NapcatConfig {
  const fileEnv = readDotEnv(projectRoot);
  const value = (key: (typeof NAPCAT_ENV_KEYS)[number]): string | undefined =>
    env[key] !== undefined ? env[key] : fileEnv[key];

  const wsUrl = value('NAPCAT_WS_URL')?.trim();
  if (!wsUrl) {
    throw new Error('Missing required environment variable NAPCAT_WS_URL');
  }

  const selfId = value('NAPCAT_SELF_ID')?.trim() || undefined;
  const maxTextLength = parseInt(value('NAPCAT_MAX_TEXT_LENGTH') || '4500', 10);
  if (Number.isNaN(maxTextLength) || maxTextLength <= 0) {
    throw new Error('NAPCAT_MAX_TEXT_LENGTH must be a positive integer');
  }

  return {
    wsUrl,
    accessToken: value('NAPCAT_ACCESS_TOKEN')?.trim() || undefined,
    selfId,
    allowedUsers: parseIdList(value('NAPCAT_ALLOWED_USERS')),
    allowedGroups: parseIdList(value('NAPCAT_ALLOWED_GROUPS')),
    blockedUsers: parseIdList(value('NAPCAT_BLOCKED_USERS')),
    blockedGroups: parseIdList(value('NAPCAT_BLOCKED_GROUPS')),
    admins: parseIdList(value('NAPCAT_ADMINS')),
    requireAtInGroup: value('NAPCAT_REQUIRE_AT_IN_GROUP') !== 'false',
    maxTextLength,
    welcomeMessage: value('NAPCAT_WELCOME_MSG')?.trim() || undefined,
    goodbyeMessage: value('NAPCAT_GOODBYE_MSG')?.trim() || undefined,
  };
}
