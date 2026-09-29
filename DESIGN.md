# NanoClaw OneBot Napcat v11 QQ Adapter 设计文档

## 1. 项目定位

本项目是 **NanoClaw v2** 的一个独立渠道适配器（channel adapter），通过 **OneBot v11 协议**连接 **NapCat**，让 NanoClaw 能够接收与回复 QQ 私聊、群聊消息，并提供基础的群组管理能力。

交付形态为独立的 skill/adapter 包，用户通过 NanoClaw 的 `/add-onebot-napcat` 技能将其安装到自己的 NanoClaw fork 中，而不是维护一个完整的 NanoClaw fork。

本项目的“独立”指可独立发布、安装和测试的渠道适配器，不代表脱离 NanoClaw 后仍能独立运行 Agent。账号、用户、群聊和 agent wiring 都是宿主实例状态，不能进入适配器源码或通用 skill。

## 2. 设计目标

- **最小可用**：第一版只采用正向 WebSocket 连接，降低部署与维护复杂度。
- ** NanoClaw 原生集成**：遵循 NanoClaw v2 的 `ChannelAdapter` 接口，作为原生适配器接入 host 的消息路由。
- **富媒体支持**：支持文本、图片、文件、语音的收发，以及 QQ 的 `@提及` 和回复引用。
- **访问控制**：支持用户/群组白名单、黑名单，以及管理员机制。
- **基础群管**：管理员可通过简单命令完成禁言、踢人、动态加白/加黑等操作。
- **可测试**：核心协议转换、访问控制、命令解析均具备单元测试。

## 3. 系统架构

```
QQ 用户 / QQ 群
       │
       ▼
   NapCat（NTQQ 协议端）
       │ 正向 WebSocket（OneBot v11）
       ▼
   本适配器（nanoclaw-onebot-napcat）
       │ InboundMessage
       ▼
   NanoClaw host（router → inbound.db）
       │
       ▼
   Agent 容器（Claude Agent SDK）
       │
       ▼
   outbound.db → delivery → 本适配器 → NapCat → QQ
```

## 4. 适配器职责

适配器是 NanoClaw host 与 NapCat 之间的双向网关，主要职责如下：

| 方向 | 职责 |
|------|------|
| 入站 | 维护与 NapCat 的正向 WebSocket 连接；接收 OneBot v11 事件；将消息、通知、请求事件转换为 NanoClaw 可识别的 `InboundMessage`；执行黑白名单过滤；识别群聊中的 `@机器人`；处理入群/退群等通知。 |
| 出站 | 从 NanoClaw `outbound.db` 拿到回复后，根据目标平台 ID 调用 `send_private_msg` 或 `send_group_msg`；将 NanoClaw 的文本/文件/图片转换为 OneBot 消息段；对超长文本进行拆分。 |
| 群管 | 对 `NAPCAT_ADMINS` 中的 QQ 号拦截 `/status`、`/mute`、`/kick`、`/allow`、`/block` 等 Adapter-local 命令，直接调用 OneBot 群管理接口，不交给 Agent 处理。NanoClaw owner/admin/member 由 host 管理。 |
| 生命周期 | 提供 `setup`、`teardown`、`isConnected` 方法，供 NanoClaw host 统一调度。 |

## 5. 接口来源、一致性与不 fork 的用法

### 5.1 本项目不是独立可执行程序

**本仓库是 NanoClaw 的一个渠道插件源码包，不是独立 QQ 机器人。** 消息路由、会话管理、Agent 容器等核心能力都在 NanoClaw host 中，适配器只是 host 与 NapCat 之间的双向网关。因此无论是否 fork，最终都需要一个 NanoClaw host 环境才能运行。

### 5.2 接口从哪里来

NanoClaw v2 的适配器接口定义在 `src/channels/adapter.ts`（`ChannelAdapter`、`ChannelSetup`、`InboundMessage`、`OutboundMessage` 等）。本仓库不复制 NanoClaw 全部源码，而是分两层处理：

