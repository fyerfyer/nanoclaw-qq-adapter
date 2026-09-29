import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('reads NapCat settings from the host .env file', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'napcat-config-'));
    try {
      writeFileSync(
        join(projectRoot, '.env'),
        [
          'NAPCAT_WS_URL=ws://127.0.0.1:3001',
          'NAPCAT_ACCESS_TOKEN="file-token"',
          'NAPCAT_SELF_ID=3384461856',
          'NAPCAT_ADMINS=2101197401, 2157875424',
          'NAPCAT_REQUIRE_AT_IN_GROUP=false',
          'NAPCAT_MAX_TEXT_LENGTH=1234',
        ].join('\n'),
      );

      const config = loadConfig({}, projectRoot);

      expect(config.wsUrl).toBe('ws://127.0.0.1:3001');
      expect(config.accessToken).toBe('file-token');
      expect(config.selfId).toBe('3384461856');
      expect(config.admins).toEqual(new Set(['2101197401', '2157875424']));
      expect(config.requireAtInGroup).toBe(false);
      expect(config.maxTextLength).toBe(1234);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('prefers explicit environment values over .env values', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'napcat-config-'));
    try {
      writeFileSync(join(projectRoot, '.env'), 'NAPCAT_WS_URL=ws://file\nNAPCAT_ACCESS_TOKEN=file-token\n');

      const config = loadConfig(
        { NAPCAT_WS_URL: 'ws://process', NAPCAT_ACCESS_TOKEN: 'process-token' },
        projectRoot,
      );

      expect(config.wsUrl).toBe('ws://process');
      expect(config.accessToken).toBe('process-token');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
