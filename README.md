# Optima Dev Skills

**命令驱动的 Claude Skills - 为 Optima AI 开发团队提供跨环境协作的开发工具**

## 📦 快速安装

### 方式 1：通过 npm（推荐）

```bash
npm install -g @optima-chat/dev-skills@latest
```

安装后会自动将 Claude 资源复制到 `~/.claude/`，并将 Codex skills 复制到 `~/.codex/skills/optima-dev/`。

安装后，`/logs` 命令和 `logs` skill 会在 Claude Code 中可用；Codex 会同时获得对应的本地 skills。

## 🤖 Codex 支持

本仓库现在同时支持 **Claude Code** 和 **Codex**：

- **Claude Code** 使用 `.claude/commands` 和 `.claude/skills`
- **Codex** 使用安装到 `~/.codex/skills/optima-dev/` 的 skills，以及仓库内的 `AGENTS.md`

如果你设置了 `CODEX_HOME`，安装器会改为写入 `$CODEX_HOME/skills/optima-dev/`。

## 🎯 核心理念

Optima Dev Skills 让 Claude Code 能够直接在 **ci、stage、prod、cn-stage、cn-prod** 五个环境中执行开发任务（后两个是阿里云侧，与 AWS 侧完全独立；并非每个 skill 都覆盖全部五个，逐个见下）。

**核心价值**:
- **即时执行** - Claude 直接执行操作，开发者零手动操作
- **任务驱动** - 基于具体任务场景（查看日志、调用 API），不是抽象分类
- **跨环境协作** - 统一的命令在 AWS 侧（ci / stage / prod）与阿里云侧（cn-stage / cn-prod）通用

## 📋 任务场景

当 Claude Code 识别到以下任务时，会自动加载对应的 Skill。按目录字母序，与 `.claude/skills/` 一一对应（由 `tests/service-matrix-alignment.test.js` 校验，加 skill 漏更本清单会红）：

- **account** - 查账号状态/订阅/权益，封禁与解封（stage / prod / cn-stage / cn-prod）
- **cn-deploy** - 把服务发布到 cn-stage，走云效流水线一条龙（cn-stage）
- **discount-codes** - 创建/生成/查看/停用 billing 优惠码（stage / prod）
- **entitlement** - 授予、撤销、查看产品权益（stage / prod / cn-stage / cn-prod）
- **gateway-admin** - gateway 管理面：COO kill、warm-pool、credits adjust、config 读写（cn-stage / cn-prod）
- **generate-test-token** - 生成测试 Access Token 并配好 merchant，用于 API 测试
- **grant-credits** - 赠送、发放积分（stage / prod / cn-stage / cn-prod）
- **grant-subscription** - 开通、赠送、升级订阅（stage / prod / cn-stage / cn-prod）
- **logs** - 查看服务日志（stage / prod 走 CloudWatch，cn-stage / cn-prod 走 SLS；CI 走 SSH + Docker Compose，不经 `optima-logs`）
- **query-db** - 查询数据库、执行 SQL（ci / stage / prod / cn-stage / cn-prod）
- **read-code** - 阅读 Optima-Chat 组织下任意仓库的代码
- **restart-ecs** - 重启 ECS 服务（stage / prod）
- **show-env** - 查看服务环境变量，从 Infisical 取（stage / prod / cn-stage / cn-prod）
- **use-commerce-cli** - 用 Commerce CLI 管理电商店铺（商品、订单、库存、运费、集合、首页、国际化）

## 👤 用户故事

**场景：排查 Stage 环境问题**

```
开发者: "Stage 的商品 API 返回 500，帮我看看日志"

Claude:
  → 执行 /logs commerce-backend 100 stage
  → 分析日志，发现数据库查询错误
  → 定位问题：某个商品的 merchant_id 不存在

开发者: "明白了，我去修复数据"
```

**传统方式需要**：
1. 登录 AWS Console
2. 找到 CloudWatch Logs
3. 筛选服务和时间
4. 手动查看日志

**使用 dev-skills**：一句话，Claude 自动完成。

## 🌐 支持的环境

| 环境 | 部署方式 | 服务器 | 访问地址示例 |
|------|---------|--------|------------|
| **ci** | Docker Compose | dev.optima.chat | api.optima.chat<br>auth.optima.chat<br>mcp.optima.chat |
| **stage** | AWS ECS | AWS ECS | api.stage.optima.onl<br>auth.stage.optima.onl<br>mcp.stage.optima.onl |
| **prod** | EC2 + Docker | AWS EC2 | api.optima.shop<br>auth.optima.shop<br>mcp.optima.shop |
| **cn-stage** | 阿里云 SAE（云效流水线发布） | 阿里云 SAE + RDS（经 buildbox ECS 跳板） | auth.stage.optima.chat<br>commerce.stage.optima.chat |
| **cn-prod** | 阿里云 SAE | 阿里云 SAE + RDS（经 buildbox ECS 跳板） | auth.yzsgo.com<br>commerce.yzsgo.com |