- **运行时**：适配器源码被安装到 NanoClaw fork 的 `src/channels/onebot-napcat/` 下，通过相对路径 `../adapter.js` 直接使用 host 的真实接口。
- **开发与测试时**：本仓库放置一份与 NanoClaw 保持一致的接口类型声明（`src/vendor/nanoclaw-adapter-types.ts`），仅用于本地类型检查和单元测试，**不会被复制到 host**。

### 5.3 不 fork 如何保证接口一致

如果不 fork `nanocoai/nanoclaw`，仍有几种可行方案：

1. **作为 NanoClaw 的 channel 分支维护**  
   先 clone 官方 `nanocoai/nanoclaw`，再把本仓库文件复制/软链接到其 `src/channels/` 目录。这样运行时接口完全来自官方 host，一致性由 NanoClaw 保证。

2. **发布 npm 包 + 安装时复制源码**（参考 `nanoclaw-webchat`）  
   把适配器源码打包成 npm 包（如 `nanoclaw-onebot-napcat`），并提供一个 CLI/skill：
   - 用户在自己的 NanoClaw fork 里执行 `pnpm add nanoclaw-onebot-napcat`
   - CLI 把包内的适配器模板复制到 host 的 `src/channels/onebot-napcat/`
   - 复制后的代码使用 host 的 `../adapter.js`，类型检查在 host 构建时完成
   - 包本身不需要依赖 NanoClaw 的类型，靠**结构类型（structural typing）**保证兼容

3. **不复制源码，直接 import host 的 registry 函数**  
   npm 包导出一个 factory 函数，factory 返回的对象结构满足 `ChannelAdapter`。host 侧调用 `registerChannel(createOneBotNapCatAdapter())` 时，TypeScript 会按结构类型校验。只要方法签名一致即可，不需要显式 `implements ChannelAdapter`。但这种方式下 factory 若需要 host 的 log/db 等工具，只能通过 `ChannelSetup` 注入，不能硬依赖 host 内部模块。

4. **使用 git submodule / subtree**  
   把 NanoClaw 的 `src/channels/adapter.ts` 作为子模块引入本仓库，自动跟随上游更新。缺点是仓库变重，且仍需要 host 才能运行。

**推荐方案**：第一版采用方案 1 或 2。方案 1 最简单；方案 2 更符合 NanoClaw "skill + npm" 的社区趋势（如 `nanoclaw-webchat`），也便于分发。

### 5.4 自行维护一个 NanoClaw 类型包

可以。如果你不想把接口声明直接放在适配器仓库里，可以单独发布一个类型包，例如 `@your-scope/nanoclaw-types`，里面只放 `ChannelAdapter`、`ChannelSetup`、`InboundMessage`、`OutboundMessage` 等接口。

**怎么用**：

1. 适配器仓库把它作为 `devDependencies`：
   ```json
   "devDependencies": {
     "@your-scope/nanoclaw-types": "^1.0.0"
   }
   ```
2. 本地开发和测试时，源码里可以显式 import 这些类型：
   ```ts
   import type { ChannelAdapter, ChannelSetup } from '@your-scope/nanoclaw-types';
   ```
3. 发布到 npm 的适配器包中， skill/CLI 安装时要做一件事：**把 `@your-scope/nanoclaw-types` 也加到 NanoClaw host 的 `devDependencies` 中**（或替换源码里的类型导入为 host 的 `../adapter.js`）。否则 host 编译时会找不到这个包。

**优点**：
- 多个 NanoClaw 插件可以共用同一套类型；
- 接口变更时只需升级类型包，再升级依赖它的适配器包；
- 清晰表达"适配器是针对 NanoClaw 哪个版本接口编写的"。

**缺点/注意点**：
- 你需要自己负责同步 NanoClaw 上游的接口变更；
- 类型包一旦滞后，会导致 host 侧编译通过但实际行为不一致；
- 如果源码复制到 host 后仍 import 类型包，必须保证 host 也安装了它；否则要在安装脚本里做 import 路径重写。

