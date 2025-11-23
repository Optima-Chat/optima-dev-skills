# /swagger - 打开 Swagger API 文档

快速打开服务的 Swagger UI 文档。

## 使用场景

**前端开发者**: 查看 API 端点、请求参数、响应格式
**后端开发者**: 验证 API 文档、测试端点
**新人**: 了解系统 API 结构

## 用法

/swagger [service] [environment]

## 参数

- `service` (可选): 服务名称
  - `commerce-backend` - Commerce Backend API（默认）
  - `user-auth` - User Auth API
  - `mcp-host` - MCP Host API
  - `all` - 显示所有服务的 Swagger 链接
- `environment` (可选): 环境（local/stage/prod），默认 local

## 执行逻辑

1. 识别目标服务和环境
2. 生成 Swagger UI URL
3. 如果可能，自动在浏览器打开
4. 否则，返回 URL 供手动访问

## Swagger 文档地址

### 本地环境

| 服务 | Swagger UI | OpenAPI JSON |
|------|-----------|--------------|
| Commerce Backend | http://localhost:8280/docs | http://localhost:8280/openapi.json |
| User Auth | http://localhost:8290/docs | http://localhost:8290/openapi.json |
| MCP Host | http://localhost:8300/docs | http://localhost:8300/openapi.json |
| Commerce MCP | http://localhost:8230/docs | http://localhost:8230/openapi.json |
| Scout MCP | http://localhost:8250/docs | http://localhost:8250/openapi.json |
| Comfy MCP | http://localhost:8220/docs | http://localhost:8220/openapi.json |
| Google Ads MCP | http://localhost:8240/docs | http://localhost:8240/openapi.json |

### Stage-ECS

| 服务 | Swagger UI | OpenAPI JSON |
|------|-----------|--------------|
| Commerce Backend | https://api.stage.optima.onl/docs | https://api.stage.optima.onl/openapi.json |
| User Auth | https://auth.stage.optima.onl/docs | https://auth.stage.optima.onl/openapi.json |
| MCP Host | https://mcp.stage.optima.onl/docs | https://mcp.stage.optima.onl/openapi.json |

### Prod

| 服务 | Swagger UI | OpenAPI JSON |
|------|-----------|--------------|
| Commerce Backend | https://api.optima.shop/docs | https://api.optima.shop/openapi.json |
| User Auth | https://auth.optima.shop/docs | https://auth.optima.shop/openapi.json |
| MCP Host | https://mcp.optima.shop/docs | https://mcp.optima.shop/openapi.json |

## 命令示例

### 打开 Commerce Backend Swagger

```bash
# 方法 1: 直接在浏览器打开（macOS）
open http://localhost:8280/docs

# 方法 2: 直接在浏览器打开（Linux）
xdg-open http://localhost:8280/docs

# 方法 3: 返回 URL
echo "Swagger UI: http://localhost:8280/docs"
```

### 打开 User Auth Swagger

```bash
open http://localhost:8290/docs
```

### 打开 MCP Host Swagger

```bash
open http://localhost:8300/docs
```

### Stage 环境

```bash
open https://api.stage.optima.onl/docs
```

### Prod 环境

```bash
open https://api.optima.shop/docs
```

## 预期输出

### 单个服务

```
📚 Swagger API 文档 - Commerce Backend

🌐 环境: local
📖 Swagger UI: http://localhost:8280/docs
📄 OpenAPI JSON: http://localhost:8280/openapi.json

🚀 正在浏览器中打开...

✅ Swagger UI 已在浏览器打开

💡 使用提示:
- 点击端点查看详细信息
- 使用 "Try it out" 直接测试 API
- 需要认证的端点，点击 "Authorize" 输入 Token
```

### 所有服务

```
📚 Swagger API 文档 - 所有服务

🌐 环境: local

┌──────────────────────┬────────────────────────────────────────────┐
│ 服务                 │ Swagger UI                                 │
├──────────────────────┼────────────────────────────────────────────┤
│ Commerce Backend     │ http://localhost:8280/docs                 │
│ User Auth            │ http://localhost:8290/docs                 │
│ MCP Host             │ http://localhost:8300/docs                 │
│ Commerce MCP         │ http://localhost:8230/docs                 │
│ Scout MCP            │ http://localhost:8250/docs                 │
│ Comfy MCP            │ http://localhost:8220/docs                 │
│ Google Ads MCP       │ http://localhost:8240/docs                 │
└──────────────────────┴────────────────────────────────────────────┘

💡 选择要打开的服务:
- /swagger commerce-backend
- /swagger user-auth
- /swagger mcp-host
```

