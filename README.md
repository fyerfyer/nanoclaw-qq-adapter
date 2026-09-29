# NanoClaw OneBot Napcat v11 QQ Adapter

A NanoClaw v2 channel adapter that connects to [NapCat](https://github.com/NapNeko/NapCat) through the OneBot v11 protocol, enabling QQ private and group chat integration.

This repository is an installable NanoClaw channel adapter, not a standalone Agent runtime or QQ gateway. NanoClaw owns routing, sessions, permissions, agent groups and delivery scheduling; this project owns the OneBot transport and QQ message conversion. A truly standalone gateway would need a separate host protocol and runtime.

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
3. The skill will copy the adapter source into `src/channels/onebot-napcat/`, wire the channel barrel, install the `ws` dependency, seed missing `.env` keys, and build the host.
4. Fill in `.env` (see Configuration below), start NapCat and NanoClaw, then run NanoClaw's `/init-first-agent` and `/manage-channels` flow to create owner/wiring rows.

### Manual install

If you prefer not to use the skill, run the installer script from this repository:

```bash
tsx scripts/install-onebot-napcat.ts --host-dir /path/to/nanoclaw
```

To remove the adapter later, see [REMOVE.md](./REMOVE.md).

## Adapter development

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
| `NAPCAT_SELF_ID` | No | Optional bot QQ number; if empty, the adapter uses OneBot `get_login_info` |
| `NAPCAT_ALLOWED_USERS` | No | Comma-separated QQ numbers allowed in private chat |
| `NAPCAT_ALLOWED_GROUPS` | No | Comma-separated group IDs allowed |
| `NAPCAT_BLOCKED_USERS` | No | Comma-separated QQ numbers to block |
| `NAPCAT_BLOCKED_GROUPS` | No | Comma-separated group IDs to block |
| `NAPCAT_ADMINS` | No | Comma-separated QQ numbers authorized for Adapter-local admin commands |
| `NAPCAT_REQUIRE_AT_IN_GROUP` | No | Default `true`; treat group messages as mentions only when `@bot` |
| `NAPCAT_MAX_TEXT_LENGTH` | No | Default `4500`; outgoing text longer than this is split |
| `NAPCAT_WELCOME_MSG` | No | Welcome message sent when a user joins a group; `{user_id}` is replaced |
| `NAPCAT_GOODBYE_MSG` | No | Goodbye message sent when a user leaves a group; `{user_id}` is replaced |

## Access control

- If `NAPCAT_ALLOWED_USERS` or `NAPCAT_ALLOWED_GROUPS` is set, messages from IDs not in the list are silently dropped.
- IDs in `NAPCAT_BLOCKED_USERS` or `NAPCAT_BLOCKED_GROUPS` are always rejected, even if they also appear in an allowlist.
- Admin commands bypass normal access control so admins can manage the bot even from a blocked context.
- These settings are only the Adapter layer. NanoClaw owner/admin/member roles, `unknown_sender_policy`, and which QQ conversations reach an Agent are configured in NanoClaw's database wirings.

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
docker compose up -d napcat-bot

# View logs / QR code for login
docker logs -f napcat-bot
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

| Container | Account variable | Role | OneBot HTTP | OneBot WS | WebUI |
|---|---|---|---|---|---|
| `napcat-bot` | `NAPCAT_BOT_ACCOUNT` | NanoClaw Bot | `NAPCAT_BOT_HTTP_PORT` | `NAPCAT_BOT_WS_PORT` | `NAPCAT_BOT_WEBUI_PORT` |
| `napcat-user-a` | `NAPCAT_USER_A_ACCOUNT` | Optional test user A | `NAPCAT_USER_A_HTTP_PORT` | `NAPCAT_USER_A_WS_PORT` | `NAPCAT_USER_A_WEBUI_PORT` |
| `napcat-user-b` | `NAPCAT_USER_B_ACCOUNT` | Optional test user B | `NAPCAT_USER_B_HTTP_PORT` | `NAPCAT_USER_B_WS_PORT` | `NAPCAT_USER_B_WEBUI_PORT` |

Each container mounts its **own** config directory (`napcat-config-test/bot`,
`napcat-config-test/user-a`, `napcat-config-test/user-b`) so the per-account
OneBot configs never clobber each other. These directories are gitignored —
populate them the same way as `napcat-config/` (per-account
`onebot11_<qq>.json` with the ports above, plus `napcat.json` and
`webui.json`), or configure each instance through its WebUI on first run.

Set the account variables and `NAPCAT_TEST_GROUP_ID` in your private `.env`; the repository intentionally ships placeholders rather than real QQ IDs.

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

## NanoClaw Integration Model

The adapter is designed to be installed into a NanoClaw v2 fork under `src/channels/onebot-napcat/`. The `/add-onebot-napcat` skill or installer handles source registration; it does not create users, agents or database wirings:

1. Install the Adapter and configure the NapCat forward WebSocket URL/token.
2. Start NanoClaw and NapCat; verify the Adapter registration and OneBot login.
3. Run NanoClaw `/init-first-agent` once to create the first agent group and owner DM wiring.
4. Use `/manage-channels`, `ncl messaging-groups`, and `ncl wirings` to add QQ DMs/groups and bind them to an agent group. For multiple people, add each person's DM wiring or set the group's `unknown_sender_policy`; do not add them to Adapter source code.
5. Test one DM, then a group mention. A message received by the Adapter but lacking a matching NanoClaw wiring is expected to be dropped by the host.

The adapter self-registers on import via `registerChannelAdapter('onebot-napcat', …)`; the factory returns `null` when `NAPCAT_WS_URL` is unset so the host skips the channel gracefully.

For uninstall, the script removes only the Adapter copy and barrel registration. It preserves `.env`, NanoClaw database rows, and shared `ws` dependencies so another channel is not accidentally broken.

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
