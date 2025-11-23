---
name: "MCP Host"
description: "Optima MCP 协调器 - AI 对话管理、MCP 工具调度、Progressive Skills 系统、多 LLM 支持（OpenAI/Claude），FastAPI + Prisma，端口 8300/8294"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# MCP Host - MCP 协调器与 AI 对话管理

连接 LLM 和 MCP 工具的中间层，提供 OpenAI 兼容 API 和 Progressive Skills 系统。

## 📦 服务概述

**核心功能**：
- OpenAI 兼容聊天 API
- 多 LLM 支持（OpenAI、Anthropic、本地 Ollama）
- MCP 工具调用管理
- Progressive Skills 系统（9 大技能领域）
- 对话历史存储
- Token 使用统计
- 用户权限管理
- Tool Whitelist（权限控制）

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/mcp-host

**技术栈**:
- Python 3.11+
- FastAPI
- Prisma (ORM)
- PostgreSQL 15
- OpenAI SDK
- Anthropic SDK
- MCP Protocol

**部署地址**:
- **生产环境**: https://mcp.optima.shop (端口 8294)
- **Stage-ECS**: https://host.mcp.stage.optima.onl (端口 8300)
- **本地开发**: http://localhost:8300

**API 文档**:
- Swagger UI: http://localhost:8300/docs
- OpenAPI JSON: http://localhost:8300/openapi.json

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
cd ~/optima/core-services/mcp-host

# 安装 Python 依赖
pip install -r requirements.txt

# 安装 Node.js 依赖（Prisma）
npm install

# 生成 Prisma Client
npx prisma generate

# 配置环境变量
cp .env.example .env

# 启动数据库
docker compose up -d postgres redis

# 运行迁移
npx prisma migrate dev

# 启动服务
uvicorn src.main:app --host 0.0.0.0 --port 8300 --reload
```

## 🤖 Progressive Skills 系统

MCP Host 的核心创新，将电商运营能力模块化为 9 大技能领域：

### 技能列表

1. **store-setup** - 店铺设置（商家信息、Homepage 配置）
2. **product-catalog** - 产品目录（商品 CRUD、分类、标签）
3. **product-sourcing** - 产品选品（Optima Scout 集成）
4. **order-processing** - 订单处理（发货、完成、取消）
5. **inventory-logistics** - 库存物流（库存更新、物流计算）
6. **advertising-campaigns** - 广告投放（Google Ads 集成）
7. **market-intelligence** - 市场情报（Perplexity 搜索）
8. **visual-content** - 视觉内容（ComfyUI 图像生成）
9. **workspace-operations** - 工作空间操作（文件管理）

### Tool Whitelist（权限控制）

每个技能精细定义可访问的 MCP 工具，防止误用和越权：

**示例**（product-catalog）:
- ✅ 允许：`create_product`, `update_product`, `list_products`
- ❌ 禁止：`delete_order`, `ship_order`（属于 order-processing）

### Skills 存储位置

```
src/skills/
├── store-setup.md
├── product-catalog.md
├── product-sourcing.md
├── order-processing.md
├── inventory-logistics.md
├── advertising-campaigns.md
├── market-intelligence.md
├── visual-content.md
└── workspace-operations.md
```

## 📖 核心 API 端点

### OpenAI 兼容接口

```
POST   /v1/chat/completions    # 对话完成（兼容 OpenAI API）
DELETE /v1/chat/completions/{request_id}  # 取消请求
GET    /v1/chat/completions/{request_id}/status  # 请求状态
```

**请求示例**:
```bash
curl -X POST http://localhost:8300/v1/chat/completions \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "帮我上架新商品"}
    ],
    "tools": []  # 自动加载相关 MCP 工具
  }'
```

### MCP 管理

```
GET    /mcp/servers            # MCP 服务器列表
POST   /mcp/servers            # 添加 MCP 服务器
DELETE /mcp/servers/{name}     # 删除 MCP 服务器
GET    /mcp/tools              # 可用工具列表
POST   /mcp/tools/call         # 直接调用工具（测试用）
```

### 用户配置

```
GET    /users/me               # 用户信息及权限
GET    /user/mcp-config        # 用户 MCP 配置
POST   /user/mcp-config/{server_name}  # 配置 MCP 服务器
DELETE /user/mcp-config/{server_name}  # 删除配置
```

### 对话管理

```
GET    /conversations          # 对话列表
GET    /conversations/{id}     # 对话详情
DELETE /conversations/{id}     # 删除对话
GET    /conversations/{id}/messages  # 对话消息历史
```

### Token 统计

```
GET    /token-usage            # Token 使用统计
GET    /token-usage/{conversation_id}  # 特定对话统计
```

## 🗄️ 数据库

### 连接信息

**生产环境**:
- 数据库名: `optima_mcp`
- 用户: `mcp_user`
- 主机: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- 端口: 5432

**Stage 环境**:
- 数据库名: `optima_stage_mcp`
- 用户: `mcp_stage_user`

**本地开发**:
- Docker Compose PostgreSQL
- 端口: 8310

### Prisma Schema

**核心模型**:
- `User` - 用户信息
- `Conversation` - 对话记录
- `Message` - 消息历史
- `MCPServer` - MCP 服务器配置
- `ToolCall` - 工具调用记录
- `TokenUsage` - Token 使用统计

### 数据库迁移

```bash
# 创建迁移
npx prisma migrate dev --name add_token_usage

