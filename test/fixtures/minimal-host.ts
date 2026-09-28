import type {
  ChannelAdapter,
  ChannelSetup,
  InboundMessage,
} from '../../src/vendor/nanoclaw-adapter-types.js';

export interface CapturedInbound {
  platformId: string;
  threadId: string | null;
  message: InboundMessage;
}

export class MinimalHost {
  inbound: CapturedInbound[] = [];
  adapter: ChannelAdapter;

  constructor(adapter: ChannelAdapter) {
    this.adapter = adapter;
  }

  get setup(): ChannelSetup {
    return {
      onInbound: (platformId, threadId, message) => {
        this.inbound.push({ platformId, threadId, message });
      },
      onInboundEvent: () => {
        // Not exercised by this fixture.
      },
      onMetadata: (_platformId, name) => {
        // Exposed for debugging; tests can spy if needed.
        console.log('[minimal-host] metadata', { name });
      },
      onAction: () => {
        // QQ has no card buttons; never called.
      },
    };
  }

  async start(): Promise<void> {
    await this.adapter.setup(this.setup);
  }

  async stop(): Promise<void> {
    await this.adapter.teardown();
  }

  async sendOutbound(platformId: string, text: string): Promise<void> {
    await this.adapter.deliver(platformId, null, {
      kind: 'chat',
      content: { text },
    });
  }
}
