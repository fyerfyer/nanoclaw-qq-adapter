# NanoClaw OneBot Napcat v11 QQ Adapter

A NanoClaw v2 channel adapter that connects to [NapCat](https://github.com/NapNeko/NapCat) through the OneBot v11 protocol, enabling QQ private and group chat integration.

This repository covers **all five implementation phases**: protocol connection, inbound/outbound messaging, rich media and `@` mentions, access control with group management, and skill packaging with tests.

## Features

- Forward WebSocket connection to NapCat with auto-reconnect and heartbeat monitoring
- Private and group text messaging
- Image, voice, file, reply and `@` mention support
- Allowlist / blocklist per user and group
- Admin commands: `/status`, `/mute`, `/kick`, `/allow`, `/block`
- Group welcome / goodbye notices
- Packaged as a NanoClaw skill (`/add-onebot-napcat`)

## Prerequisites

- Node.js >= 22
- pnpm 10+
- (Optional) Docker & Docker Compose for running NapCat locally

## Install as a NanoClaw skill

The recommended way to use this adapter is to install it into a NanoClaw v2 fork with the `/add-onebot-napcat` skill.

1. Open your NanoClaw host checkout.
2. Run `/add-onebot-napcat` in Claude Code (or invoke the skill directly).
3. The skill will copy the adapter source into `src/channels/onebot-napcat/`, wire the channel barrel, install the `ws` dependency, seed `.env`, and build the host.
4. Fill in `.env` (see Configuration below) and restart NanoClaw.

### Manual install

If you prefer not to use the skill, run the installer script from this repository:

```bash
tsx scripts/install-onebot-napcat.ts --host-dir /path/to/nanoclaw
```

To remove the adapter later, see [REMOVE.md](./REMOVE.md).

## Standalone development

```bash
pnpm install
```

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NAPCAT_WS_URL` | Yes | NapCat forward WebSocket URL, e.g. `ws://127.0.0.1:3001` |
| `NAPCAT_ACCESS_TOKEN` | No | Access token if NapCat WS server requires auth |
| `NAPCAT_SELF_ID` | No | Bot QQ number; used to filter self-messages and detect `@` mentions |
| `NAPCAT_ALLOWED_USERS` | No | Comma-separated QQ numbers allowed in private chat |
| `NAPCAT_ALLOWED_GROUPS` | No | Comma-separated group IDs allowed |
| `NAPCAT_BLOCKED_USERS` | No | Comma-separated QQ numbers to block |
| `NAPCAT_BLOCKED_GROUPS` | No | Comma-separated group IDs to block |
| `NAPCAT_ADMINS` | No | Comma-separated admin QQ numbers |
| `NAPCAT_REQUIRE_AT_IN_GROUP` | No | Default `true`; treat group messages as mentions only when `@bot` |
| `NAPCAT_MAX_TEXT_LENGTH` | No | Default `4500`; outgoing text longer than this is split |
| `NAPCAT_WELCOME_MSG` | No | Welcome message sent when a user joins a group; `{user_id}` is replaced |
| `NAPCAT_GOODBYE_MSG` | No | Goodbye message sent when a user leaves a group; `{user_id}` is replaced |

## Access control

- If `NAPCAT_ALLOWED_USERS` or `NAPCAT_ALLOWED_GROUPS` is set, messages from IDs not in the list are silently dropped.
- IDs in `NAPCAT_BLOCKED_USERS` or `NAPCAT_BLOCKED_GROUPS` are always rejected, even if they also appear in an allowlist.
- Admin commands bypass normal access control so admins can manage the bot even from a blocked context.

## Admin commands

Any QQ number in `NAPCAT_ADMINS` can send the following commands in private chat or in a group:

| Command | Description |
|---------|-------------|
| `/status` | Show OneBot connection status and login info |
| `/mute <qq> [seconds]` | Mute a group member for the given duration (default 600s, 0 to unmute). In private chat, use `/mute <group> <qq> [seconds]`. |
| `/kick <qq>` | Remove a group member. In private chat, use `/kick <group> <qq>`. |
| `/allow user <qq>` | Add a user to the allowlist and remove from blocklist |
| `/allow group <group>` | Add a group to the allowlist and remove from blocklist |
| `/block user <qq>` | Add a user to the blocklist and remove from allowlist |
| `/block group <group>` | Add a group to the blocklist and remove from allowlist |

## Group notifications

When `NAPCAT_WELCOME_MSG` or `NAPCAT_GOODBYE_MSG` is set, the adapter sends the message to the group on `group_increase` / `group_decrease` events. Use `{user_id}` as a placeholder for the affected user's QQ number.

## Run NapCat with Docker Compose

A real NapCat container is provided so the adapter can be tested against live infrastructure instead of mocks.

```bash
# Create a directory for NapCat configuration (ignored by git)
mkdir -p napcat-config

# Start NapCat
docker compose up -d napcat

# View logs / QR code for login
docker logs -f napcat
```

After the container starts:

1. Open the NapCat WebUI at `http://127.0.0.1:6099/webui`.
2. Complete QQ login (scan QR code or use configured account).
3. Enable the **OneBot v11 forward WebSocket server** on port `3001`.
4. Set `messagePostFormat` to `array`.
5. (Optional) Set an access token and put the same value in `.env`.

## Multi-account test stack

For end-to-end testing with multiple QQ accounts, use `docker-compose.test.yml`:

```bash
docker compose -f docker-compose.test.yml up -d
```

It starts three NapCat instances:

| Container | QQ | Role | OneBot HTTP | OneBot WS | WebUI |
|---|---|---|---|---|---|
| `napcat-bot` | `3384461856` | NanoClaw Bot | 3100 | 3001 | 6099 |
| `napcat-user-a` | `2157875424` | Test robot A | 3000 | 3002 | 6100 |
| `napcat-user-b` | `2101197401` | Test robot B | 3003 | 3004 | 6101 |

Edit `.env.example` / `.env` to match the ports and accounts you use.

## QQ Health Check

```bash
pnpm e2e:health
```

This runs `scripts/qq-health-check.ts`, which connects to the configured NapCat instance and echoes every received private/group text back to the sender. Use it only to verify that the WS/HTTP plumbing is alive — it does not exercise real NanoClaw behavior.

## Feature verification

```bash
pnpm e2e:verify
```

Runs `scripts/verify-features.ts` against the real test stack to exercise text, `@` mentions, reply segments, image attachments, and admin commands.

## Automated Tests

```bash
pnpm test
```

The automated test suite uses a mock OneBot WebSocket server so it can run in CI without a real QQ account. It covers:

- WebSocket connection, API calls, and `echo` mapping
- Exponential-backoff reconnect after disconnect
- Heartbeat timeout detection and reconnect
- Conversion of private/group messages to NanoClaw `InboundMessage`
- Outbound text delivery via `send_private_msg` / `send_group_msg`
- Full inbound/outbound roundtrip through a minimal NanoClaw host fixture
- Allowlist / blocklist decisions
- Admin command parsing and OneBot API calls
- Group welcome / goodbye notices

## Lint & Type Check

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Integrating into NanoClaw Host

This repository is designed to be installed into a NanoClaw v2 fork under `src/channels/onebot-napcat/`. The recommended way is the `/add-onebot-napcat` skill (see above). For manual integration:

1. Copy `src/` into `src/channels/onebot-napcat/`.
2. Replace the vendored type imports (`src/vendor/nanoclaw-adapter-types.js`) with imports from `../adapter.js`.
3. Register the adapter in the host's channel registry:

```ts
import { createOneBotNapCatAdapter } from './channels/onebot-napcat/onebot-napcat.js';

registerChannel(createOneBotNapCatAdapter());
```

## Project Structure

```
.
├── src
│   ├── onebot-napcat.ts           # ChannelAdapter factory + main implementation
│   ├── config.ts                  # Environment variable parsing
│   ├── client
│   │   ├── onebot-ws-client.ts    # Forward WS client with echo + heartbeat + reconnect
│   │   └── onebot-ws-client.test.ts
│   ├── inbound
│   │   ├── event-to-inbound.ts    # OneBot events → NanoClaw InboundMessage
│   │   ├── event-to-inbound.test.ts
│   │   └── notices.ts             # Group increase/decrease notifications
│   ├── outbound
│   │   ├── deliver.ts             # OutboundMessage → send_private_msg / send_group_msg
│   │   └── deliver.test.ts
│   ├── protocol
│   │   ├── onebot-v11.ts          # OneBot v11 types and guards
│   │   └── media.ts               # Media download / base64 segment helpers
│   ├── allowlist.ts               # Allowlist / blocklist checks
│   ├── allowlist.test.ts
│   ├── admin-cmds.ts              # Admin command parser and executor
│   ├── admin-cmds.test.ts
│   └── vendor
│       └── nanoclaw-adapter-types.ts  # Vendored NanoClaw adapter interfaces
├── test
│   ├── fixtures
│   │   ├── mock-onebot-server.ts  # WS server mock for tests
│   │   └── minimal-host.ts        # Minimal NanoClaw host harness
│   └── e2e
│       └── text-roundtrip.test.ts # Inbound/outbound roundtrip tests
├── scripts
│   ├── qq-health-check.ts         # Real NapCat echo harness
│   ├── verify-features.ts         # Phase 3/4 feature verification
│   ├── install-onebot-napcat.ts   # Install adapter into NanoClaw host
│   └── remove-onebot-napcat.ts    # Remove adapter from NanoClaw host
├── .agents
│   └── skills
│       ├── add-onebot-napcat
│       │   └── SKILL.md           # NanoClaw /add-onebot-napcat skill
│       └── qq-bot-debug
│           └── SKILL.md           # Real QQ E2E debug skill
├── docker-compose.yml             # Single NapCat container
├── docker-compose.test.yml        # Multi-account NapCat test stack
├── .env.example
├── package.json
├── tsconfig.json
├── REMOVE.md                      # Uninstall instructions
└── vitest.config.ts
```

## License

MIT
