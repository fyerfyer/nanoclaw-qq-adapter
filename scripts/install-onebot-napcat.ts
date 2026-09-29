#!/usr/bin/env node
/**
 * Installer for the NanoClaw OneBot Napcat adapter.
 *
 * Copies this repository's `src/` into a NanoClaw host under
 * `src/channels/onebot-napcat/`, rewrites the vendored type imports to point at
 * the host's real adapter interface, wires the channel barrel, installs the
 * `ws` dependency, seeds `.env`, and builds the host.
 *
 * Existing adapter files are never replaced unless --force is explicit.
 * Usage:
 *   tsx scripts/install-onebot-napcat.ts [--host-dir <path>] [--force]
 *
 * Defaults to the current working directory as the NanoClaw host root.
 */

import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const WS_VERSION = '^8.18.2';
const WS_TYPES_VERSION = '^8.18.1';

const ENV_VARS = [
  'NAPCAT_WS_URL=ws://127.0.0.1:3001',
  'NAPCAT_ACCESS_TOKEN=',
  'NAPCAT_SELF_ID=',
  'NAPCAT_ALLOWED_USERS=',
  'NAPCAT_ALLOWED_GROUPS=',
  'NAPCAT_BLOCKED_USERS=',
  'NAPCAT_BLOCKED_GROUPS=',
  'NAPCAT_ADMINS=',
  'NAPCAT_REQUIRE_AT_IN_GROUP=true',
  'NAPCAT_MAX_TEXT_LENGTH=4500',
  'NAPCAT_WELCOME_MSG=',
  'NAPCAT_GOODBYE_MSG=',
];

interface RunOptions {
  hostDir: string;
  skipPnpm: boolean;
  force: boolean;
}

function main(): void {
  const options = parseArgs();
  const hostDir = resolve(options.hostDir);
  const repoRoot = getRepoRoot();

  log('info', `Installing OneBot Napcat adapter into ${hostDir}`);

  validateHost(hostDir);

  const sourceDir = join(repoRoot, 'src');
  const targetDir = join(hostDir, 'src', 'channels', 'onebot-napcat');

  const copied = copySource(sourceDir, targetDir, options.force);
  if (copied) {
    rewriteTypeImports(targetDir);
    removeVendorTypes(targetDir);
  }
  wireBarrel(hostDir);
  ensureDependencies(hostDir);
  seedEnv(hostDir);

  if (!options.skipPnpm) {
    runPnpm(hostDir, 'install');
    runPnpm(hostDir, 'run', 'build');
  } else {
    log('info', 'Skipping pnpm install/build (--skip-pnpm)');
  }

  log('info', 'Installation complete.');
  log(
    'info',
    'Next steps: configure NAPCAT_WS_URL (and token if required), start NanoClaw, then initialize an owner and wire QQ conversations to an agent using NanoClaw setup/manage-channels.',
  );
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  let hostDir = process.cwd();
  let skipPnpm = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host-dir' || args[i] === '-h') {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${args[i]}`);
      }
      hostDir = value;
      i++;
    } else if (args[i] === '--skip-pnpm') {
      skipPnpm = true;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--help') {
      console.log(
        'Usage: tsx scripts/install-onebot-napcat.ts [--host-dir <path>] [--skip-pnpm] [--force]',
      );
      process.exit(0);
    }
  }

  return { hostDir, skipPnpm, force };
}

function getRepoRoot(): string {
  const scriptPath = fileURLToPath(import.meta.url);
  return dirname(dirname(scriptPath));
}

function validateHost(hostDir: string): void {
  const required = [
    join(hostDir, 'package.json'),
    join(hostDir, 'src', 'channels', 'index.ts'),
  ];

  for (const file of required) {
    if (!existsSync(file)) {
      throw new Error(
        `Host directory does not look like a NanoClaw checkout (missing ${file}).`,
      );
    }
  }
}

function copySource(sourceDir: string, targetDir: string, force: boolean): boolean {
  log('info', `Copying ${sourceDir} -> ${targetDir}`);
  if (existsSync(targetDir)) {
    if (!force) {
      log(
        'warn',
        `Adapter directory already exists; preserving it. Use --force to replace it with this repository version.`,
      );
      return false;
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  // Test files reference repo-local fixtures; the host only needs runtime code.
  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => !src.endsWith('.test.ts'),
  });
  return true;
}