# 应用迁移
npx prisma migrate deploy

# 重置数据库（开发环境）
npx prisma migrate reset
```

## 🔧 MCP 工具配置

### 注册 MCP 服务器

MCP Host 通过配置连接到各个 MCP 工具服务器：

**配置文件**: `.mcp_servers.json`

```json
{
  "commerce-mcp": {
    "url": "http://localhost:8201/sse",
    "description": "电商操作工具"
  },
  "scout-mcp": {
    "url": "http://localhost:7291/sse",
    "description": "智能选品工具"
  },
  "comfy-mcp": {
    "url": "http://localhost:8220/sse",
    "description": "图像生成工具"
  }
}
```

**动态注册**（通过 API）:
```bash
curl -X POST http://localhost:8300/mcp/servers \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "commerce-mcp",
    "url": "http://localhost:8201/sse",
    "description": "电商操作工具"
  }'
```

## 🛠️ 常用操作

### 查看已注册的 MCP 工具

```bash
curl -X GET http://localhost:8300/mcp/tools \
  -H "Authorization: Bearer your_jwt_token"
```

### 测试工具调用

```bash
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "list_products",
    "arguments": {
      "limit": 10
    }
  }'
```

### 查看 Token 使用情况

```bash
curl -X GET http://localhost:8300/token-usage \
  -H "Authorization: Bearer your_jwt_token"
```

### 查看对话历史

```bash
curl -X GET http://localhost:8300/conversations \
  -H "Authorization: Bearer your_jwt_token"
```

### 查看日志

**生产环境**:
```bash
docker logs -f optima-mcp-host-prod --tail 100
```

**Stage-ECS**:
```bash
aws logs tail /ecs/mcp-host-stage --follow
```

**本地开发**:
```bash
docker compose logs -f
```

## 🔒 认证配置

### JWT Token

MCP Host 使用 User Auth 服务签发的 JWT Token：

```bash
# 获取 Token
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}'

# 使用 Token
curl -X POST http://localhost:8300/v1/chat/completions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[...]}'
```

### LLM API Keys

**环境变量**:
- `OPENAI_API_KEY` - OpenAI API 密钥
- `ANTHROPIC_API_KEY` - Anthropic API 密钥

**获取方式**:
- 开发环境：`.env.example`
- 生产环境：Infisical `/prod/mcp-host/OPENAI_API_KEY`

## 📁 项目结构

```
src/
├── llm/                    # LLM 适配器
│   ├── openai_adapter.py   # OpenAI 集成
│   ├── anthropic_adapter.py  # Anthropic 集成
│   └── local_adapter.py    # 本地 Ollama
├── mcp/                    # MCP 客户端
│   ├── client.py           # MCP 协议客户端
│   ├── manager.py          # MCP 服务器管理
│   └── tool_executor.py    # 工具执行器
├── skills/                 # Progressive Skills
│   ├── store-setup.md
│   ├── product-catalog.md
│   └── ...
├── core/                   # 核心业务逻辑
│   ├── conversation.py     # 对话管理
│   ├── token_tracker.py    # Token 统计
│   └── permissions.py      # 权限控制
├── api/                    # REST API 端点
│   ├── chat.py             # /v1/chat/completions
│   ├── mcp.py              # /mcp/*
│   └── users.py            # /users/*
└── main.py                 # FastAPI 应用入口
```

## 🐛 故障排查

### 常见错误

**1. MCP 工具连接失败**
```
Error: Failed to connect to MCP server
```
- 检查 MCP 服务器是否运行
- 验证 URL 配置：`http://localhost:8201/sse`
- 查看 MCP 服务器日志

**2. Token 验证失败**
```
Error: Invalid JWT token
```
- 检查 Token 是否过期
- 验证 `JWT_SECRET_KEY` 与 User Auth 一致
- 确认 Token 格式：`Authorization: Bearer {token}`

**3. LLM API 调用失败**
```
Error: OpenAI API key not found
```
- 检查环境变量 `OPENAI_API_KEY`
- 验证 API 配额和余额
- 查看 OpenAI 状态页面

**4. 数据库连接失败**
```
Error: Prisma Client initialization failed
```
- 运行 `npx prisma generate`
- 检查 `DATABASE_URL` 配置
- 确保数据库已迁移：`npx prisma migrate deploy`

## 🔗 相关服务

**依赖服务**:
- User Auth - JWT 认证
- PostgreSQL - 对话和配置存储
- Redis - 缓存和会话
- OpenAI/Anthropic - LLM 服务

**MCP 工具服务器**:
- Commerce MCP - 电商操作（21 个工具）
- Scout MCP - 智能选品（3 个工具）
- Comfy MCP - 图像生成（3 个工具）
- Google Ads MCP - 广告管理（16 个工具）
- Fetch MCP - 网页抓取（5 个工具）
- Perplexity MCP - AI 搜索（5 个工具）

**被调用方**:
- Agentic Chat - 卖家对话界面
- API 调用方 - 任何支持 OpenAI SDK 的客户端

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/mcp-host/blob/main/README.md
- **API 文档**: http://localhost:8300/docs
- **MCP 协议**: https://modelcontextprotocol.io/
- **OpenAI API**: https://platform.openai.com/docs/api-reference
- **Progressive Skills 设计**: 见 PR #99（Token Tracking System）
