import 'dotenv/config';

/**
 * Phase 4 E2E verification: admin commands and access control.
 *
 * Prerequisites:
 *   - docker-compose.test.yml stack running
 *   - bot and user-b account variables are set in .env
 *   - user-b is a member of NAPCAT_TEST_GROUP_ID
 *
 * The script listens on user-b's OneBot WS (3004) for messages FROM the bot,
 * sends admin commands via user-b's HTTP API, and asserts the replies.
 * It also verifies that a non-whitelisted sender is dropped.
 */

import WebSocket from 'ws';
import { createOneBotNapCatAdapter } from '../src/onebot-napcat.js';
import type { ChannelSetup } from '../src/vendor/nanoclaw-adapter-types.js';
import type { OneBotEvent } from '../src/protocol/onebot-v11.js';

const TOKEN = process.env.NAPCAT_ACCESS_TOKEN || '';
function requiredNumber(name: string): number {
  const value = process.env[name]?.trim();
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Set ${name} to a numeric QQ/group ID before running this E2E test`);
  }
  return Number(value);
}

const BOT_QQ = requiredNumber('NAPCAT_BOT_ACCOUNT');
const USER_B_QQ = requiredNumber('NAPCAT_USER_B_ACCOUNT');
const USER_A_QQ = requiredNumber('NAPCAT_USER_A_ACCOUNT');
const GROUP_ID = requiredNumber('NAPCAT_TEST_GROUP_ID');
const USER_B_HTTP = process.env.NAPCAT_USER_B_HTTP_URL || `http://127.0.0.1:${process.env.NAPCAT_USER_B_HTTP_PORT || '3003'}`;
const USER_B_WS = process.env.NAPCAT_USER_B_WS_URL || `ws://127.0.0.1:${process.env.NAPCAT_USER_B_WS_PORT || '3004'}`;

let inboundCount = 0;

const adapter = createOneBotNapCatAdapter({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg, ...args) => console.error('[adapter:error]', msg, ...args),
  },
});

const setup: ChannelSetup = {
  onInbound: () => {
    inboundCount++;
  },
  onInboundEvent: () => {
    // CLI admin transport only; not used by this harness.
  },
  onMetadata: () => {
    // Not exercised here.
  },
  onAction: () => {
    // QQ has no card buttons; never called.
  },
};

// ---------------------------------------------------------------------------
// OneBot HTTP helper (as user-b)
// ---------------------------------------------------------------------------

async function userBApi(
  action: string,
  params: Record<string, unknown>,
): Promise<{ retcode: number; message?: string }> {
  const res = await fetch(`${USER_B_HTTP}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(params),
  });
  return (await res.json()) as { retcode: number; message?: string };
}

function sendGroupText(text: string): Promise<{ retcode: number }> {
  return userBApi('send_group_msg', {
    group_id: GROUP_ID,
    message: [{ type: 'text', data: { text } }],
  });
}

function sendPrivateText(text: string): Promise<{ retcode: number }> {
  return userBApi('send_private_msg', {
    user_id: BOT_QQ,
    message: [{ type: 'text', data: { text } }],
  });
}

// ---------------------------------------------------------------------------
// Listener on user-b's WS: collects messages FROM the bot
// ---------------------------------------------------------------------------

const botMessages: { text: string; scope: string }[] = [];

function startUserBListener(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(USER_B_WS, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const text = Buffer.isBuffer(raw)
        ? raw.toString('utf-8')
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf-8')
          : Buffer.from(raw).toString('utf-8');
      const event = JSON.parse(text) as OneBotEvent;
      if (
        event.post_type === 'message' &&
        (event as { user_id?: number }).user_id === BOT_QQ
      ) {
        const msg = event as {
          message_type: string;
          message: { type: string; data: { text?: string } }[];
        };
        const text = msg.message
          .filter((s) => s.type === 'text')
          .map((s) => s.data.text ?? '')
          .join('');
        botMessages.push({ text, scope: msg.message_type });
      }
    });
  });
}

async function waitForBotReply(
  predicate: (text: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = botMessages.find((m) => predicate(m.text));
    if (hit) return hit.text;
    await sleep(300);
  }
  throw new Error(
    `Timed out waiting for bot reply. Got: ${JSON.stringify(botMessages.map((m) => m.text))}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(
      `FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function expectContain(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`expected reply to contain "${needle}", got: ${haystack}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[e2e-admin] starting...');

  // user-b must be an admin for this run.
  process.env.NAPCAT_ADMINS = String(USER_B_QQ);
  // No allowlist restrictions for the command tests.
  delete process.env.NAPCAT_ALLOWED_USERS;
  delete process.env.NAPCAT_ALLOWED_GROUPS;

  await startUserBListener();
  await adapter.setup(setup);

  for (let i = 0; i < 40 && !adapter.isConnected(); i++) {
    await sleep(500);
  }
  if (!adapter.isConnected()) throw new Error('adapter failed to connect');
  console.log('[e2e-admin] adapter connected');

  await test('/status replies with status and login info', async () => {
    botMessages.length = 0;
    await sendGroupText('/status');
    const reply = await waitForBotReply((t) => t.includes('状态'));
    expectContain(reply, '在线');
    expectContain(reply, String(BOT_QQ));
  });

  await test('/mute bans and unmutes a member', async () => {
    botMessages.length = 0;
    await sendGroupText(`/mute ${USER_A_QQ} 60`);
    const reply = await waitForBotReply((t) => t.includes('禁言'));
    expectContain(reply, `禁言 60 秒`);

    botMessages.length = 0;
    await sendGroupText(`/mute ${USER_A_QQ} 0`);
    const reply2 = await waitForBotReply((t) => t.includes('解除禁言'));
    expectContain(reply2, '解除禁言');
  });

  await test('/kick on unknown QQ explains the cause', async () => {
    botMessages.length = 0;
    await sendGroupText('/kick 123456789');
    const reply = await waitForBotReply((t) => t.includes('不在该群内'));
    expectContain(reply, '目标 QQ 不在该群内或不存在');
  });

  await test('/allow user adds to allowlist', async () => {
    botMessages.length = 0;
    await sendPrivateText('/allow user 123456789');
    const reply = await waitForBotReply((t) => t.includes('白名单'));
    expectContain(reply, '已将用户 123456789 加入白名单');
  });

  await test('/block user adds to blocklist', async () => {
    botMessages.length = 0;
    await sendPrivateText('/block user 123456789');
    const reply = await waitForBotReply((t) => t.includes('黑名单'));
    expectContain(reply, '已将用户 123456789 加入黑名单');
  });

  await test('non-whitelisted private sender is dropped', async () => {
    // Restart adapter with a private allowlist that excludes user-b.
    await adapter.teardown();
    process.env.NAPCAT_ALLOWED_USERS = '111111';
    inboundCount = 0;

    const adapter2 = createOneBotNapCatAdapter({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (msg, ...args) => console.error('[adapter:error]', msg, ...args),
      },
    });
    await adapter2.setup(setup);
    for (let i = 0; i < 40 && !adapter2.isConnected(); i++) {
      await sleep(500);
    }
    if (!adapter2.isConnected()) throw new Error('adapter2 failed to connect');

    await sendPrivateText('should be dropped');
    await sleep(4000);

    if (inboundCount !== 0) {
      throw new Error(`expected 0 inbound, got ${inboundCount}`);
    }

    // The dropped message must not produce any echo/admin side effect.
    await adapter2.teardown();
    delete process.env.NAPCAT_ALLOWED_USERS;
  });

  console.log(`\n[e2e-admin] done: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e-admin] fatal', err);
  process.exit(1);
});