**说明**：
- **ci** - 团队共享的持续集成测试环境，部署在 dev.optima.chat 服务器
- **stage** - 预发布环境，用于上线前的最终验证
- **prod** - 生产环境，服务真实用户
- **cn-stage / cn-prod** - 阿里云侧独立部署，与 AWS 侧完全无关（独立 Infisical 实例、独立 RDS 实例）；cn-prod 服务境内真实用户

## 🚀 Claude Code 命令

| 命令 | 说明 | 示例 | 跨环境 |
|------|------|------|--------|
| `/generate-test-token` | 生成测试 token | `/generate-test-token` | 🔧 Development |
| `/logs` | 查看服务日志 | `/logs commerce-backend 100` | ci / stage / prod / cn-stage / cn-prod |
| `/query-db` | 查询数据库 | `/query-db user-auth "SELECT COUNT(*) FROM users"` | ci / stage / prod / cn-stage / cn-prod |
| `/read-code` | 阅读代码 | `/read-code commerce-backend app/main.py` | - |
| `/restart-ecs` | 重启 ECS 服务 | `/restart-ecs user-auth stage` | stage / prod |
| `/trace-user` | 用户链路追踪：按账号把全链路行为拼成时间线 | `/trace-user user@example.com` | stage / prod / cn-stage / cn-prod |

**说明**：
- 本表与 `.claude/commands/` 一一对应（由 `tests/service-matrix-alignment.test.js` 校验，加命令漏更本表会红）。
- 上方「任务场景」里的 skill 同样可以用 `/<skill 名>` 直接唤起（例如 cn-deploy、gateway-admin），但它们是 skill、不在 `.claude/commands/` 里，因此不列进本表。
- 各命令支持的环境不同，见「跨环境」列。默认环境也不统一：`/logs`、`/query-db`、`/generate-test-token` 默认 `ci`，**`/restart-ecs`、`/trace-user` 默认 `stage`**（别当成 ci —— `/restart-ecs session-gateway` 不带环境重启的是 stage）。
- `/generate-test-token` 生成的账户用于 development 环境（api.optima.chat）
- Claude Code 会根据上下文自动选择环境和执行方式

## 🛠️ CLI 工具

安装此包后，会全局安装以下 CLI 工具：

| 工具 | 说明 | 示例 |
|------|------|------|
| `optima-query-db` | 数据库查询工具 | `optima-query-db user-auth "SELECT COUNT(*) FROM users" prod` |
| `optima-show-env` | 查看服务环境变量 | `optima-show-env commerce-backend stage --filter DATABASE` |
| `optima-generate-test-token` | 生成测试 token | `optima-generate-test-token --business-name "测试店铺"` |
| `optima-discount` | 优惠码管理 | `optima-discount create --code LAUNCH20 --percent 20 --env stage` |
| `optima-grant-subscription` | 开通/切换订阅 | `optima-grant-subscription 18898654855 --plan pro-cn --env cn-prod` |
| `optima-grant-credits` | 赠送积分 | `optima-grant-credits user@example.com --credits 10000 --env prod`（`optima-grant-balance` 为废弃别名）|
| `optima-entitlement` | 产品权益 grant/revoke/list | `optima-entitlement grant 18898654855 --product-key scout-gift --justification "..." --env cn-prod` |
| `optima-account` | 账号 status/ban/unban | `optima-account ban user@example.com --reason "abuse" --env prod` |
| `optima-cn-deploy` | 云效 Flow 发布到 cn-stage（构建→DB迁移→SAE 发布→sha 校验，20 服务） | `optima-cn-deploy billing` / `optima-cn-deploy user-auth --branch feat/xxx` |

> **4 环境 + 标识符**：`grant-subscription` / `grant-credits` / `entitlement` / `account` 均支持 `stage` / `prod` / `cn-prod` / `cn-stage`。标识符 `<email\|phone\|userId>`——**cn-prod / cn-stage 用户多为手机号注册**，三种均可；AWS stage/prod 仅 email。`ban`/`unban` 及 `account status` 的禁用态读取需 admin-用户凭证（Infisical `/shared-secrets/credentials`；cn 另需 `INFISICAL_CN_EMAIL/PASSWORD`）。

**特点**：
- ✅ 支持 ci / stage / prod / cn-stage / cn-prod（query-db，见 `bin/helpers/query-db.ts` 的 `VALID_ENVS`）
- ✅ 支持 stage / prod / cn-stage / cn-prod（show-env）
- ✅ 自动管理 SSH 隧道和密钥
- ✅ 可在任何终端直接使用
- ✅ 自动注册账户、获取 token、设置 merchant profile（generate-test-token）
- ✅ Claude Code 的命令内部也使用这些工具
- ✅ Codex skills 也优先调用这些工具

## 🏗️ 项目结构

