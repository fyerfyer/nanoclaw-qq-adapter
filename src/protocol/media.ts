/**
 * Helpers for downloading media and converting it to OneBot v11 base64 segments.
 */

import type { MessageSegment } from './onebot-v11.js';

export type MediaSegmentType = 'image' | 'record' | 'file';

export interface FetchedMedia {
  data: string;
  mimeType?: string;
}

export interface MediaAttachment {
  name: string;
  mimeType: string;
  data: string;
  type: MediaSegmentType;
}

export async function fetchBase64(url: string): Promise<FetchedMedia> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download media: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get('content-type') || undefined;
  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString('base64');

  return {
    data,
    mimeType: contentType ? contentType.split(';')[0].trim() : undefined,
  };
}

export function mimeTypeToSegmentType(mimeType: string): MediaSegmentType {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('audio/')) return 'record';
  if (normalized === 'application/ogg') return 'record';
  return 'file';
}

export function buildBase64Segment(
  type: MediaSegmentType,
  base64: string,
  name?: string,
): MessageSegment {
  const file = `base64://${base64}`;
  if (type === 'image') {
    return { type: 'image', data: { file, name } };
  }
  if (type === 'record') {
    return { type: 'record', data: { file, name } };
  }
  return { type: 'file', data: { file, name } };
}
