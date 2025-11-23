---
name: "Optima Core"
description: "Optima AI 开发团队核心索引 - 系统架构总览、服务快速链接、环境配置、团队规范"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# Optima 开发核心信息

Optima AI 开发团队的核心索引，提供系统架构总览、服务快速链接、常用命令和团队规范。

## 🏗️ 系统架构总览

Optima Commerce 是 AI 驱动的对话式电商平台，采用微服务架构，包含 6 层：

1. **用户交互层** - Agentic Chat（卖家）、Optima Store（买家）
2. **服务协调层** - MCP Host（AI 对话管理 + MCP 工具调度）
3. **MCP 工具层** - Commerce MCP、Scout MCP、Comfy MCP、Google Ads MCP
4. **业务服务层** - Commerce Backend、User Auth
5. **基础设施层** - Terraform、Docker、AWS
6. **数据存储层** - PostgreSQL、Redis、MinIO/S3

详细架构图见：https://github.com/Optima-Chat/optima-docs/blob/main/OPTIMA_COMMERCE_ARCHITECTURE.md

## 🌐 环境和域名

### Prod 环境（生产）

| 服务 | 域名 | 端口 | 容器名 |
|------|------|------|--------|
| **User Auth** | https://auth.optima.shop | 8292 | optima-user-auth-prod |
| **Commerce Backend** | https://api.optima.shop | 8293 | optima-commerce-backend-prod |
| **MCP Host** | https://mcp.optima.shop | 8294 | optima-mcp-host-prod |
| **Agentic Chat** | https://ai.optima.shop | 8296 | optima-agentic-chat-prod |
| **Optima Store** | https://go.optima.shop | Vercel | - |

**MCP 工具服务**：

| 服务 | 域名 | 端口 |
|------|------|------|
| Fetch MCP | https://mcp-fetch.optima.shop | 8250 |
| Comfy MCP | https://mcp-comfy.optima.shop | 8261 |
| Research MCP | https://mcp-research.optima.shop | 8220 |
| Commerce MCP | https://mcp-commerce.optima.shop | 8270 |
| Google Ads MCP | https://mcp-ads.optima.shop | 8240 |

### Stage-ECS 环境（预生产）

| 服务 | 域名 | 容器端口 |
|------|------|---------|
| **User Auth** | https://auth.stage.optima.onl | 8000 |
| **Commerce Backend** | https://api.stage.optima.onl | 8200 |
| **MCP Host** | https://host.mcp.stage.optima.onl | 8300 |
| **Agentic Chat** | https://ai.stage.optima.onl | 3000 |

## 📖 API 文档快速链接

| 服务 | Swagger 文档 | 说明 |
|------|-------------|------|
| Commerce Backend | http://dev.optima.chat:8280/docs | 电商核心 API |
| User Auth | http://dev.optima.chat:8292/docs | 认证授权 API |
| MCP Host | http://dev.optima.chat:8300/docs | MCP 协调器 API |
| Commerce MCP | http://dev.optima.chat:8201/docs | 电商 MCP 工具 |
| Google Ads MCP | http://dev.optima.chat:8240/docs | Google Ads 工具 |

## 🗄️ 数据库和缓存

### PostgreSQL（RDS）

**主机**: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
**端口**: 5432

**数据库隔离**：
- Prod: `optima_auth`, `optima_mcp`, `optima_commerce`, `optima_chat`
- Stage: `optima_stage_auth`, `optima_stage_mcp`, `optima_stage_commerce`

**连接方式**：
- 本地开发：通过 SSH 隧道
- 服务器：直接连接（安全组限制）
- 获取密码：Infisical 或联系管理员

### Redis（ElastiCache）

**隔离策略**：
- Prod: Database 0, 1
- Stage: Database 2
- Stage-ECS: Database 3

### MinIO/S3

**生产环境**：
- 通用存储：`optima-prod-storage-96akxv1h`
- 商品资源：`optima-prod-commerce-assets`

**本地开发**：
- 端点：localhost:8283
- 访问密钥：见仓库 `.env.example`

## 🔑 认证和密钥管理

### 获取 API Token

**User Auth Token**：
```bash
# 开发环境
curl -X POST http://dev.optima.chat:8292/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}'

# 生产环境
使用 Infisical 获取
```

**Commerce Backend API Key**：
```bash
# 测试环境
ock_test_xxxxx  # 从 .env 文件获取

# 生产环境
ock_live_xxxxx  # 从 Infisical 获取
```

### Infisical（密钥管理）

**访问地址**: https://secrets.optima.shop:5080
**项目ID**: f2415dc2-f79d-4e41-90bb-cd3d2631ec71
**环境**: prod, staging

