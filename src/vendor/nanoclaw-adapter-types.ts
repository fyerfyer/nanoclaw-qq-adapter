/**
 * Minimal vendored types from NanoClaw v2's Channel Adapter interface.
 *
 * These declarations exist only for local development and unit tests in this
 * repository. When this adapter is copied into a NanoClaw host under
 * `src/channels/onebot-napcat/`, these imports should be replaced by the host's
 * real `../adapter.js` exports.
 */

export interface ConversationConfig {
  platformId: string;
  agentGroupId: string;
  triggerPattern?: string;
  requiresTrigger: boolean;
  sessionMode: 'shared' | 'per-thread';
}

export interface ChannelSetup {
  conversations: ConversationConfig[];
  onInbound(
    platformId: string,
    threadId: string | null,
    message: InboundMessage,
  ): void;
  onMetadata?(platformId: string, name?: string, isGroup?: boolean): void;
}

export interface InboundMessage {
  id: string;
  kind: 'chat' | 'chat-sdk';
  content: unknown;
  timestamp: string;
}

export interface OutboundMessage {
  kind: 'chat' | 'chat-sdk';
  content: unknown;
}

export interface ChannelAdapter {
  name: string;
  channelType: string;

  setup(config: ChannelSetup): Promise<void>;
  teardown(): Promise<void>;
  isConnected(): boolean;

  deliver(
    platformId: string,
    threadId: string | null,
    message: OutboundMessage,
  ): Promise<void>;

  setTyping?(platformId: string, threadId: string | null): Promise<void>;
  syncConversations?(): Promise<ConversationInfo[]>;
  updateConversations?(conversations: ConversationConfig[]): void;
}

export interface ConversationInfo {
  platformId: string;
  name?: string;
  isGroup?: boolean;
}
