---
name: add-onebot-napcat
description: |
  在 NanoClaw v2 host 中安装 NanoClaw OneBot Napcat v11 QQ Adapter。
  Use when:
  (1) 用户想在 NanoClaw fork 里接入 QQ 渠道；
  (2) 用户输入了 `/add-onebot-napcat`；
  (3) 需要把本仓库源码复制到 NanoClaw host 的 `src/channels/onebot-napcat/` 并完成注册。
license: MIT
metadata:
  author: Kimi Code CLI
  version: "1.0.0"
---

# `/add-onebot-napcat` 安装 Skill

本 Skill 把 `nanoclaw-onebot-napcat` adapter 安装到用户的 NanoClaw v2 fork 中，使其能够通过 OneBot v11 协议连接 NapCat，收发 QQ 私聊/群聊消息，并提供基础群管能力。

## 前置条件

- 当前目录必须是 NanoClaw host 的根目录（包含 `package.json`、`src/channels/index.ts`、`.env`）。
- 本 adapter 仓库必须在本地可访问（当前目录即为 adapter 仓库，或用户提供了仓库路径）。
- host 已配置 Node.js >= 22 与 pnpm 10+。

## 安装步骤

1. **确认身处 NanoClaw host 根目录**

   检查以下文件是否存在：
   - `package.json`
   - `src/channels/index.ts`
   - `.env`

   若不存在，停止并提示用户先 `cd` 到 NanoClaw fork 根目录。

2. **定位 adapter 仓库**

   如果当前目录同时包含 `src/onebot-napcat.ts` 与 `scripts/install-onebot-napcat.ts`，则直接使用当前目录作为 adapter 仓库。

   否则，请用户指定本地路径，或从 GitHub 克隆：

   ```bash
   git clone https://github.com/<owner>/nanoclaw-onebot-napcat.git /tmp/nanoclaw-onebot-napcat
   cd /tmp/nanoclaw-onebot-napcat
   ```

3. **运行安装脚本**

   从 adapter 仓库根目录执行：

   ```bash
   tsx scripts/install-onebot-napcat.ts --host-dir <NANOCLAW_HOST_ROOT>
   ```

   安装器默认保留已有的 `src/channels/onebot-napcat/`，不会覆盖 host 的本地修改；升级到仓库版本前请先审阅差异，再显式传入 `--force`。它也只补充 `.env` 中缺失的 NapCat 变量，不会覆盖已有值。

   例如，若 NanoClaw host 就在当前目录的上级 `../nanoclaw`：

   ```bash
   tsx scripts/install-onebot-napcat.ts --host-dir ../nanoclaw
   ```

   脚本会自动完成：
   - 复制 `src/` 到 `<host>/src/channels/onebot-napcat/`
   - 把 vendored 类型导入重写为 `../adapter.js`
   - 删除 host 中不需要的 `vendor/` 目录
   - 在 `src/channels/index.ts` 追加 `import './onebot-napcat.js';`
   - 向 host `package.json` 添加 `ws` 依赖
   - 向 host `.env` 追加 Napcat 配置变量
   - 运行 `pnpm install` 与 `pnpm run build`

4. **配置 NapCat 与 Adapter 环境变量**

   编辑 NanoClaw host 的 `.env`，至少填写：

   ```env
   NAPCAT_WS_URL=ws://127.0.0.1:3001
   NAPCAT_ACCESS_TOKEN=                 # NapCat 启用鉴权时填写
   NAPCAT_SELF_ID=                     # 可留空，Adapter 会用 get_login_info
   NAPCAT_ADMINS=                      # 可选：允许使用 /status 等 Adapter 管理命令的 QQ 号，逗号分隔
   ```

   可选配置：
   - `NAPCAT_ALLOWED_USERS` / `NAPCAT_ALLOWED_GROUPS`：白名单
   - `NAPCAT_BLOCKED_USERS` / `NAPCAT_BLOCKED_GROUPS`：黑名单
   - `NAPCAT_REQUIRE_AT_IN_GROUP=true`：群聊是否需要 @ 机器人才触发
   - `NAPCAT_WELCOME_MSG` / `NAPCAT_GOODBYE_MSG`：入群/退群通知

   `NAPCAT_ADMINS` 只是 Adapter 层的群管命令授权，不会创建 NanoClaw 用户，也不会让消息自动进入 Agent。

