---
name: qq-bot-debug
description: |
  NanoClaw OneBot Napcat QQ Adapter 的 QQ 端调试与 E2E 验证流程。
  Use when:
  (1) 用户修改了 NanoClaw QQ Adapter 代码，需要验证私聊/群聊功能是否正常；
  (2) 需要通过真实 QQ 账号对 Adapter 进行端到端测试；
  (3) 需要排查 Adapter 收不到消息、回复失败、@识别异常、MCP 超时等问题；
  (4) 需要让 Agent 自动通过 QQ 发送测试消息并观察 Bot 响应。
license: MIT
metadata:
  author: Kimi Code CLI
  version: "1.1.0"
---

# NanoClaw QQ Adapter 调试 Skill

本 Skill 指导 Agent 在本地通过真实 QQ 账号测试 NanoClaw OneBot Napcat Adapter 的私聊与群聊功能，替代手动在 QQ 里发消息。

## 核心原则：先跑 debug 脚本

真实 QQ 测试很容易因为**账号离线、端口冲突、旧进程残留、好友关系变化**而失败。**不要直接用 MCP 或 curl 发消息，先运行预检查脚本：**

```bash
scripts/qq-debug.sh
```

该脚本会按顺序检查：

1. 三个 NapCat 容器是否都在运行
2. OneBot HTTP/WS 端口是否都在监听
3. 三个 QQ 账号是否都在线（通过 `get_login_info`）
4. 清理残留的旧 `manual-e2e` / `qq-health-check` 进程
5. 启动新的 `pnpm e2e:health`
6. 从 2101197401 发一条私聊 ping 和一条群聊 @ping，验证是否收到 `Echo:`

如果脚本输出 `[ERROR]`，按提示处理（通常是重新登录离线的 QQ），然后再跑一次。

## 测试环境架构

项目已配置三账号 NapCat 测试栈（`docker-compose.test.yml`）：

| 容器 | QQ | 角色 | OneBot HTTP | OneBot WS | WebUI |
|---|---|---|---|---|---|
| `napcat-bot` | 3384461856 | NanoClaw Bot（Adapter 连接此账号） | 3100 | 3001 | 6099 |
| `napcat-user-a` | 2157875424 | 备用测试机器人 | 3000 | 3002 | 6100 |
| `napcat-user-b` | 2101197401 | **Kimi Code MCP 操作的主测试号** | 3003 | 3004 | 6101 |

测试群：`922216566`（三个机器人都应在群内）。

Access token（三个 NapCat 实例一致）：`nanoclaw-test-token`

Adapter 配置（`.env`）：
- `NAPCAT_WS_URL=ws://127.0.0.1:3001`
- `NAPCAT_SELF_ID=3384461856`
- `NAPCAT_ACCESS_TOKEN=nanoclaw-test-token`

MCP 工具：`qq-agent` 已注册在 `~/.kimi-code/mcp.json`，指向 `2101197401`，监听群 `922216566` 和好友 `3384461856`。

## 标准调试流程

### 1. 启动/检查 NapCat 测试栈

```bash
docker compose -f docker-compose.test.yml up -d
docker compose -f docker-compose.test.yml ps
```

首次启动或账号被踢下线后，需要手动扫码登录：
- Bot：`http://127.0.0.1:6099/webui`
- User-A：`http://127.0.0.1:6100/webui`
- User-B（MCP 操作）：`http://127.0.0.1:6101/webui`

### 2. 运行 debug 预检查

```bash
scripts/qq-debug.sh
```

**期望输出：**

```
[INFO] NanoClaw QQ debug check started.
[INFO] All containers are running.
[INFO] All OneBot ports are listening.
[INFO] Account 3384461856 is online.
[INFO] Account 2157875424 is online.
[INFO] Account 2101197401 is online.
[INFO] Cleanup done.
[INFO] Health-check adapter connected.
[INFO] Private echo received.
[INFO] Group echo received.
[INFO] All checks passed.
```