**建议的同步机制**：
- 在类型包仓库加一个脚本，定期 `curl` NanoClaw 的 `src/channels/adapter.ts`；
- 用 diff 检测变更，变更后自动打 tag、发版；
- 适配器包的 CI 里跑 `tsc` 校验，并在 NanoClaw 某个固定版本的 host fixture 上做集成测试。

### 5.5 为什么不能直接 import NanoClaw 作为 npm 依赖

目前 NanoClaw 没有发布 `@nanoclaw/types` 或类似的类型包，其 `src/channels/adapter.ts` 只在仓库内部。因此：
- 不能 `npm install nanoclaw` 拿到接口；
- 只能复制接口声明、靠结构类型、或在 host 侧完成类型检查。

如果未来 NanoClaw 官方把适配器接口抽成独立包，本仓库可以直接声明为 `devDependencies`，届时方案 3 会更干净。

## 6. 关键设计决策

### 6.1 连接方式：仅正向 WebSocket

- 适配器作为 WebSocket 客户端连接 NapCat 的 WebSocket Server。
- 相比反向 WebSocket 或 HTTP，正向 WS 的部署链路最短，且能同时接收事件和调用 API。
- 心跳依赖 NapCat 主动发送的 `meta_event.heartbeat`，适配器在超时未收到时自动重连。

### 6.2 消息格式：array

- NapCat 必须配置 `message_postFormat: array`。
- 适配器内部统一以 OneBot 数组消息段（segment array）作为入站和出站的中间表示。

### 6.3 会话模型：无 thread

- QQ 群本身即会话单元，适配器 `supportsThreads` 设为 `false`。
- 私聊平台 ID：`qq:<user_id>`
- 群聊平台 ID：`qq:group:<group_id>`
- `threadId` 始终为 `null`。

### 6.4 触发策略

- 私聊消息默认视为对机器人的消息，`isMention = true`。
- 群聊消息仅在消息段中出现 `@机器人` 时，`isMention = true`；其余情况由 NanoClaw router 根据 trigger word 决定是否 engage。
- 可通过 `NAPCAT_REQUIRE_AT_IN_GROUP` 调整默认行为。

### 6.5 富媒体处理

- 入站图片/文件/语音优先下载 NapCat 消息段中提供的 URL，转为 base64 附件。
- 若无法下载，则记录占位说明，避免阻塞对话。
- 出站附件统一使用 `base64://` 形式的消息段发送。

### 6.6 交互卡片降级

- QQ 原生 OneBot v11 不支持按钮/卡片回调。
- NanoClaw 的 `ask_question` / `card` 消息会降级为纯文本列表或描述文本；后续可通过监听用户回复数字实现简单回调（MVP 阶段仅做文本降级）。

## 7. 配置项

适配器通过环境变量读取配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `NAPCAT_WS_URL` | 是 | NapCat 正向 WebSocket 地址，如 `ws://127.0.0.1:3001` |
| `NAPCAT_ACCESS_TOKEN` | 否 | NapCat 访问令牌，无则留空 |
| `NAPCAT_SELF_ID` | 否 | 机器人 QQ 号，用于过滤自己消息和识别 @ |
| `NAPCAT_ALLOWED_USERS` | 否 | 允许私聊的用户 QQ 号，逗号分隔；空表示允许全部 |
| `NAPCAT_ALLOWED_GROUPS` | 否 | 允许交互的群号，逗号分隔；空表示允许全部 |
| `NAPCAT_BLOCKED_USERS` | 否 | 拒绝的用户 QQ 号，逗号分隔 |
| `NAPCAT_BLOCKED_GROUPS` | 否 | 拒绝的群号，逗号分隔 |
| `NAPCAT_ADMINS` | 否 | 管理员 QQ 号，逗号分隔 |
| `NAPCAT_REQUIRE_AT_IN_GROUP` | 否 | 群聊是否要求 @机器人，默认 `true` |
| `NAPCAT_MAX_TEXT_LENGTH` | 否 | 单条消息最大字符数，默认 `4500` |
| `NAPCAT_WELCOME_MSG` | 否 | 新成员入群欢迎语 |
| `NAPCAT_GOODBYE_MSG` | 否 | 成员退群告别语 |