**获取密钥**：
```bash
# 通过 optima-ops-cli
optima-ops infisical get COMMERCE_API_KEY

# 或在 Infisical Web UI 查看
```

## 📂 仓库和工作空间

### Optima Workspace（推荐）

克隆并使用 Optima Workspace 管理所有仓库：

```bash
git clone git@github.com:Optima-Chat/optima-workspace.git ~/optima
cd ~/optima
./setup.sh
```

**仓库分组**：
- `core-services/` - 4 个核心后端服务
- `mcp-tools/` - 6 个 MCP 工具
- `cli-tools/` - 8 个 CLI 工具
- `infrastructure/` - Terraform 配置
- `frontend/` - 2 个前端应用
- `documentation/` - 文档项目

### 快速定位项目

| 简称 | 路径 | 说明 |
|------|------|------|
| auth, user-auth | `core-services/user-auth` | 认证服务 |
| commerce, backend | `core-services/commerce-backend` | 电商后端 |
| mcp, mcp-host, host | `core-services/mcp-host` | MCP 协调器 |
| chat, agentic | `core-services/agentic-chat` | 卖家对话界面 |
| store | `frontend/optima-store` | 买家商城 |
| ops, ops-cli | `cli-tools/optima-ops-cli` | 运维 CLI |
| tf, terraform | `infrastructure/optima-terraform` | 基础设施代码 |
| docs | `documentation/optima-docs` | 系统文档 |

## 🛠️ 常用操作

### 查看服务状态

```bash
# 生产环境（SSH 到 EC2）
ssh -i ~/.ssh/optima-ec2-key ec2-user@ec2-prod.optima.shop
docker ps

# Stage-ECS 环境（通过 AWS CLI）
aws ecs list-services --cluster optima-cluster | grep stage
```

### 查看日志

```bash
# Prod（Docker）
docker logs -f optima-commerce-backend-prod --tail 100

# Stage-ECS
aws logs tail /ecs/commerce-backend-stage --follow

# 本地开发
cd ~/optima/core-services/commerce-backend
docker compose logs -f
```

### 健康检查

```bash
# 使用 optima-ops-cli
optima-ops health all

# 手动检查
curl https://api.optima.shop/health
curl https://auth.optima.shop/health
```

## 👥 团队规范

### Git Workflow

**分支策略**：
- `main` - 生产分支，受保护
- `feature/*` - 功能分支
- `fix/*` - 修复分支

**Commit 规范**：遵循 Conventional Commits
- `feat:` - 新功能
- `fix:` - 修复
- `docs:` - 文档
- `refactor:` - 重构
- `chore:` - 杂项

**PR 流程**：
1. 创建 feature 分支
2. 提交 PR 到 main
3. 至少 1 人 Review
4. CI 通过后合并

### 部署流程

**自动部署**：
- Push 到 `main` 分支触发 GitHub Actions
- 自动构建 Docker 镜像
- 通过 CodeDeploy（Prod）或 ECS Update（Stage）部署

**手动部署**：
```bash
gh workflow run deploy-aws-prod.yml
```

### 开发环境

**推荐配置**：
- Node.js 18+
- Python 3.11+
- Docker Desktop
- 设置环境变量：`export OPTIMA_WORKSPACE_ROOT=~/optima`

## 📞 紧急联系

**服务故障**：
1. 查看 CloudWatch 日志
2. 检查 ECS/EC2 实例状态
3. 联系运维团队（微信群）

**数据库问题**：
1. 检查连接数和慢查询
2. 查看 RDS 监控面板
3. 必要时联系 DBA

## 📚 相关文档

- **系统架构**: https://github.com/Optima-Chat/optima-docs/blob/main/OPTIMA_COMMERCE_ARCHITECTURE.md
- **11月研发报告**: https://github.com/Optima-Chat/optima-docs/blob/main/OPTIMA_COMMERCE_NOVEMBER_2025_REPORT.md
- **Optima Workspace**: https://github.com/Optima-Chat/optima-workspace
- **Terraform 文档**: ~/optima/infrastructure/optima-terraform/CLAUDE.md

## 🔍 查询其他 Skills

如需特定服务的详细信息，请查询对应的 Skill：

- 后端服务：`backend/commerce-backend`, `backend/user-auth`, `backend/mcp-host`
- 前端应用：`frontend/agentic-chat`, `frontend/optima-store`
- MCP 工具：`mcp-tools/commerce-mcp`, `mcp-tools/scout-mcp`, `mcp-tools/comfy-mcp`
- 基础设施：`infrastructure/terraform`, `infrastructure/deployment`, `infrastructure/monitoring`
- 入职指南：`onboarding/setup`, `onboarding/testing`, `onboarding/workflows`