```
optima-dev-skills/
├── .claude/
│   ├── commands/       # /<name> 斜杠命令，一个命令一个 .md
│   └── skills/         # Claude Code skills，一个 skill 一个目录（清单见上方「任务场景」）
│
├── .codex/
│   └── skills/         # Codex skills，是 .claude/skills 的镜像子集（清单见 AGENTS.md）
│
├── bin/
│   └── helpers/        # optima-* CLI 的 TypeScript 实现（清单见上方「CLI 工具」）
│
├── scripts/
│   └── install.js      # postinstall：按 readdir 把上面各目录全量装到 ~/.claude 与 ~/.codex
│
├── tests/              # node --test；service-matrix-alignment 校验文档清单与实际目录一致
│
└── docs/
```

## 💡 使用示例

### 示例 1：排查 Stage 环境问题

```
开发者: "Stage 的 /products API 返回 500"

Claude:
1. /logs commerce-backend 100 stage
   → 查看 CloudWatch 日志

2. 发现错误：Database connection timeout

3. 问题定位：Stage RDS 连接配置问题
```

### 示例 2：生成测试 token 并管理店铺

```bash
# 1. 生成 production 环境测试 token
$ optima-generate-test-token --env production

Environment: production
Auth API: https://auth.optima.shop
✅ Test token generated successfully!
📁 Token File Path: /tmp/optima-test-token-xxx.txt

# 2. 使用 token 创建商品
$ OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
  OPTIMA_ENV=production \
  commerce product create --title "测试商品" --price 99.99 --stock 100

{
  "success": true,
  "data": {
    "product_id": "xxx",
    "name": "测试商品",
    "price": "99.99"
  }
}
```

### 示例 3：使用 CLI 工具快速查询

```bash
# 查询 Prod 用户数
$ optima-query-db user-auth "SELECT COUNT(*) FROM users" prod

# 查询 Stage 商品列表
$ optima-query-db commerce-backend "SELECT id, title FROM products LIMIT 5" stage
```

## 🎯 设计原则

### dev-skills 提供什么？

- ✅ **跨环境命令** - 在 ci / stage / prod / cn-stage / cn-prod 统一执行
- ✅ **任务场景指导** - 完整的操作流程（不是零散命令）
- ✅ **团队协作工具** - 跨仓库、跨环境的共享知识

### dev-skills 不提供什么？

- ❌ **单个服务的开发文档** → 看各服务的 `CLAUDE.md`
- ❌ **服务内部架构** → 看各服务的 `CLAUDE.md`
- ❌ **API 详细文档** → 用 `/swagger` 命令查看

### 为什么要这样设计？

1. **避免重复** - 服务级文档已经在各服务的 CLAUDE.md 中
2. **聚焦协作** - dev-skills 专注于跨服务、跨环境的协作场景
3. **易于维护** - 命令和场景独立维护，不与服务代码耦合

## 📊 效率提升

| 操作 | 传统方式 | 使用命令 | 节省时间 |
|------|---------|---------|---------|
| 查看 Stage 日志 | 登录 AWS Console → CloudWatch → 筛选 | `/logs service 100 stage` | **90%** |
| 获取 API Token | 找密码 → Postman → 复制粘贴 | `/get-token user@optima.ai` | **85%** |
| 创建测试数据 | 手动调用 API 10 次 | `/create-test-product 10` | **95%** |
| 连接 Stage 数据库 | 找密码 → 复制连接串 → psql | `/query-db commerce stage` | **90%** |

**平均节省时间**: **90%+**

## 🔐 安全说明

本仓库**不包含**任何敏感信息：

✅ **包含**：
- 服务地址和端口（公开信息）
- 文档链接
- 获取密钥的方式（Infisical 路径，不是密钥本身）

❌ **不包含**：
- API Key、密码
- 数据库密码
- AWS 凭证

所有密钥通过 Infisical 管理，命令只描述如何获取，不存储实际值。

## 🛠️ 开发状态

**当前版本**：见 [package.json](package.json)，或 `npm view @optima-chat/dev-skills version`（不在此写死——写死的数字正是本节此前一路过期到 0.7.16 的原因）

**已完成**:
- ✅ 命令、任务场景、CLI 工具三份清单见上方对应章节，此处不再重复计数（重复一次就多一处会漂的地方）
- ✅ 支持 ci、stage、prod、cn-stage、cn-prod 五个环境
- ✅ CI 环境通过 SSH + Docker 访问
- ✅ stage / prod / cn-stage / cn-prod 均通过 SSH 隧道访问 RDS（cn 两侧经 buildbox ECS 跳板）
- ✅ 通过 Infisical 动态获取密钥和环境变量
- ✅ 自动生成测试 token 并设置 merchant profile
- ✅ `generate-test-token` 支持 development 和 production 环境

**设计原则**:
- 命令提供信息（URL、路径、凭证位置），不实现复杂逻辑
- Claude Code 利用自身工具（WebFetch、Bash）完成实际操作
- 聚焦跨环境协作，避免与服务文档重复

## 📚 相关文档

- [命令设计方案](docs/COMMANDS_DESIGN.md) - 完整的命令驱动设计思路

## 📝 维护

由 Optima AI 开发团队维护。

如发现问题：
1. 提交 Issue 到 GitHub
2. 或直接提交 PR 修复

## 📄 License

MIT

---

**🤖 Powered by [Claude Code](https://claude.com/claude-code)**
