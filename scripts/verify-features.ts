import 'dotenv/config';

/**
 * Feature verification for Phase 3 + Phase 4.
 *
 * This script starts the adapter against the real NapCat test stack and logs
 * inbound message details (text, isMention, attachments, replyToMessageId).
 * It then sends a sequence of test messages via User-B's OneBot HTTP API to
 * exercise:
 *
 *   - private text
 *   - group @ mention text
 *   - inbound image (rich media download -> base64 attachment)
 *   - admin command /status in group
 *
 * Finally it manually sends an outbound message with an image attachment to
 * verify outbound rich-media construction.
 *
 * Run after `docker compose -f docker-compose.test.yml up -d` and QQ login.
 */

import { readFileSync } from 'node:fs';
import { createOneBotNapCatAdapter } from '../src/onebot-napcat.js';
import type { ChannelSetup } from '../src/vendor/nanoclaw-adapter-types.js';

// Make User-B an admin for this verification run.
process.env.NAPCAT_ADMINS = '2101197401';

const USER_B_HTTP = 'http://127.0.0.1:3003';
const TOKEN = process.env.NAPCAT_ACCESS_TOKEN || 'nanoclaw-test-token';
const BOT_QQ = 3384461856;
const USER_B_QQ = 2101197401;
const GROUP_ID = 922216566;

const IMAGE_BASE64 = readFileSync(
  new URL('../image.jpg', import.meta.url),
).toString('base64');

const adapter = createOneBotNapCatAdapter();

const setup: ChannelSetup = {
  conversations: [],
  onInbound: (platformId, threadId, message) => {
    const content = message.content as {
      sender?: string;
      senderId?: string;
      text?: string;
      isMention?: boolean;
      isFromMe?: boolean;
      attachments?: unknown[];
      replyToMessageId?: string;
    };
    console.log('\n[verify] inbound', {
      platformId,
      threadId,
      kind: message.kind,
      sender: content.sender,
      senderId: content.senderId,
      text: content.text,
      isMention: content.isMention,
      attachments: content.attachments?.length ?? 0,
      replyToMessageId: content.replyToMessageId,
    });

    if (content.attachments && content.attachments.length > 0) {
      console.log(
        '[verify] attachments',
        JSON.stringify(content.attachments, null, 2),
      );
    }
  },
  onMetadata: (platformId, name, isGroup) => {
    console.log('[verify] metadata', { platformId, name, isGroup });
  },
};

async function onebotApi(
  action: string,
  params: Record<string, unknown>,
): Promise<{
  status: string;
  retcode: number;
  data?: { message_id?: number } | null;
  message?: string;
}> {
  const response = await fetch(`${USER_B_HTTP}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(params),
  });
  return response.json() as Promise<{
    status: string;
    retcode: number;
    data?: { message_id?: number } | null;
    message?: string;
  }>;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConnection(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (adapter.isConnected()) return;
    await sleep(500);
  }
  throw new Error('Adapter failed to connect');
}

async function main(): Promise<void> {
  console.log('[verify] starting adapter...');
  await adapter.setup(setup);
  await waitForConnection();
  console.log('[verify] adapter connected');

  // 1. Private text
  console.log('\n[verify] 1. private text ping');
  const privatePing = await onebotApi('send_private_msg', {
    user_id: BOT_QQ,
    message: [{ type: 'text', data: { text: 'ping' } }],
  });
  console.log('[verify] send_private_msg response', {
    retcode: privatePing.retcode,
    message_id: privatePing.data?.message_id,
  });
  await sleep(3000);

  // 2. Group @ text
  console.log('\n[verify] 2. group @ text');
  await onebotApi('send_group_msg', {
    group_id: GROUP_ID,
    message: [
      { type: 'at', data: { qq: BOT_QQ } },
      { type: 'text', data: { text: ' group ping' } },
    ],
  });
  await sleep(3000);

  // 3. Reply segment
  if (privatePing.data?.message_id) {
    console.log('\n[verify] 3. reply segment');
    await onebotApi('send_private_msg', {
      user_id: BOT_QQ,
      message: [
        { type: 'reply', data: { id: privatePing.data.message_id } },
        { type: 'text', data: { text: 'this is a reply' } },
      ],
    });
    await sleep(3000);
  }

  // 4. Inbound image (rich media)
  console.log('\n[verify] 4. inbound image');
  await onebotApi('send_private_msg', {
    user_id: BOT_QQ,
    message: [
      {
        type: 'image',
        data: { file: `base64://${IMAGE_BASE64}` },
      },
    ],
  });
  await sleep(8000);

  // 5. Admin command /status in group
  console.log('\n[verify] 5. admin command /status');
  await onebotApi('send_group_msg', {
    group_id: GROUP_ID,
    message: [
      { type: 'at', data: { qq: BOT_QQ } },
      { type: 'text', data: { text: ' /status' } },
    ],
  });
  await sleep(8000);

  // 6. Outbound image attachment
  console.log('\n[verify] 6. outbound image attachment');
  try {
    await adapter.deliver(`qq:${USER_B_QQ}`, null, {
      kind: 'chat',
      content: {
        text: 'outbound image test',
        attachments: [
          {
            name: 'image.jpg',
            mimeType: 'image/jpeg',
            data: IMAGE_BASE64,
            type: 'image',
          },
        ],
      },
    });
    console.log('[verify] outbound image delivered');
  } catch (err) {
    console.error('[verify] outbound image failed', err);
  }

  await sleep(3000);

  console.log('\n[verify] done');
  await adapter.teardown();
}

main().catch(async (err) => {
  console.error('[verify] fatal', err);
  await adapter.teardown();
  process.exit(1);
});
