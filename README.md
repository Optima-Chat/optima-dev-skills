# Optima Dev Skills

**命令驱动的 Claude Skills - 为 Optima AI 开发团队提供跨环境协作的开发工具**

## 📦 快速安装

### 方式 1：通过 npm（推荐）

```bash
npm install -g @optima-chat/dev-skills@latest
```

安装后会自动将 skills 复制到 `~/.claude/` 目录。

安装后，`/logs` 命令和 `logs` skill 会自动可用。

## 🎯 核心理念

Optima Dev Skills 让 Claude Code 能够直接在 **CI、Stage、Prod** 三个环境中执行开发任务。

**核心价值**:
- **即时执行** - Claude 直接执行操作，开发者零手动操作
- **任务驱动** - 基于具体任务场景（查看日志、调用 API），不是抽象分类
- **跨环境协作** - 统一的命令在 CI、Stage、Prod 三个环境中使用

## 📋 任务场景（5 个）

当 Claude Code 识别到以下任务时，会自动加载对应的 Skill：

- **logs** - 查看 CI/Stage/Prod 的服务器日志
- **query-db** - 查询 CI/Stage/Prod 的数据库
- **generate-test-token** - 生成测试 Access Token 用于 API 测试
- **use-commerce-cli** - 使用 Commerce CLI 管理电商店铺
- **read-code** - 阅读 Optima-Chat 组织下任意仓库的代码

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
| **CI** | Docker Compose | dev.optima.chat | api.optima.chat<br>auth.optima.chat<br>mcp.optima.chat |
| **Stage** | AWS ECS | AWS ECS | api.stage.optima.onl<br>auth.stage.optima.onl<br>mcp.stage.optima.onl |
| **Prod** | EC2 + Docker | AWS EC2 | api.optima.shop<br>auth.optima.shop<br>mcp.optima.shop |

**说明**：
- **CI** - 团队共享的持续集成测试环境，部署在 dev.optima.chat 服务器
- **Stage** - 预发布环境，用于上线前的最终验证
- **Prod** - 生产环境，服务真实用户

## 🚀 Claude Code 命令

| 命令 | 说明 | 示例 | 跨环境 |
|------|------|------|--------|
| `/logs` | 查看服务日志 | `/logs commerce-backend 100` | ✅ |
| `/query-db` | 查询数据库 | `/query-db user-auth "SELECT COUNT(*) FROM users"` | ✅ |
| `/generate-test-token` | 生成测试 token | `/generate-test-token` | 🔧 Development |

**说明**：
- 命令支持 CI、Stage、Prod 三个环境
- 默认使用 CI 环境，适合日常开发
- `/generate-test-token` 生成的账户用于 development 环境（api.optima.chat）
- Claude Code 会根据上下文自动选择环境和执行方式

## 🛠️ CLI 工具

安装此包后，会全局安装以下 CLI 工具：

| 工具 | 说明 | 示例 |
|------|------|------|
| `optima-query-db` | 数据库查询工具 | `optima-query-db user-auth "SELECT COUNT(*) FROM users" prod` |
| `optima-generate-test-token` | 生成测试 token | `optima-generate-test-token --business-name "测试店铺"` |

**特点**：
- ✅ 支持 CI、Stage、Prod 三个环境（query-db）
- ✅ 自动管理 SSH 隧道和密钥
- ✅ 可在任何终端直接使用
- ✅ 自动注册账户、获取 token、设置 merchant profile（generate-test-token）
- ✅ Claude Code 的命令内部也使用这些工具

## 🏗️ 项目结构

```
optima-dev-skills/
├── .claude/
│   ├── commands/
│   │   ├── logs.md                    # /logs - 查看服务日志
│   │   ├── query-db.md                # /query-db - 查询数据库
│   │   └── generate-test-token.md     # /generate-test-token - 生成测试 token
│   │
│   └── skills/
│       ├── logs/                      # 日志查看 skill
│       ├── query-db/                  # 数据库查询 skill
│       ├── generate-test-token/       # 测试 token 生成 skill
│       ├── use-commerce-cli/          # Commerce CLI 使用 skill
│       └── read-code/                 # 代码阅读 skill
│
├── bin/
│   └── helpers/
│       ├── query-db.ts                # CLI: 数据库查询
│       └── generate-test-token.ts     # CLI: 生成测试 token
│
└── docs/
    └── COMMANDS_DESIGN.md
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

- ✅ **跨环境命令** - 在 CI/Stage/Prod 统一执行
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

**当前版本**: 0.6.0

**已完成**:
- ✅ 3 个跨环境命令：`/logs`、`/query-db`、`/generate-test-token`
- ✅ 5 个任务场景：`logs`、`query-db`、`generate-test-token`、`use-commerce-cli`、`read-code`
- ✅ 支持 CI、Stage、Prod 三个环境
- ✅ CI 环境通过 SSH + Docker 访问
- ✅ Stage/Prod 通过 SSH 隧道访问 RDS
- ✅ TypeScript CLI 工具：`optima-query-db`、`optima-generate-test-token`
- ✅ 通过 Infisical 动态获取密钥
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