function rewriteTypeImports(targetDir: string): void {
  const files = listTsFiles(targetDir);
  let rewritten = 0;

  for (const file of files) {
    const original = readFileSync(file, 'utf-8');
    const updated = original
      // Top-level module (./vendor/… → host src/channels/…)
      .replace(
        /from\s+['"]\.\/vendor\/nanoclaw-adapter-types\.js['"]/g,
        "from '../adapter.js'",
      )
      .replace(
        /from\s+['"]\.\/vendor\/channel-registry\.js['"]/g,
        "from '../channel-registry.js'",
      )
      // Nested modules (../vendor/… → up two levels to src/channels/…)
      .replace(
        /from\s+['"]\.\.\/vendor\/nanoclaw-adapter-types\.js['"]/g,
        "from '../../adapter.js'",
      )
      .replace(
        /from\s+['"]\.\.\/vendor\/channel-registry\.js['"]/g,
        "from '../../channel-registry.js'",
      );

    if (updated !== original) {
      writeFileSync(file, updated, 'utf-8');
      rewritten++;
    }
  }

  log('info', `Rewrote vendored imports in ${rewritten} file(s)`);
}

function removeVendorTypes(targetDir: string): void {
  const vendorDir = join(targetDir, 'vendor');
  if (existsSync(vendorDir)) {
    rmSync(vendorDir, { recursive: true, force: true });
    log('info', 'Removed vendored adapter types from host copy');
  }
}

function wireBarrel(hostDir: string): void {
  const barrelPath = join(hostDir, 'src', 'channels', 'index.ts');
  const importLine = "import './onebot-napcat/onebot-napcat.js';";
  const content = readFileSync(barrelPath, 'utf-8');

  if (content.includes(importLine)) {
    log('info', 'Channel barrel already wired');
    return;
  }

  const newline = content.endsWith('\n') ? '' : '\n';
  writeFileSync(barrelPath, `${content}${newline}${importLine}\n`, 'utf-8');
  log('info', 'Wired channel barrel');
}

function ensureDependencies(hostDir: string): void {
  const packagePath = join(hostDir, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  let changed = false;

  if (!pkg.dependencies?.ws) {
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies.ws = WS_VERSION;
    changed = true;
    log('info', `Added ws@${WS_VERSION} to host dependencies`);
  }

  if (!pkg.devDependencies?.['@types/ws']) {
    pkg.devDependencies = pkg.devDependencies ?? {};
    pkg.devDependencies['@types/ws'] = WS_TYPES_VERSION;
    changed = true;
    log('info', `Added @types/ws@${WS_TYPES_VERSION} to host devDependencies`);
  }

  if (changed) {
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  } else {
    log('info', 'Host already has ws dependencies; skipping');
  }
}

function seedEnv(hostDir: string): void {
  const envPath = join(hostDir, '.env');

  if (!existsSync(envPath)) {
    writeFileSync(envPath, '', 'utf-8');
    log('info', 'Created empty .env');
  }

  const content = readFileSync(envPath, 'utf-8');

  const present = new Set(
    content
      .split(/\r?\n/)
      .map((line) => /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.trim())?.[1])
      .filter((key): key is string => Boolean(key)),
  );
  const missing = ENV_VARS.filter((line) => {
    const match = /^(NAPCAT_[A-Z0-9_]+)=/.exec(line);
    return Boolean(match && !present.has(match[1]));
  });
  if (missing.length === 0) {
    log('info', '.env already contains all Napcat variables; preserving existing values');
    return;
  }

  const newline = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  writeFileSync(
    envPath,
    `${content}${newline}\n# NanoClaw OneBot Napcat adapter settings\n${missing.join('\n')}\n`,
    'utf-8',
  );
  log('info', `Added ${missing.length} missing Napcat setting(s) to .env; existing values were preserved`);
}

function runPnpm(hostDir: string, ...args: string[]): void {
  log('info', `Running: pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, {
    cwd: hostDir,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function listTsFiles(dir: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      result.push(...listTsFiles(fullPath));
    } else if (stats.isFile() && entry.endsWith('.ts')) {
      result.push(fullPath);
    }
  }

  return result;
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const prefix = '[install-onebot-napcat]';
  if (level === 'error') {
    console.error(prefix, message);
  } else if (level === 'warn') {
    console.warn(prefix, message);
  } else {
    console.info(prefix, message);
  }
}

main();
