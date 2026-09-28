import { loadConfig, type NapcatConfig } from './config.js';
import { OneBotWsClient, type Logger } from './client/onebot-ws-client.js';
import { eventToInbound } from './inbound/event-to-inbound.js';
import { handleNoticeEvent } from './inbound/notices.js';
import { deliver } from './outbound/deliver.js';
import { checkAccess } from './allowlist.js';
import { handleAdminCommand } from './admin-cmds.js';
import type {
  ChannelAdapter,
  ChannelDefaults,
  ChannelSetup,
  OutboundMessage,
} from './vendor/nanoclaw-adapter-types.js';
import { registerChannelAdapter } from './vendor/channel-registry.js';
import {
  ACTIONS,
  isHeartbeatEvent,
  isPrivateMessageEvent,
  isGroupMessageEvent,
  isGroupIncreaseEvent,
  isGroupDecreaseEvent,
  type LoginInfo,
  type OneBotEvent,
  type OneBotApiResult,
  type MessageSegment,
  type TextSegment,
} from './protocol/onebot-v11.js';

export interface OneBotNapcatAdapterOptions {
  logger?: Logger;
}

/**
 * Wiring-time defaults declared for the QQ channel.
 * - DM: every message engages (QQ DMs are always directed at the bot).
 * - Group: only @bot mentions engage, then stick for the session.
 */
const CHANNEL_DEFAULTS: ChannelDefaults = {
  dm: {
    engageMode: 'pattern',
    engagePattern: '.',
    threads: false,
    unknownSenderPolicy: 'decline_notify',
  },
  group: {
    engageMode: 'mention-sticky',
    threads: false,
    unknownSenderPolicy: 'request_approval',
  },
  mentions: 'platform',
};

export function createOneBotNapCatAdapter(
  options: OneBotNapcatAdapterOptions = {},
): ChannelAdapter {
  return new OneBotNapcatAdapter(options);
}

/**
 * Host-facing factory: returns null when the NapCat credentials are missing
 * so the host skips this channel instead of failing startup.
 */
export function oneBotNapCatAdapterFactory(): ChannelAdapter | null {
  try {
    loadConfig();
  } catch {
    return null;
  }
  return createOneBotNapCatAdapter();
}

class OneBotNapcatAdapter implements ChannelAdapter {
  name = 'onebot-napcat';
  channelType = 'qq';
  supportsThreads = false;
  defaults = CHANNEL_DEFAULTS;

  private config!: NapcatConfig;
  private client!: OneBotWsClient;
  private setupConfig?: ChannelSetup;
  private logger: Logger;

  constructor(options: OneBotNapcatAdapterOptions = {}) {
    this.logger = options.logger ?? createConsoleLogger();
  }

  setup(config: ChannelSetup): Promise<void> {
    this.setupConfig = config;
    this.config = loadConfig();

    this.client = new OneBotWsClient({
      wsUrl: this.config.wsUrl,
      accessToken: this.config.accessToken,
      logger: this.logger,
    });

    this.client.onEvent((event) => {
      this.handleEvent(event).catch((err) => {
        this.logger.error('Unhandled event handler error', err);
      });
    });
    this.client.connect();

    // Fetch login info once connected so the host can map the bot identity.
    this.waitAndReportLoginInfo().catch((err) => {
      this.logger.warn('Could not fetch OneBot login info', err);
    });

    return Promise.resolve();
  }

