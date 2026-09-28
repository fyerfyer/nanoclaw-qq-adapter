/**
 * Vendored shim of NanoClaw's `src/channels/channel-registry.ts`.
 *
 * Exists only for local development and unit tests in this repository. When
 * this adapter is copied into a NanoClaw host under
 * `src/channels/onebot-napcat/`, the import of this module is rewritten to
 * the host's real `../channel-registry.js` (see
 * scripts/install-onebot-napcat.ts).
 */

import type { ChannelRegistration } from './nanoclaw-adapter-types.js';

const localRegistry = new Map<string, ChannelRegistration>();

/** Standalone no-op-compatible registration; the host version starts the adapter. */
export function registerChannelAdapter(
  name: string,
  registration: ChannelRegistration,
): void {
  localRegistry.set(name, registration);
}

/** Test helper: read a registration recorded by the local shim. */
export function getRegisteredChannelAdapter(
  name: string,
): ChannelRegistration | undefined {
  return localRegistry.get(name);
}
