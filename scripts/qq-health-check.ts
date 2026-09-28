import 'dotenv/config';

/**
 * QQ health check for the OneBot Napcat adapter.
 *
 * This is NOT a functional test of NanoClaw itself. It only verifies that
 * the adapter can receive inbound messages from NapCat and deliver outbound
 * replies back to QQ. Use it to confirm the WS/HTTP plumbing is alive.
 *
 * Run with a real NapCat instance:
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   # Complete QQ login in the WebUIs
 *   pnpm e2e:health
 *
 * The script will echo every received private/group text back to the sender.
 */

import { createOneBotNapCatAdapter } from '../src/onebot-napcat.js';
import type { ChannelSetup } from '../src/vendor/nanoclaw-adapter-types.js';

const adapter = createOneBotNapCatAdapter();

const setup: ChannelSetup = {
  onInbound: (platformId, threadId, message) => {
    const content = message.content as {
      sender?: string;
      senderId?: string;
      text?: string;
      isFromMe?: boolean;
    };
    console.log('\n[health-check] inbound', {
      platformId,
      threadId,
      sender: content.sender,
      senderId: content.senderId,
      text: content.text,
    });

    if (!content.text || content.isFromMe) return;

    void adapter
      .deliver(platformId, threadId, {
        kind: 'chat',
        content: { text: `Echo: ${content.text}` },
      })
      .then(() => {
        console.log('[health-check] delivered echo');
      })
      .catch((err) => {
        console.error('[health-check] failed to deliver echo', err);
      });
  },
  onInboundEvent: () => {
    // CLI admin transport only; not used by this harness.
  },
  onMetadata: (platformId, name, isGroup) => {
    console.log('[health-check] metadata', { platformId, name, isGroup });
  },
  onAction: () => {
    // QQ has no card buttons; never called.
  },
};

async function main(): Promise<void> {
  console.log('[health-check] starting adapter...');
  await adapter.setup(setup);

  process.on('SIGINT', () => {
    console.log('\n[health-check] shutting down...');
    void adapter.teardown().then(() => {
      process.exit(0);
    });
  });

  setInterval(() => {
    console.log('[health-check] connected:', adapter.isConnected());
  }, 30000);
}

main().catch((err) => {
  console.error('[health-check] fatal', err);
  process.exit(1);
});