  teardown(): Promise<void> {
    this.client?.dispose();
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  async deliver(
    platformId: string,
    threadId: string | null,
    message: OutboundMessage,
  ): Promise<string | undefined> {
    this.logger.info('Delivering outbound message', {
      platformId,
      threadId,
      kind: message.kind,
    });
    return deliver(
      { config: this.config, client: this.client },
      platformId,
      threadId,
      message,
    );
  }

  private async handleEvent(event: OneBotEvent): Promise<void> {
    if (isHeartbeatEvent(event)) {
      this.logger.debug('Heartbeat received', { interval: event.interval });
      return;
    }

    if (isGroupIncreaseEvent(event) || isGroupDecreaseEvent(event)) {
      await handleNoticeEvent({ config: this.config, client: this.client }, event);
      return;
    }

    if (!isPrivateMessageEvent(event) && !isGroupMessageEvent(event)) {
      return;
    }

    const platformId = isPrivateMessageEvent(event)
      ? `qq:${event.user_id}`
      : `qq:group:${event.group_id}`;
    const rawText = extractText(event.message);

    // Admin commands bypass normal access control and are not forwarded to host.
    const adminHandled = await handleAdminCommand(
      {
        config: this.config,
        client: this.client,
        event,
        platformId,
        sendReply: (text) => this.sendText(platformId, text),
      },
      rawText,
    );
    if (adminHandled) return;

    const access = checkAccess(this.config, event);
    if (!access.allowed) {
      this.logger.debug('Access denied', {
        platformId,
        senderId: event.user_id,
        reason: access.reason,
      });
      return;
    }

    const result = await eventToInbound(this.config, event);
    if (!result) return;

    const content = result.inboundMessage.content as {
      senderId?: string;
      isMention?: boolean;
      attachments?: unknown[];
    };

    this.logger.info('Inbound message', {
      platformId: result.platformId,
      senderId: content.senderId,
      isMention: content.isMention,
      attachments: content.attachments?.length ?? 0,
    });

    void this.setupConfig?.onInbound(
      result.platformId,
      result.threadId,
      result.inboundMessage,
    );
  }

  private async sendText(platformId: string, text: string): Promise<void> {
    const segment: MessageSegment = { type: 'text', data: { text } };
    const target = parsePlatformId(platformId);

    if (target.type === 'private') {
      await this.client.call<OneBotApiResult>(ACTIONS.SEND_PRIVATE_MSG, {
        user_id: target.userId,
        message: [segment],
      });
    } else {
      await this.client.call<OneBotApiResult>(ACTIONS.SEND_GROUP_MSG, {
        group_id: target.groupId,
        message: [segment],
      });
    }
  }

  private async waitAndReportLoginInfo(): Promise<void> {
    // Wait briefly for the connection to come up.
    for (let i = 0; i < 50; i++) {
      if (this.client.isConnected()) break;
      await sleep(100);
    }

    if (!this.client.isConnected()) {
      throw new Error('Timed out waiting for OneBot connection');
    }

    const info = await this.client.call<LoginInfo>(ACTIONS.GET_LOGIN_INFO, {});
    this.logger.info('OneBot login info', info);

    if (this.setupConfig?.onMetadata) {
      this.setupConfig.onMetadata(
        this.config.selfId ? `qq:${this.config.selfId}` : `qq:${info.user_id}`,
        info.nickname,
        false,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(message: MessageSegment[]): string {
  return message
    .filter((seg): seg is TextSegment => seg.type === 'text')
    .map((seg) => seg.data.text)
    .join('');
}

interface ParsedPrivate {
  type: 'private';
  userId: number;
}

interface ParsedGroup {
  type: 'group';
  groupId: number;
}

type ParsedPlatformId = ParsedPrivate | ParsedGroup;

function parsePlatformId(platformId: string): ParsedPlatformId {
  const privateMatch = /^qq:(\d+)$/.exec(platformId);
  if (privateMatch) {
    return { type: 'private', userId: Number(privateMatch[1]) };
  }

  const groupMatch = /^qq:group:(\d+)$/.exec(platformId);
  if (groupMatch) {
    return { type: 'group', groupId: Number(groupMatch[1]) };
  }

  throw new Error(`Invalid OneBot platform ID: ${platformId}`);
}

function createConsoleLogger(): Logger {
  return {
    debug: (message, ...args) =>
      console.debug(`[onebot-napcat] ${message}`, ...args),
    info: (message, ...args) =>
      console.info(`[onebot-napcat] ${message}`, ...args),
    warn: (message, ...args) =>
      console.warn(`[onebot-napcat] ${message}`, ...args),
    error: (message, ...args) =>
      console.error(`[onebot-napcat] ${message}`, ...args),
  };
}

// Self-register on import (NanoClaw channel barrel convention). The vendored
// shim is a no-op locally; in the host this hits the real channel registry.
registerChannelAdapter('onebot-napcat', {
  factory: oneBotNapCatAdapterFactory,
  defaults: CHANNEL_DEFAULTS,
});
