import type { NapcatConfig } from '../config.js';
import type { OutboundMessage } from '../vendor/nanoclaw-adapter-types.js';
import type { OneBotWsClient } from '../client/onebot-ws-client.js';
import type {
  MessageSegment,
  OneBotApiResult,
} from '../protocol/onebot-v11.js';
import { ACTIONS } from '../protocol/onebot-v11.js';
import {
  buildBase64Segment,
  mimeTypeToSegmentType,
  type MediaAttachment,
} from '../protocol/media.js';

export interface DeliverOptions {
  config: NapcatConfig;
  client: OneBotWsClient;
}

export interface OutboundChatContent {
  text?: string;
  attachments?: MediaAttachment[];
}

export async function deliver(
  options: DeliverOptions,
  platformId: string,
  _threadId: string | null,
  message: OutboundMessage,
): Promise<void> {
  const { text = '', attachments } = extractContent(message);
  const target = parsePlatformId(platformId);

  const attachmentSegments: MessageSegment[] = (attachments ?? []).map((a) =>
    buildBase64Segment(mimeTypeToSegmentType(a.mimeType), a.data, a.name),
  );

  const chunks = splitText(text, options.config.maxTextLength);

  // If there is no text but there are attachments, still send one message.
  const messageCount = Math.max(1, chunks.length);

  for (let i = 0; i < messageCount; i++) {
    const segments: MessageSegment[] = [];

    // Attachments ride along with the first message only.
    if (i === 0) {
      segments.push(...attachmentSegments);
    }

    if (chunks[i]) {
      segments.push({ type: 'text', data: { text: chunks[i] } });
    }

    if (segments.length === 0) continue;

    if (target.type === 'private') {
      await options.client.call<OneBotApiResult>(ACTIONS.SEND_PRIVATE_MSG, {
        user_id: target.userId,
        message: segments,
      });
    } else if (target.type === 'group') {
      await options.client.call<OneBotApiResult>(ACTIONS.SEND_GROUP_MSG, {
        group_id: target.groupId,
        message: segments,
      });
    } else {
      throw new Error(`Unsupported OneBot platform ID: ${platformId}`);
    }
  }
}

function extractContent(message: OutboundMessage): OutboundChatContent {
  if (message.kind !== 'chat') {
    throw new Error(
      `Unsupported outbound message kind for OneBot adapter: ${message.kind}`,
    );
  }

  const content = message.content as OutboundChatContent | undefined;
  if (!content) {
    throw new Error('Outbound chat message is missing content');
  }

  if (content.text !== undefined && typeof content.text !== 'string') {
    throw new Error('Outbound chat message text must be a string');
  }

  if (
    content.attachments !== undefined &&
    !Array.isArray(content.attachments)
  ) {
    throw new Error('Outbound chat message attachments must be an array');
  }

  return {
    text: content.text ?? '',
    attachments: content.attachments,
  };
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

export function splitText(text: string, maxLength: number): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n/);

  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < paragraph.length; i += maxLength) {
        chunks.push(paragraph.slice(i, i + maxLength));
      }
      continue;
    }

    const candidate = current ? `${current}\n${paragraph}` : paragraph;
    if (candidate.length > maxLength) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
