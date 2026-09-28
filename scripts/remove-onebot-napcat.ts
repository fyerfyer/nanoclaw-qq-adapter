#!/usr/bin/env node
/**
 * Removes the OneBot Napcat adapter from a NanoClaw host.
 *
 * Usage:
 *   tsx scripts/remove-onebot-napcat.ts [--host-dir <path>]
 *
 * Defaults to the current working directory as the NanoClaw host root.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface RunOptions {
  hostDir: string;
  skipPnpm: boolean;
}

function main(): void {
  const options = parseArgs();
  const hostDir = resolve(options.hostDir);

  log('info', `Removing OneBot Napcat adapter from ${hostDir}`);

  validateHost(hostDir);
  removeAdapterDirectory(hostDir);
  unwireBarrel(hostDir);
  removeDependency(hostDir);

  if (!options.skipPnpm) {
    runPnpm(hostDir, 'install');
  } else {
    log('info', 'Skipping pnpm install (--skip-pnpm)');
  }

  log('info', 'Removal complete.');
  log(
    'warn',
    'Napcat environment variables in .env were not modified; remove them manually if desired.',
  );
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  let hostDir = process.cwd();
  let skipPnpm = false;

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
    } else if (args[i] === '--help') {
      console.log(
        'Usage: tsx scripts/remove-onebot-napcat.ts [--host-dir <path>] [--skip-pnpm]',
      );
      process.exit(0);
    }
  }

  return { hostDir, skipPnpm };
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

function removeAdapterDirectory(hostDir: string): void {
  const adapterDir = join(hostDir, 'src', 'channels', 'onebot-napcat');
  if (!existsSync(adapterDir)) {
    log('warn', `Adapter directory not found: ${adapterDir}`);
    return;
  }

  rmSync(adapterDir, { recursive: true, force: true });
  log('info', `Removed ${adapterDir}`);
}

function unwireBarrel(hostDir: string): void {
  const barrelPath = join(hostDir, 'src', 'channels', 'index.ts');
  const content = readFileSync(barrelPath, 'utf-8');
  const importLine = "import './onebot-napcat/onebot-napcat.js';";

  if (!content.includes(importLine)) {
    log('info', 'Channel barrel did not reference onebot-napcat');
    return;
  }

  const lines = content.split('\n');
  const filtered = lines.filter((line) => line.trim() !== importLine);
  writeFileSync(barrelPath, filtered.join('\n'), 'utf-8');
  log('info', 'Removed onebot-napcat from channel barrel');
}

function removeDependency(hostDir: string): void {
  const packagePath = join(hostDir, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  let changed = false;

  if (pkg.dependencies?.ws) {
    delete pkg.dependencies.ws;
    changed = true;
  }
  if (pkg.devDependencies?.['@types/ws']) {
    delete pkg.devDependencies['@types/ws'];
    changed = true;
  }

  if (!changed) {
    log('info', 'Host does not depend on ws; skipping dependency update');
    return;
  }

  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  log(
    'warn',
    'Removed ws and @types/ws from host package.json. If other channels rely on ws, re-add them manually.',
  );
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

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const prefix = '[remove-onebot-napcat]';
  if (level === 'error') {
    console.error(prefix, message);
  } else if (level === 'warn') {
    console.warn(prefix, message);
  } else {
    console.info(prefix, message);
  }
}

main();
