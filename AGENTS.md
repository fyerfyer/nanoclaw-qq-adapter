# nanoclaw-onebot-napcat

NanoClaw v2 的 QQ channel adapter（OneBot v11 协议 + NapCat）。本仓库不是独立机器人——它实现 NanoClaw 的 `ChannelAdapter` 契约，安装时复制源码进 NanoClaw host 的 `src/channels/onebot-napcat/`。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `src/onebot-napcat.ts` | Adapter 主实现（`ChannelAdapter` + factory + 模块底部自注册） |
| `src/config.ts` | `NAPCAT_*` 环境变量加载（显式 env 优先，其次 `.env` 文件） |
| `src/client/` | OneBot 正向 WebSocket 客户端（echo 映射、心跳超时、指数退避重连） |
| `src/protocol/` | OneBot v11 类型（假定 `messagePostFormat: array`）与媒体下载/编码 |
| `src/inbound/` `src/outbound/` | 事件→`InboundMessage` 转换；`OutboundMessage`→OneBot 发送（长文本拆分） |
| `src/allowlist.ts` `src/admin-cmds.ts` | 黑白名单；`/status` `/mute` `/kick` `/allow` `/block`（Adapter 层拦截，不进 host） |
| `src/vendor/` | 从 NanoClaw host vendored 的类型/注册表 shim，仅供本地开发与单测；安装进 host 时被重写为 `../adapter.js` / `../channel-registry.js` 并删除 |
| `scripts/install-onebot-napcat.ts` | 安装器：复制 src → host、重写 import、追加 barrel import、补 `ws` 依赖、播种 `.env` |
| `scripts/napcat-watchdog.sh` | QQ 掉线看门狗（配合 systemd user service 使用） |
| `docker-compose.yml` | 自包含三账号 NapCat 测试栈（bot 3384461856 / user-a 2157875424 / user-b 2101197401） |

## 常用命令

```bash
pnpm test          # vitest 单测（76 个）
pnpm build         # tsc 产物到 dist/
pnpm typecheck
pnpm e2e:health    # WS 管道健康检查（需要 NapCat 在线）
scripts/qq-debug.sh  # E2E 预检查（容器/端口/在线状态/收发验证）
```

## 安装进 host

```bash
pnpm exec tsx scripts/install-onebot-napcat.ts --host-dir <NANOCLAW_HOST_ROOT>
```

安装后 host 侧必做（详见 `.agents/skills/add-onebot-napcat/SKILL.md`）：

1. host `.env` 填 `NAPCAT_WS_URL` / `NAPCAT_ACCESS_TOKEN` / `NAPCAT_SELF_ID`（可空）
2. `pnpm exec tsx scripts/upgrade-state.ts set` 清除 upgrade tripwire，再重启 host 服务
3. 用 NanoClaw 的 `/init-first-agent` / `ncl` 完成 owner + wiring（QQ 号属于各实例，不写进本仓库）

## 设计约束（改代码前读）

- `channelType: 'qq'`，platform id：`qq:<user_id>` / `qq:group:<group_id>`，threadId 恒 null
- `supportsThreads: false` → 群聊 engage 默认 `mention`（不要声明 `mention-sticky`，host 会静默降级）；`NAPCAT_REQUIRE_AT_IN_GROUP=true` 时非 @ 群消息在 Adapter 层直接丢弃
- 私聊视为 always-mention（`isMention: true`）
- OneBot v11 无按钮回调：`ask_question`/card 降级为纯文本
- 修改 `src/vendor/` 后需与 host `src/channels/adapter.ts` 保持结构兼容；vendored 类型未钉 host commit，对齐后应在文件头注明
- 富媒体：入站下载转 base64，出站 `base64://` 消息段；下载失败降级占位文本

## 测试环境

- 测试群 `922216566`，access token `nanoclaw-test-token`（三个 NapCat 实例一致）
- `napcat-config-test/` 在 .gitignore 内（含 WebUI token），其中 webui.json 端口必须与 compose 映射一致（bot 6099 / user-a 6100 / user-b 6101）
- 重建 NapCat 容器可能使 QQ 会话失效需重新扫码；无人值守用 `scripts/napcat-watchdog.sh`
