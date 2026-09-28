import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function runInstall(hostDir: string): ReturnType<typeof spawnSync> {
  return spawnSync('pnpm', ['exec', 'tsx', 'scripts/install-onebot-napcat.ts', '--host-dir', hostDir, '--skip-pnpm'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

function runRemove(hostDir: string): ReturnType<typeof spawnSync> {
  return spawnSync('pnpm', ['exec', 'tsx', 'scripts/remove-onebot-napcat.ts', '--host-dir', hostDir, '--skip-pnpm'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFakeHost(): string {
  const hostDir = mkdtempSync(join(tmpdir(), 'nanoclaw-host-'));

  writeFile(
    join(hostDir, 'package.json'),
    JSON.stringify({ name: 'fake-nanoclaw', version: '0.0.0', dependencies: {} }, null, 2),
  );

  writeFile(join(hostDir, '.env'), 'EXISTING_VAR=1\n');

  writeFile(join(hostDir, 'src', 'channels', 'index.ts'), "import './cli.js';\n");

  return hostDir;
}

describe('install-onebot-napcat', () => {
  let hostDir: string;

  beforeEach(() => {
    hostDir = createFakeHost();
  });

  afterEach(() => {
    runRemove(hostDir);
  });

  it('copies adapter source into the host and rewrites vendored imports', () => {
    const result = runInstall(hostDir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const adapterFile = join(hostDir, 'src', 'channels', 'onebot-napcat', 'onebot-napcat.ts');
    expect(existsSync(adapterFile)).toBe(true);

    const adapterContent = readFileSync(adapterFile, 'utf-8');
    expect(adapterContent).toContain("from '../adapter.js'");
    expect(adapterContent).toContain("from '../channel-registry.js'");
    expect(adapterContent).not.toContain('vendor/nanoclaw-adapter-types');
    expect(adapterContent).not.toContain('vendor/channel-registry');

    // Nested modules resolve two levels up to src/channels/.
    const inboundFile = join(hostDir, 'src', 'channels', 'onebot-napcat', 'inbound', 'event-to-inbound.ts');
    const inboundContent = readFileSync(inboundFile, 'utf-8');
    expect(inboundContent).toContain("from '../../adapter.js'");
    expect(inboundContent).not.toContain('vendor/nanoclaw-adapter-types');
  });

  it('does not copy test files into the host', () => {
    runInstall(hostDir);
    const testFile = join(hostDir, 'src', 'channels', 'onebot-napcat', 'admin-cmds.test.ts');
    expect(existsSync(testFile)).toBe(false);
  });

  it('adds ws and @types/ws dependencies to the host', () => {
    runInstall(hostDir);
    const pkg = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies.ws).toBe('^8.18.2');
    expect(pkg.devDependencies['@types/ws']).toBe('^8.18.1');
  });

  it('removes the vendored type declaration directory', () => {
    runInstall(hostDir);
    const vendorDir = join(hostDir, 'src', 'channels', 'onebot-napcat', 'vendor');
    expect(existsSync(vendorDir)).toBe(false);
  });

  it('wires the channel barrel idempotently', () => {
    runInstall(hostDir);
    const barrelPath = join(hostDir, 'src', 'channels', 'index.ts');
    const content = readFileSync(barrelPath, 'utf-8');
    expect(content).toContain("import './onebot-napcat/onebot-napcat.js';");
    expect(content.split("import './onebot-napcat/onebot-napcat.js';").length - 1).toBe(1);
  });

  it('seeds .env with Napcat variables while preserving existing values', () => {
    runInstall(hostDir);
    const envContent = readFileSync(join(hostDir, '.env'), 'utf-8');
    expect(envContent).toContain('EXISTING_VAR=1');
    expect(envContent).toContain('NAPCAT_WS_URL=');
    expect(envContent).toContain('NAPCAT_ADMINS=');
  });

  it('is idempotent on a second run', () => {
    runInstall(hostDir);
    const second = runInstall(hostDir);
    expect(second.status).toBe(0);

    const barrelPath = join(hostDir, 'src', 'channels', 'index.ts');
    const content = readFileSync(barrelPath, 'utf-8');
    expect(content.split("import './onebot-napcat/onebot-napcat.js';").length - 1).toBe(1);
  });
});

describe('remove-onebot-napcat', () => {
  let hostDir: string;

  beforeEach(() => {
    hostDir = createFakeHost();
    runInstall(hostDir);
  });

  afterEach(() => {
    runRemove(hostDir);
  });

  it('removes the adapter directory and barrel import', () => {
    const result = runRemove(hostDir);
    expect(result.status).toBe(0);

    const adapterDir = join(hostDir, 'src', 'channels', 'onebot-napcat');
    expect(existsSync(adapterDir)).toBe(false);

    const barrelPath = join(hostDir, 'src', 'channels', 'index.ts');
    const content = readFileSync(barrelPath, 'utf-8');
    expect(content).not.toContain("import './onebot-napcat/onebot-napcat.js';");
    expect(content).toContain("import './cli.js';");
  });

  it('removes the ws dependency', () => {
    runRemove(hostDir);
    const pkg = JSON.parse(readFileSync(join(hostDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.ws).toBeUndefined();
  });
});