## Swagger UI 使用技巧

### 1. 认证设置

对于需要认证的 API:

1. 点击右上角 "Authorize" 按钮
2. 输入 JWT Token:
   - 格式: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - 或直接输入: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (Swagger 会自动添加 Bearer)
3. 点击 "Authorize"
4. 点击 "Close"

### 2. 测试 API

1. 选择一个端点（如 GET /products）
2. 点击 "Try it out"
3. 填写参数（如果需要）
4. 点击 "Execute"
5. 查看响应结果

### 3. 查看 Schema

- 点击端点下方的 "Schema" 查看数据模型
- 点击模型名称查看详细字段定义

### 4. 下载 OpenAPI 规范

```bash
# 下载 OpenAPI JSON
curl http://localhost:8280/openapi.json > commerce-backend-openapi.json

# 生成客户端代码（使用 OpenAPI Generator）
openapi-generator-cli generate \
  -i http://localhost:8280/openapi.json \
  -g typescript-axios \
  -o ./generated-client
```

## Commerce Backend API 概览

### 核心端点分组

**Products (商品)**:
- GET /products - 商品列表
- GET /products/{id} - 商品详情
- POST /products - 创建商品
- PUT /products/{id} - 更新商品
- DELETE /products/{id} - 删除商品

**Orders (订单)**:
- GET /orders/merchant - 商家订单列表
- GET /orders/merchant/{id} - 订单详情
- POST /orders/merchant/{id}/ship - 发货
- POST /orders/merchant/{id}/complete - 完成订单

**Inventory (库存)**:
- GET /inventory/{product_id} - 查询库存
- POST /inventory/update - 更新库存
- GET /inventory/low-stock - 低库存商品

**Shipping (物流)**:
- POST /shipping/calculate - 计算运费
- POST /shipping/create - 创建运单
- GET /shipping/track/{tracking_number} - 物流跟踪

**Homepage (首页配置)**:
- GET /homepage/config - 获取配置
- POST /homepage/sections - 创建 Section
- PUT /homepage/sections/{id} - 更新 Section

**Public (公开 API)**:
- GET /public/products - 公开商品列表
- GET /public/products/{id} - 公开商品详情
- POST /public/checkout - 创建结账会话

## User Auth API 概览

### 核心端点分组

**Authentication (认证)**:
- POST /auth/login - 登录
- POST /auth/register - 注册
- POST /auth/refresh - 刷新 Token
- POST /auth/logout - 登出

**Users (用户)**:
- GET /users/me - 当前用户信息
- PUT /users/me - 更新用户信息
- DELETE /users/me - 删除账户

**OAuth (第三方登录)**:
- GET /oauth/authorize/{provider} - OAuth 授权
- GET /oauth/callback/{provider} - OAuth 回调

**Admin (管理)**:
- GET /admin/users - 所有用户
- POST /admin/users - 创建用户
- PUT /admin/users/{id} - 更新用户
- DELETE /admin/users/{id} - 删除用户

## MCP Host API 概览

### 核心端点分组

**Tools (工具)**:
- GET /mcp/tools/list - 所有 MCP 工具
- POST /mcp/tools/call - 调用 MCP 工具

**Skills (技能)**:
- GET /skills/domains - 所有技能域
- GET /skills/{domain}/metadata - 技能元数据

**Chat (对话)**:
- POST /chat/completions - OpenAI 兼容的聊天接口

## 故障排查

### Swagger UI 无法访问

```
Error: Connection refused
```

- 检查服务是否运行: `/health-check`
- 确认端口号正确
- 查看服务日志: `/logs`

### Swagger UI 显示 "Failed to fetch"

- 检查 CORS 配置
- 确认 OpenAPI JSON 可访问
- 查看浏览器控制台错误

### 浏览器无法打开

- 手动复制 URL 到浏览器
- 检查默认浏览器设置
- 使用 curl 测试 URL 可访问性

## 相关命令

- /test-api - 测试 API 端点
- /get-token - 获取认证 Token
- /health-check - 检查服务状态
- /logs - 查看服务日志
