# Optima Dev Skills 命令设计方案 v2.0

**更新时间**: 2025-11-23
**状态**: 设计阶段

## 核心理念转变

### ❌ 旧设计（文档驱动）
```
Skills = 静态文档 + API 说明 + 配置信息
问题：开发者需要自己翻译成命令
```

### ✅ 新设计（命令驱动）
```
Skills = 可执行命令 + 场景驱动 + 快速操作
价值：Claude 直接执行，开发者零操作
```

## 新目录结构

```
optima-dev-skills/
├── .claude/                   # ⭐ Claude Code 配置目录
│   ├── commands/              # ⭐ 核心：Slash commands（50+ 可执行命令）
│   │   ├── logs/              # 日志查看命令组
│   │   │   ├── backend-logs.md
│   │   │   ├── ecs-logs.md
│   │   │   └── all-logs.md
│   │   ├── services/          # 服务管理命令组
│   │   │   ├── restart-service.md
│   │   │   ├── health-check.md
│   │   │   └── service-status.md
│   │   ├── database/          # 数据库命令组
│   │   │   ├── db-connect.md
│   │   │   ├── db-migrate.md
│   │   │   └── db-query.md
│   │   ├── testing/           # 测试数据命令组
│   │   │   ├── get-token.md
│   │   │   ├── create-test-user.md
│   │   │   ├── create-test-product.md
│   │   │   └── test-api.md
│   │   ├── deployment/        # 部署命令组
│   │   │   ├── deploy.md
│   │   │   ├── deploy-status.md
│   │   │   └── rollback.md
│   │   ├── mcp/               # MCP 工具命令组
│   │   │   ├── list-mcp-tools.md
│   │   │   ├── call-mcp-tool.md
│   │   │   └── register-mcp.md
│   │   └── workspace/         # 工作空间命令组
│   │       ├── workspace-sync.md
│   │       └── workspace-status.md
│   │
│   └── skills/                # 场景工作流指导（仅保留场景）
│       └── scenarios/         # ⭐ 场景驱动 Skills
│           ├── frontend-dev/
│           │   └── SKILL.md   # 前端开发场景（引用命令）
│           └── backend-dev/
│               └── SKILL.md   # 后端开发场景（引用命令）
│
└── docs/
    ├── TECHNICAL_DESIGN.md    # V1 设计（已弃用）
    └── COMMANDS_DESIGN.md     # V2 命令驱动设计（当前版本）
```

**设计原则**：
- **命令是核心** - 提供直接可执行的操作
- **场景是引导** - 告诉开发者什么时候用什么命令
- **避免重复** - 不复制各服务自己的 CLAUDE.md 内容
- **聚焦协作** - dev-skills 是"跨仓库协作"工具，不替代单仓库开发文档
```

## 命令设计规范

### 命令模板

每个命令文件包含：

```markdown
# /command-name - 简短描述

详细说明这个命令的作用和使用场景

## 使用场景

**前端开发者**: 当你需要 XXX 时
**后端开发者**: 当你需要 YYY 时

## 用法

/command-name [参数1] [参数2]

## 参数

- `参数1` (必需): 说明
- `参数2` (可选): 说明，默认值 XXX

## 执行逻辑

Claude 应该执行以下步骤：

1. 检测当前环境（本地/Stage/Prod）
2. 根据环境选择命令
3. 执行并返回结果

## 命令示例

### 本地环境
\```bash
docker compose logs -f commerce-backend --tail 50
\```

### Stage-ECS
\```bash
aws logs tail /ecs/commerce-backend-stage --follow --since 5m
\```

### Prod
\```bash
ssh -i ~/.ssh/optima-ec2-key ec2-user@ec2-prod.optima.shop
docker logs -f optima-commerce-backend-prod --tail 50
\```

## 相关命令

- /health-check - 检查服务健康状态
- /restart-service - 重启服务
```

## Top 20 高频命令详细设计

### 1. `/logs` - 查看后端日志

**优先级**: P0（每天 20+ 次使用）

**参数**:
- `service`: 服务名（commerce-backend/user-auth/mcp-host）
- `lines`: 行数（默认 50）
- `follow`: 是否实时跟踪（默认 true）

**智能识别**:
- 自动检测当前工作目录（在 optima-store → 默认 commerce-backend）
- 自动检测环境（本地/Stage/Prod）

### 2. `/restart-service` - 重启服务

**优先级**: P0（每天 5-10 次）

**参数**:
- `service`: 服务名
- `environment`: 环境（local/stage/prod，默认 local）

**安全检查**:
- Prod 环境需要二次确认
- Stage/Prod 需要检查是否有权限

### 3. `/health-check` - 健康检查

**优先级**: P0（每天 10+ 次）

**参数**:
- `target`: 检查目标（service-name/all）

**返回**:
```
✅ commerce-backend: Running (200 OK)
✅ user-auth: Running (200 OK)
❌ mcp-host: Connection refused
✅ postgres: Connected
✅ redis: Connected
```

### 4. `/query-db` - 查询数据库

**优先级**: P0（每天 5-10 次）

**参数**:
- `database`: 数据库名（commerce/auth/mcp）
- `environment`: 环境（local/stage/prod）

**执行**:
```bash
# 本地
psql postgresql://localhost:8282/optima_commerce

# Prod（通过 SSH 隧道）
ssh -L 5432:rds-endpoint:5432 ec2-user@ec2-prod.optima.shop
psql postgresql://localhost:5432/optima_commerce
```

### 5. `/get-token` - 获取 Token

**优先级**: P0（每天 5-10 次）