如果脚本检测到账号离线，会打印每个账号对应的 WebUI URL，提示你扫码登录，然后按回车继续。脚本会重新检查，直到所有账号都在线后才进入后续测试。

### 3. 用 MCP 发送功能测试消息

debug 脚本通过后，调用 `qq-agent` MCP 工具驱动测试机器人 `2101197401`：

**私聊测试：**

```
使用 qq-agent 的 send_message 工具，给私聊好友 3384461856 发送消息 "ping"，然后检查 Adapter 是否收到并回复了 "Echo: ping"。
```

对应参数：
- `target`: `3384461856`
- `target_type`: `private`
- `content`: `ping`

**群聊 @测试：**

```
使用 qq-agent 的 send_message 工具，在群 922216566 中 @3384461856 发送消息 "ping"，然后检查是否收到 "Echo: ping"。
```

对应参数：
- `target`: `922216566`
- `target_type`: `group`
- `content`: `@3384461856 ping`

**真实 NanoClaw 功能测试：**

health check / echo 只验证通路。要验证 NanoClaw 的 actual 功能，需要先启动真实的 NanoClaw host（包含这个 Adapter），然后通过 MCP 发送触发指令，观察 host 响应：

```
启动 NanoClaw host 和这个 Adapter，然后用 qq-agent 在群里 @Bot 发送 "帮我总结一下今天的消息"，检查 Bot 是否按预期回复。
```

**读取最近上下文验证：**

```
使用 qq-agent 的 get_recent_context 工具查看群 922216566 或私聊 3384461856 的最近消息，确认 Bot 已回复。
```

### 4. 不使用 MCP 时的兜底方案

如果 MCP 未生效，可直接 curl OneBot HTTP API：

**私聊：**

```bash
curl -s -X POST http://127.0.0.1:3003/send_private_msg \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer nanoclaw-test-token" \
  -d '{"user_id":3384461856,"message":[{"type":"text","data":{"text":"ping"}}]}'
```

**群聊：**

```bash
curl -s -X POST http://127.0.0.1:3003/send_group_msg \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer nanoclaw-test-token" \
  -d '{"group_id":922216566,"message":[{"type":"at","data":{"qq":3384461856}},{"type":"text","data":{"text":" ping"}}]}'
```

## 失败处理速查

### MCP server "qq-agent" timed out

1. 先跑 `scripts/qq-debug.sh`
2. 如果显示账号离线，重新登录对应 QQ
3. 检查 `~/.kimi-code/mcp.json` 中 `qq-agent` 配置是否存在
4. 手动测试 MCP server：
   ```bash
   cd ~/tools/Amadeus-QQ-MCP && uv run qq-agent-mcp --qq 2101197401 --napcat-port 3003 --ws-port 3004 --groups 922216566 --friends 3384461856
   ```

### curl 发送消息 Timeout / 发送失败

- 跑 `scripts/qq-debug.sh` 确认账号在线
- 确认 `2101197401` 和 `3384461856` 是 QQ 好友
- 确认三个机器人都已加入群 `922216566`
- 如果账号刚被踢下线，必须重新扫码登录

### 群聊消息 isMention 为 false

- 确认消息中确实 `@3384461856`
- 检查 `.env` 中 `NAPCAT_REQUIRE_AT_IN_GROUP=true`
- 确认 `NAPCAT_SELF_ID=3384461856` 正确

### Adapter 无法连接 WS

- 检查 `.env` 中 `NAPCAT_ACCESS_TOKEN=nanoclaw-test-token`
- 检查 `napcat-bot` 是否已启动且 WS 3001 正常：`docker logs napcat-bot | grep -i "WebSocket Server"`

## 调试后清理

```bash
# 停止测试栈
docker compose -f docker-compose.test.yml down

# 停止后台运行的 health check
pkill -f "scripts/qq-health-check.ts"
rm -f /tmp/nanoclaw-health.log /tmp/nanoclaw-health.pid
```
