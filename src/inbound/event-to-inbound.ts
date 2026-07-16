import type { NapcatConfig } from '../config.js';
import type { InboundMessage } from '../vendor/nanoclaw-adapter-types.js';
import {
  fetchBase64,
  mimeTypeToSegmentType,
  type MediaAttachment,
} from '../protocol/media.js';
import {
  isTextSegment,
  isAtSegment,
  isImageSegment,
  isRecordSegment,
  isFileSegment,
  isReplySegment,
  isPrivateMessageEvent,
  isGroupMessageEvent,
  type GroupMessageEvent,
  type PrivateMessageEvent,
  type OneBotEvent,
  type MessageSegment,
} from '../protocol/onebot-v11.js';

export interface InboundChatContent {
  sender: string;
  senderId: string;
  text: string;
  isFromMe: false;
  isMention: boolean;
  attachments?: MediaAttachment[];
  replyToMessageId?: string;
}

export interface InboundResult {
  platformId: string;
  threadId: null;
  inboundMessage: InboundMessage;
}

export async function eventToInbound(
  config: NapcatConfig,
  event: OneBotEvent,
): Promise<InboundResult | null> {
  if (isPrivateMessageEvent(event)) {
    return privateMessageToInbound(config, event);
  }
  if (isGroupMessageEvent(event)) {
    return groupMessageToInbound(config, event);
  }
  return null;
}

async function privateMessageToInbound(
  config: NapcatConfig,
  event: PrivateMessageEvent,
): Promise<InboundResult | null> {
  const senderId = String(event.user_id);
  if (senderId === config.selfId) {
    return null;
  }

  const text = extractText(event.message);
  const attachments = await extractAttachments(event.message);
  const replyToMessageId = extractReplyId(event.message);
  const platformId = `qq:${senderId}`;

  return {
    platformId,
    threadId: null,
    inboundMessage: {
      id: String(event.message_id),
      kind: 'chat',
      content: buildContent({
        sender: event.sender.nickname || event.sender.card || senderId,
        senderId,
        text,
        isMention: true,
        attachments,
        replyToMessageId,
      }),
      timestamp: secondsToIso(event.time),
    },
  };
}

async function groupMessageToInbound(
  config: NapcatConfig,
  event: GroupMessageEvent,
): Promise<InboundResult | null> {
  const senderId = String(event.user_id);
  if (senderId === config.selfId) {
    return null;
  }

  const text = extractText(event.message);
  const attachments = await extractAttachments(event.message);
  const replyToMessageId = extractReplyId(event.message);
  const isMention = config.requireAtInGroup
    ? mentionsSelf(event.message, config.selfId)
    : true;

  const platformId = `qq:group:${event.group_id}`;

  return {
    platformId,
    threadId: null,
    inboundMessage: {
      id: String(event.message_id),
      kind: 'chat',
      content: buildContent({
        sender: event.sender.nickname || event.sender.card || senderId,
        senderId,
        text,
        isMention,
        attachments,
        replyToMessageId,
      }),
      timestamp: secondsToIso(event.time),
    },
  };
}

function buildContent(
  base: Omit<InboundChatContent, 'isFromMe'> & {
    isFromMe?: false;
  },
): InboundChatContent {
  const content: InboundChatContent = {
    sender: base.sender,
    senderId: base.senderId,
    text: base.text,
    isFromMe: false,
    isMention: base.isMention,
  };
  if (base.attachments && base.attachments.length > 0) {
    content.attachments = base.attachments;
  }
  if (base.replyToMessageId) {
    content.replyToMessageId = base.replyToMessageId;
  }
  return content;
}

function extractText(message: MessageSegment[]): string {
  return message.filter(isTextSegment).map((seg) => seg.data.text).join('');
}

async function extractAttachments(
  message: MessageSegment[],
): Promise<MediaAttachment[]> {
  const attachments: MediaAttachment[] = [];

  for (const seg of message) {
    if (!isImageSegment(seg) && !isRecordSegment(seg) && !isFileSegment(seg)) {
      continue;
    }

    const url = seg.data.url;
    const name = seg.data.name || seg.data.file;

    if (!url) {
      attachments.push({
        name: `${name} [无法下载]`,
        mimeType: 'text/plain',
        data: '',
        type: 'file',
      });
      continue;
    }

    try {
      const fetched = await fetchBase64(url);
      const mimeType = fetched.mimeType || 'application/octet-stream';
      attachments.push({
        name,
        mimeType,
        data: fetched.data,
        type: mimeTypeToSegmentType(mimeType),
      });
    } catch {
      attachments.push({
        name: `${name} [下载失败]`,
        mimeType: 'text/plain',
        data: '',
        type: 'file',
      });
    }
  }

  return attachments;
}

function extractReplyId(message: MessageSegment[]): string | undefined {
  const reply = message.find(isReplySegment);
  if (!reply) return undefined;
  return String(reply.data.id);
}

function mentionsSelf(
  message: MessageSegment[],
  selfId: string | undefined,
): boolean {
  if (!selfId) return false;
  return message.some((seg) => {
    if (!isAtSegment(seg)) return false;
    const qq = String(seg.data.qq);
    return qq === selfId || qq === 'all';
  });
}

function secondsToIso(time: number): string {
  return new Date(time * 1000).toISOString();
}