5. **初始化 NanoClaw owner 与 agent wiring（必须）**

   Adapter 安装成功只代表 QQ 消息能进入 NanoClaw channel registry。首次使用必须通过 NanoClaw 自己的 `/init-first-agent`（或对应 setup 流程）创建 agent group、把操作者设为 owner，并绑定其 QQ 私聊；之后在 `/manage-channels` / `ncl messaging-groups` / `ncl wirings` 中把其他 QQ 私聊或群聊绑定到一个 agent group。群聊还要确认 `unknown_sender_policy`（`public`、`request_approval` 或 `strict`）符合预期。

   不要把 QQ 号、群号或 agent group ID 写进 Adapter 源码或安装 skill；它们属于每个 NanoClaw 实例的 `.env` 与数据库 wiring 状态。

## 安装后验证

1. **编译通过**

   确保 host 构建无错误：

   ```bash
   pnpm run build
   ```

2. **启动 NapCat**

   参考 adapter 仓库的 `docker-compose.test.yml` 或单独部署 NapCat，启用 OneBot v11 forward WebSocket server，端口与 `.env` 中的 `NAPCAT_WS_URL` 一致。

3. **运行健康检查**

   在 adapter 仓库中：

   ```bash
   pnpm e2e:health
   ```

   或在 host 中直接运行：

   ```bash
   tsx src/channels/onebot-napcat/scripts/qq-health-check.ts
   ```

4. **真实 QQ 端到端测试**

   待你在 NapCat 中登录机器人账号后，调用 `.agents/skills/qq-bot-debug/SKILL.md` 执行标准调试流程：

   - 运行 `scripts/qq-debug.sh`
   - 使用 `qq-agent` MCP 发送私聊/群聊测试消息
   - 检查 Adapter 是否正确收到并回复

## 管理员命令

安装完成后，配置在 `NAPCAT_ADMINS` 中的 QQ 号可在私聊或群内发送：

- `/status` — 查看 OneBot 连接与登录状态
- `/mute <qq> [秒数]` — 禁言群成员（群聊中可省略群号）
- `/kick <qq>` — 将群成员移出群
- `/allow user <qq>` / `/allow group <群号>` — 加入白名单
- `/block user <qq>` / `/block group <群号>` — 加入黑名单

## 故障处理

### 安装脚本提示缺少 NanoClaw host 文件

确认 `--host-dir` 指向 NanoClaw fork 根目录，而不是 adapter 仓库。

### host 构建失败，提示找不到 `../adapter.js`

检查 `src/channels/onebot-napcat/onebot-napcat.ts` 的导入是否已被重写为：

```ts
import type { ... } from '../adapter.js';
```

如果仍是 `./vendor/nanoclaw-adapter-types.js`，说明安装脚本的 import 重写未生效，检查脚本输出日志。

### `ws` 依赖冲突

如果 host 已安装其他版本 `ws`，安装脚本会保留现有版本。此时应手动统一版本或删除 `node_modules` 重新 `pnpm install`。

### Adapter 启动后收不到消息

- 确认 NapCat WebSocket server 已启动且 `NAPCAT_WS_URL` 正确
- 确认 `NAPCAT_ACCESS_TOKEN` 与 NapCat 配置一致
- 确认 OneBot `get_login_info` 返回在线账号；`NAPCAT_SELF_ID` 可留空
- 确认 NanoClaw 已存在 owner、messaging group 和 `messaging_group_agents` wiring；没有 wiring 时日志会显示消息被丢弃
- 检查该 messaging group 的 `unknown_sender_policy` 与 sender membership
- 运行 `scripts/qq-debug.sh` 前先在 `.env` 设置测试账号和 `NAPCAT_TEST_GROUP_ID`

## Channel Info

- **channel type:** `qq`
- **platform id:** 私聊 `qq:<user_id>`，群聊 `qq:group:<group_id>`
- **bot identity:** NapCat 登录的 OneBot 账号，由 `get_login_info` 发现
- **threads:** 不支持，QQ 群本身是会话单位
- **first setup:** 先完成 NanoClaw `/init-first-agent`，再用 `/manage-channels` 创建/绑定 QQ DM 或群聊
- **access layers:** `NAPCAT_*` allow/block/admin 是 Adapter 层过滤；owner/admin/member、unknown sender policy 和 wiring 是 NanoClaw host 层配置

## 卸载

如需移除 adapter，运行 adapter 仓库中的卸载脚本。卸载器不会删除 `.env`、数据库 wiring 或共享的 `ws` 依赖：

```bash
tsx scripts/remove-onebot-napcat.ts --host-dir <NANOCLAW_HOST_ROOT>
```

或手动按 `REMOVE.md` 步骤回滚。
