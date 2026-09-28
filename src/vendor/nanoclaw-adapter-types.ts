/**
 * Minimal vendored types from NanoClaw v2's Channel Adapter interface.
 *
 * These declarations exist only for local development and unit tests in this
 * repository, and mirror `src/channels/adapter.ts` of the NanoClaw host. When
 * this adapter is copied into a NanoClaw host under
 * `src/channels/onebot-napcat/`, these imports are replaced by the host's
 * real `../adapter.js` exports (see scripts/install-onebot-napcat.ts).
 */

/** Passed to the adapter at setup time. */
export interface ChannelSetup {
  /** Called when an inbound message arrives from the platform. */
  onInbound(
    platformId: string,
    threadId: string | null,
    message: InboundMessage,
  ): void | Promise<void>;

  /**
   * Called by admin-transport adapters (CLI) that want to route a message to
   * an arbitrary channel/platform. Regular chat adapters use `onInbound`.
   */
  onInboundEvent(event: InboundEvent): void | Promise<void>;

  /** Called when the adapter discovers metadata about a conversation. */
  onMetadata(platformId: string, name?: string, isGroup?: boolean): void;

  /** Called when a user clicks a button/action in a card. */
  onAction(
    questionId: string,
    selectedOption: string,
    userId: string,
    address?: {
      instance?: string;
      messageId?: string;
      platformId?: string;
      threadId?: string | null;
    },
  ): void;
}

/** Delivery address used for reply-to overrides. */
export interface DeliveryAddress {
  channelType: string;
  platformId: string;
  threadId: string | null;
}

/** Full inbound event handed to the router. */
export interface InboundEvent {
  channelType: string;
  instance?: string;
  platformId: string;
  threadId: string | null;
  message: {
    id: string;
    kind: 'chat' | 'chat-sdk';
    content: string;
    timestamp: string;
    isMention?: boolean;
    isGroup?: boolean;
  };
  replyTo?: DeliveryAddress;
}

/** Inbound message from adapter to host. */
export interface InboundMessage {
  id: string;
  kind: 'chat' | 'chat-sdk';
  content: unknown;
  timestamp: string;
  /**
   * Platform-confirmed mention signal read by the host router
   * (`isMention === true` check). Adapters that don't set it leave it
   * undefined — the router treats undefined as "not a mention".
   */
  isMention?: boolean;
  /** True when the source is a group/channel thread, false for DMs. */
  isGroup?: boolean;
}

/** A file attachment to deliver alongside a message. */
export interface OutboundFile {
  filename: string;
  data: Buffer;
}

/** Outbound message from host to adapter. */
export interface OutboundMessage {
  kind: string;
  content: unknown;
  files?: OutboundFile[];
}

/** Discovered conversation info (from syncConversations). */
export interface ConversationInfo {
  platformId: string;
  name: string;
  isGroup: boolean;
}

/** Human-readable conversation metadata resolved by an adapter. */
export interface ResolvedConversation {
  type: 'direct' | 'group_dm' | 'channel';
  name: string | null;
  participantNames?: string[];
  participantIds?: string[];
}

/** Wiring/mg defaults for one conversation context (DM vs group/channel). */
export interface ChannelContextDefaults {
  engageMode: 'pattern' | 'mention' | 'mention-sticky';
  engagePattern?: string;
  threads: boolean;
  sessionMode?: 'shared' | 'per-thread';
  unknownSenderPolicy:
    | 'strict'
    | 'request_approval'
    | 'decline_notify'
    | 'public';
}

/** Static per-channel declaration of wiring-time defaults. */
export interface ChannelDefaults {
  dm: ChannelContextDefaults;
  group: ChannelContextDefaults;
  mentions: 'platform' | 'dm-only' | 'never';
}

/** The v2 channel adapter contract. */
export interface ChannelAdapter {
  name: string;
  channelType: string;

  /**
   * Adapter-instance name — distinguishes N adapters of one platform.
   * Defaults to channelType.
   */
  instance?: string;

  /**
   * Whether this adapter models conversations as threads. QQ groups are the
   * conversation unit, so this is `false`.
   */
  supportsThreads: boolean;

  // Lifecycle
  setup(config: ChannelSetup): Promise<void>;
  teardown(): Promise<void>;
  isConnected(): boolean;

  // Outbound delivery — returns the platform message ID if available
  deliver(
    platformId: string,
    threadId: string | null,
    message: OutboundMessage,
  ): Promise<string | undefined>;

  // Optional
  setTyping?(
    platformId: string,
    threadId: string | null,
    status?: string,
    statusKind?: 'auto' | 'agent',
  ): Promise<void>;
  syncConversations?(): Promise<ConversationInfo[]>;
  resolveConversation?(platformId: string): Promise<ResolvedConversation | null>;
  resolveChannelName?(platformId: string): Promise<string | null>;
  setThreadTitle?(
    platformId: string,
    threadId: string,
    title: string,
  ): Promise<void>;
  setSuggestedPrompts?(
    platformId: string,
    prompts: Array<{ title: string; message: string }>,
    title?: string,
  ): Promise<void>;
  subscribe?(platformId: string, threadId: string): Promise<void>;
  openDM?(userHandle: string): Promise<string>;

  /** Declared wiring-time defaults for this channel. */
  defaults?: ChannelDefaults;
}

/** Factory function that creates a channel adapter (returns null if credentials missing). */
export type ChannelAdapterFactory = () =>
  | ChannelAdapter
  | Promise<ChannelAdapter>
  | null;

/** Registration entry for a channel adapter. */
export interface ChannelRegistration {
  factory: ChannelAdapterFactory;
  defaults?: ChannelDefaults;
  containerConfig?: {
    mounts?: Array<{ hostPath: string; containerPath: string; readonly: boolean }>;
    env?: Record<string, string>;
  };
}