**参数**:
- `user`: 用户邮箱（默认 test@optima.ai）
- `environment`: 环境（local/stage/prod）

**执行**:
```bash
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}' \
  | jq -r '.access_token'
```

**智能存储**: 自动保存到环境变量 `$OPTIMA_TOKEN`

### 6. `/create-test-product` - 创建测试商品

**优先级**: P0（每天 3-5 次）

**参数**:
- `count`: 数量（默认 1）
- `merchant_id`: 商家 ID（默认当前用户）

**执行**: 自动获取 Token → 调用 API 创建

### 7. `/service-status` - 查看服务状态

**优先级**: P0（每天 5-10 次）

**参数**:
- `environment`: 环境（local/stage/prod/all）

**返回**: 表格形式显示所有服务状态

### 8. `/test-api` - 测试 API

**优先级**: P0（每天 10+ 次）

**参数**:
- `endpoint`: API 端点（/products, /orders, etc.）
- `method`: HTTP 方法（GET/POST/PUT/DELETE）
- `data`: 请求数据（JSON）

**智能补全**:
- 自动添加 Authorization header
- 自动选择正确的 base URL

### 9. `/deploy` - 部署服务

**优先级**: P1（每天 2-5 次）

**参数**:
- `service`: 服务名
- `environment`: 环境（stage/prod）
- `branch`: 分支（默认 main）

**执行**: 触发 GitHub Actions workflow

### 10. `/swagger` - 打开 Swagger 文档

**优先级**: P1（每天 3-5 次）

**参数**:
- `service`: 服务名

**执行**: 返回 Swagger URL 并自动在浏览器打开（如果可能）

---

### 11-20. 其他高频命令

- `/db-migrate` - 运行数据库迁移
- `/clear-redis` - 清理 Redis 缓存
- `/create-test-user` - 创建测试用户
- `/ecs-status` - ECS 服务状态
- `/workspace-sync` - 同步工作空间
- `/list-mcp-tools` - 列出 MCP 工具
- `/call-mcp-tool` - 调用 MCP 工具
- `/ssh` - SSH 连接服务器
- `/get-env` - 获取环境变量
- `/deploy-status` - 查看部署状态

## 场景驱动 Skills 设计

### scenarios/frontend-dev/SKILL.md

```markdown
---
name: "Frontend Development"
description: "前端开发场景 - 调试 API、测试数据、日志查看"
allowed-tools: ["Bash", "Read"]
---

# 前端开发场景

当你在开发 optima-store 或 agentic-chat 时，这个 Skill 提供常用操作。

## 常见任务

### 1. API 返回 500 错误

**问题**: 调用 commerce-backend API 返回 500

**解决步骤**:
1. `/logs commerce-backend 100` - 查看错误日志
2. `/query-db commerce` - 检查数据库数据
3. `/test-api /products GET` - 重现问题

### 2. 需要测试数据

**问题**: 本地数据库是空的，需要测试数据

**解决步骤**:
1. `/create-test-user` - 创建测试用户
2. `/create-test-product 10` - 创建 10 个测试商品
3. `/get-token` - 获取 Token 用于 API 调用

### 3. Token 过期

**问题**: API 返回 401 Unauthorized

**解决步骤**:
1. `/get-token` - 获取新的 Token
2. 更新前端代码中的 Token

## 快速命令

- `/logs commerce-backend` - 查看后端日志
- `/health-check all` - 检查所有服务
- `/swagger commerce-backend` - 打开 API 文档
- `/test-api [endpoint] [method]` - 测试 API
```

## 实施优先级

### Phase 1: MVP（本周完成）

**P0 命令**（10 个）:
- ✅ `/logs`
- ✅ `/restart-service`
- ✅ `/health-check`
- ✅ `/query-db`
- ✅ `/get-token`
- ✅ `/create-test-product`
- ✅ `/create-test-user`
- ✅ `/service-status`
- ✅ `/test-api`
- ✅ `/swagger`

**场景 Skills**（2 个）:
- ✅ `scenarios/frontend-dev`
- ✅ `scenarios/backend-dev`

### Phase 2: 完善（下周）

**P1 命令**（10 个）:
- `/deploy`
- `/db-migrate`
- `/clear-redis`
- `/ecs-status`
- `/workspace-sync`
- `/list-mcp-tools`
- `/call-mcp-tool`
- `/ssh`
- `/get-env`
- `/deploy-status`

**❌ 不再实现服务级别 Skills**：
- 原计划：为每个服务创建 SKILL.md（commerce-backend、user-auth 等）
- **问题**：与各服务自己的 CLAUDE.md 重复，且角色错位
- **解决**：只保留场景 Skills，引用命令提供工作流指导

### Phase 3: 增强（两周后）

**P2 命令**（20+ 个）:
- 性能分析、备份恢复、配置验证等

**可能新增的场景 Skills**（根据实际需求）:
- `scenarios/debugging` - 问题排查场景
- `scenarios/onboarding` - 新人入职场景

## 成功指标

### 使用率
- 每个开发者每天使用命令 10+ 次
- Top 5 命令覆盖 80% 使用场景

### 效率提升
- 查看日志时间：从 2 分钟 → 10 秒
- 获取 Token 时间：从 1 分钟 → 5 秒
- 创建测试数据：从 5 分钟 → 30 秒

### 开发者反馈
- "不用记命令了，直接说需求"
- "Claude 自动判断环境，太智能了"
- "新人第一天就能上手"

---

**下一步**: 实现 Phase 1 的 10 个 P0 命令和 2 个场景 Skills
