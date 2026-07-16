import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchBase64,
  mimeTypeToSegmentType,
  buildBase64Segment,
} from './media.js';

describe('media helpers', () => {
  describe('mimeTypeToSegmentType', () => {
    it('maps image mime types to image', () => {
      expect(mimeTypeToSegmentType('image/png')).toBe('image');
      expect(mimeTypeToSegmentType('image/jpeg')).toBe('image');
      expect(mimeTypeToSegmentType('image/webp')).toBe('image');
    });

    it('maps audio mime types to record', () => {
      expect(mimeTypeToSegmentType('audio/mpeg')).toBe('record');
      expect(mimeTypeToSegmentType('audio/opus')).toBe('record');
      expect(mimeTypeToSegmentType('application/ogg')).toBe('record');
    });

    it('maps other mime types to file', () => {
      expect(mimeTypeToSegmentType('application/pdf')).toBe('file');
      expect(mimeTypeToSegmentType('text/plain')).toBe('file');
    });
  });

  describe('buildBase64Segment', () => {
    it('builds image segment', () => {
      const seg = buildBase64Segment('image', 'abc', 'pic.png');
      expect(seg).toEqual({
        type: 'image',
        data: { file: 'base64://abc', name: 'pic.png' },
      });
    });

    it('builds record segment without name', () => {
      const seg = buildBase64Segment('record', 'def');
      expect(seg).toEqual({
        type: 'record',
        data: { file: 'base64://def' },
      });
    });

    it('builds file segment', () => {
      const seg = buildBase64Segment('file', 'ghi', 'doc.pdf');
      expect(seg).toEqual({
        type: 'file',
        data: { file: 'base64://ghi', name: 'doc.pdf' },
      });
    });
  });

  describe('fetchBase64', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns base64 data and mime type', async () => {
      const response = new Response(Buffer.from('hello'), {
        status: 200,
        headers: { 'content-type': 'image/png; charset=utf-8' },
      });
      vi.mocked(globalThis.fetch).mockResolvedValue(response);

      const result = await fetchBase64('http://example.com/a.png');
      expect(result.data).toBe(Buffer.from('hello').toString('base64'));
      expect(result.mimeType).toBe('image/png');
    });

    it('throws on non-ok response', async () => {
      const response = new Response('', { status: 404 });
      vi.mocked(globalThis.fetch).mockResolvedValue(response);

      await expect(fetchBase64('http://example.com/missing')).rejects.toThrow(
        /404/,
      );
    });
  });
});