## 8. NapCat 侧配置要求

在 NapCat 的网络配置中启用 WebSocket Server，并确保：

- `messagePostFormat` 设置为 `array`
- `enableForcePushEvent` 建议开启，减少事件丢失
- 若适配器与 NapCat 不在同一主机，host 需为 `0.0.0.0`，且适配器端使用宿主机 IP

## 9. 模块划分

| 模块 | 职责 |
|------|------|
| `onebot-napcat.ts` | 实现 NanoClaw `ChannelAdapter` 接口的主入口 |
| `client` | WebSocket 连接管理、API 请求-响应映射、心跳与重连 |
| `protocol` | OneBot 消息段解析与构造、富媒体下载/编码 |
| `inbound` | OneBot 事件 → NanoClaw `InboundMessage` 转换 |
| `outbound` | NanoClaw `OutboundMessage` → OneBot action 转换 |
| `allowlist` | 黑白名单与管理员权限校验 |
| `admin-cmds` | 群管命令解析与执行 |

## 10. 实现阶段

### 阶段一：骨架与协议连接

- 初始化仓库，配置 TypeScript、测试框架与 lint。
- 定义 OneBot v11 核心事件、动作、消息段类型。
- 实现正向 WebSocket 客户端：连接、API 调用（`echo` 映射）、心跳检测、指数退避重连。
- 验收：能通过 mock OneBot WS server 完成 `get_login_info` 并处理断线重连。

### 阶段二：入站与出站文本消息

- 实现私聊/群聊消息事件到 `InboundMessage` 的转换。
- 实现 `deliver`：根据平台 ID 选择 `send_private_msg` 或 `send_group_msg`。
- 支持纯文本收发与基本日志。
- 验收：NanoClaw router 能收到 QQ 私聊/群聊文本，Agent 回复能正确发回 QQ。

### 阶段三：富媒体与 @提及

- 支持 `text`、`at`、`image`、`record`、`file`、`reply` 等消息段解析。
- 入站图片/文件/语音下载并转为 base64 附件。
- 出站附件构造为对应 OneBot 消息段。
- 识别 `@机器人` 并设置 `isMention`。
- 长文本拆分发送。
- 验收：图片、文件、语音正常收发；群内 @机器人触发回复。

### 阶段四：访问控制与群管

- 实现黑白名单过滤逻辑。
- 实现管理员命令：`/status`、`/mute`、`/kick`、`/allow`、`/block`。
- 处理入群/退群通知，发送欢迎/告别语。
- 验收：非白名单消息被丢弃；管理员命令正确调用 OneBot 接口并收到反馈。

### 阶段五：文档、测试与技能封装

- 编写 `README.md`、`SKILL.md`、`REMOVE.md`。
- 为核心模块补全单元测试，确保 `pnpm test` / `bun test` 通过。
- 验证 `/add-onebot-napcat` 技能在 NanoClaw fork 中的安装流程。
- 验收：测试全绿，文档完整，能作为 NanoClaw skill 成功安装并运行。

## 11. 风险与回退策略

| 风险 | 回退策略 |
|------|----------|
| NapCat 扩展 API 变动 | 群管命令优先使用 OneBot v11 标准 action；扩展能力用可选分支隔离 |
| 图片/语音下载失败 | 回退为占位文本，不阻塞主对话 |
| WebSocket 长期断连 | 指数退保重连；连接不可用时 `isConnected()` 返回 false，NanoClaw 会保留 pending 消息 |
| 机器人缺少群管权限 | 将 OneBot 返回的 `retcode`/`msg` 直接告知管理员 |

## 12. 后续可扩展方向

- 反向 WebSocket server 模式（NapCat 主动连接适配器）。
- HTTP API 降级发送通道。
- NapCat 扩展 API：AI 语音、表情回应、合并转发消息等。
- 多 QQ 账号多实例支持。
