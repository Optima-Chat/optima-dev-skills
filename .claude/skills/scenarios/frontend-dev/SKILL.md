---
name: "Frontend Development"
description: "前端开发场景 - 调试 API、测试数据、日志查看、Token 管理，适用于 optima-store 和 agentic-chat 开发"
allowed-tools: ["Bash", "Read", "SlashCommand"]
---

# Frontend Development - 前端开发场景

当你在开发 **optima-store** 或 **agentic-chat** 时，这个 Skill 提供常用操作和问题解决方案。

## 🎯 适用场景

- 开发 optima-store（电商前端）
- 开发 agentic-chat（AI 对话前端）
- 调试后端 API 集成
- 准备测试数据
- 排查前端-后端集成问题

## 📋 常见任务和解决方案

### 1. API 返回 500 错误

**问题**: 调用 commerce-backend API 返回 500 Internal Server Error

**解决步骤**:

1. **查看后端错误日志**:
   ```
   /backend-logs commerce-backend 100
   ```
   - 查看完整的错误堆栈
   - 定位具体的错误原因（数据库、业务逻辑、第三方 API）

2. **检查数据库数据**:
   ```
   /db-connect commerce
   ```
   - 验证数据是否存在
   - 检查数据格式是否正确
   - 查看关联数据是否缺失

3. **重现问题**:
   ```
   /test-api /products GET
   ```
   - 使用相同参数测试 API
   - 确认是否稳定复现
   - 尝试不同参数组合

4. **查看 API 文档**:
   ```
   /swagger commerce-backend
   ```
   - 确认请求参数格式
   - 检查必需字段
   - 查看响应格式

**常见原因**:
- 数据库中缺少关联数据（如商品的 merchant_id 不存在）
- 请求参数格式错误（JSON 格式、数据类型）
- 第三方服务异常（Stripe、EasyShip）

---

### 2. 需要测试数据

**问题**: 本地数据库是空的，需要商品、订单等测试数据

**解决步骤**:

1. **创建测试用户**:
   ```
   /create-test-user
   ```
   - 创建普通用户（buyer）
   - 创建商家用户（merchant）
   - 获取登录 Token

2. **创建测试商品**:
   ```
   /create-test-product 10
   ```
   - 批量创建 10 个测试商品
   - 自动生成标题、价格、描述
   - 包含不同分类和标签

3. **获取 Token（用于 API 调用）**:
   ```
   /get-token merchant@optima.ai
   ```
   - 获取商家 Token（创建商品、查看订单）
   - 获取普通用户 Token（创建订单）
   - Token 自动保存到 `$OPTIMA_TOKEN`

4. **验证数据**:
   ```
   /test-api /products GET
   ```
   - 查看商品列表
   - 确认数据正确

**快速创建完整测试场景**:
```
# 1. 创建商家和商品
/create-test-user merchant@test.com merchant
/create-test-product 20

# 2. 创建买家
/create-test-user buyer@test.com user

# 3. 获取 Token 测试购买流程
/get-token buyer@test.com
/test-api /public/checkout POST
```

---

### 3. Token 过期或无效

**问题**: API 返回 401 Unauthorized，Token 无效或过期

**解决步骤**:

1. **获取新 Token**:
   ```
   /get-token test@optima.ai
   ```
   - 使用预置测试账户
   - Token 有效期 1 小时
   - 自动保存到环境变量

2. **刷新 Token**:
   - 如果有 Refresh Token，可以刷新而不用重新登录
   - Refresh Token 有效期 7 天

3. **验证 Token**:
   ```
   /test-api /users/me GET
   ```
   - 测试 Token 是否有效
   - 查看当前用户信息

**在前端代码中使用 Token**:

```typescript
// optima-store 示例
const token = localStorage.getItem('optima_token');

fetch('http://localhost:8280/products', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

**常见错误**:
- Token 格式错误（缺少 "Bearer " 前缀）
- Token 已过期（超过 1 小时）
- 使用了错误环境的 Token（Stage Token 用于本地）

---

### 4. 后端服务无响应

**问题**: API 调用超时或连接被拒绝

**解决步骤**:

1. **检查所有服务状态**:
   ```
   /health-check all
   ```
   - 查看 commerce-backend 是否运行
   - 查看 user-auth 是否运行
   - 查看数据库、Redis 是否连接

2. **查看服务详细状态**:
   ```
   /service-status
   ```
   - 表格形式显示所有服务
   - 查看端口、健康检查、资源使用

3. **重启异常服务**:
   ```
   /restart-service commerce-backend
   ```
   - 自动重启服务
   - 等待服务启动（15秒）
   - 自动执行健康检查

4. **查看启动日志**:
   ```
   /backend-logs commerce-backend
   ```
   - 查看服务启动过程
   - 定位启动失败原因

**常见原因**:
- Docker 容器未启动（`docker compose up -d`）
- 端口被占用
- 数据库连接失败
- 环境变量配置错误

---

### 5. CORS 错误

**问题**: 浏览器控制台显示 CORS 错误

```
Access to fetch at 'http://localhost:8280/products' from origin 'http://localhost:3001' has been blocked by CORS policy
```

**解决步骤**:

1. **检查后端 CORS 配置**:
   - Commerce Backend 默认允许 `http://localhost:3000`, `http://localhost:3001`
   - User Auth 默认允许相同的源

2. **查看后端日志**:
   ```
   /backend-logs commerce-backend
   ```
   - 确认请求是否到达后端
   - 查看 CORS 相关日志

3. **临时解决**:
   - 使用浏览器扩展（如 CORS Unblock）
   - 或使用代理（Next.js proxy, Vite proxy）

4. **永久解决**:
   - 修改后端 CORS 配置（`app/main.py`）
   - 添加你的前端 URL 到允许列表

---

### 6. 图片上传失败

**问题**: 商品图片上传失败或无法显示

**解决步骤**:

1. **检查 MinIO 服务**:
   ```
   /health-check
   ```
   - 确认 MinIO 是否运行（端口 8283/8284）
   - 访问 MinIO Console: http://localhost:8284

2. **查看 MinIO 日志**:
   ```
   /backend-logs minio
   ```
   - 查看上传失败原因
   - 检查 bucket 权限

3. **测试图片上传**:
   ```
   /test-api /products POST
   ```
   - 使用外部图片 URL（Unsplash）
   - 验证图片可访问

4. **检查 S3 配置**:
   - 环境变量: `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`
   - Bucket 名称: `commerce`
   - 确认 bucket 为 public-read

**图片 URL 格式**:
```
本地: http://localhost:8284/commerce/products/abc123.jpg
Prod: https://storage.optima.shop/commerce/products/abc123.jpg
```

---

### 7. 订单创建失败

**问题**: 创建订单时返回错误

**解决步骤**:

1. **检查 Stripe 配置**:
   ```
   /backend-logs commerce-backend
   ```
   - 查看 Stripe 相关错误
   - 确认 Stripe API Key 是否配置

2. **使用测试环境**:
   - 本地使用 Stripe Test Mode
   - 测试卡号: `4242 4242 4242 4242`

3. **验证商品数据**:
   ```
   /db-connect commerce
   ```
   ```sql
   SELECT id, title, price, stock_quantity FROM products WHERE id = 'xxx';
   ```
   - 确认商品存在
   - 确认库存充足
   - 确认价格 > 0

4. **测试结账流程**:
   ```
   /test-api /public/checkout POST
   ```
   - 使用测试数据创建订单
   - 查看详细错误信息

---

## 🚀 快速命令速查

### 日常开发

```bash
# 查看所有服务状态
/health-check all

# 查看后端日志
/backend-logs commerce-backend

# 获取 Token
/get-token test@optima.ai

# 测试 API
/test-api /products GET

# 查看 API 文档
/swagger commerce-backend
```

### 准备测试数据

```bash
# 创建测试用户
/create-test-user merchant@test.com merchant

# 创建 20 个测试商品
/create-test-product 20

# 创建买家账户
/create-test-user buyer@test.com user
```

### 故障排查

```bash
# 检查服务状态
/service-status

# 重启服务
/restart-service commerce-backend

# 查看数据库
/db-connect commerce

# 查看详细日志（100 行）
/backend-logs commerce-backend 100
```

---

## 🔗 相关服务和端口

### 后端服务

| 服务 | 本地端口 | Swagger | 用途 |
|------|---------|---------|------|
| Commerce Backend | 8280 | /docs | 商品、订单、库存 API |
| User Auth | 8290 | /docs | 用户认证、OAuth |
| MCP Host | 8300 | /docs | MCP 工具协调 |

### 前端应用

| 应用 | 本地端口 | 说明 |
|------|---------|------|
| optima-store | 3001 | 电商买家前端 |
| agentic-chat | 3000 | AI 对话前端 |

### 基础设施

| 服务 | 本地端口 | Console |
|------|---------|---------|
| PostgreSQL | 8282 | - |
| Redis | 8285 | - |
| MinIO | 8283 | http://localhost:8284 |

---

## 📚 相关文档

- **Commerce Backend API**: `/swagger commerce-backend`
- **User Auth API**: `/swagger user-auth`
- **架构文档**: ~/optima/documentation/optima-docs/OPTIMA_COMMERCE_ARCHITECTURE.md
- **Skills 文档**: skills/backend/commerce-backend/SKILL.md

---

## 💡 开发技巧

### 1. 使用环境变量存储 Token

```bash
# 在 .bashrc 或 .zshrc 中
export OPTIMA_TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}' \
  | jq -r '.access_token')
```

### 2. 快速重启所有服务

```bash
docker compose restart commerce-backend user-auth mcp-host
```

### 3. 清理测试数据

```bash
# 连接数据库
/db-connect commerce

# 删除测试数据
DELETE FROM products WHERE tags @> ARRAY['test-data'];
DELETE FROM users WHERE email LIKE '%test%';
```

### 4. 监控多个服务日志

```bash
docker compose logs -f commerce-backend user-auth mcp-host
```

---

## ❓ 常见问题

**Q: Token 保存在哪里？**
A: `/get-token` 会自动保存到 `$OPTIMA_TOKEN` 环境变量，你也可以手动保存到 localStorage（前端）或 .env 文件（本地开发）。

**Q: 如何在 Stage 环境测试？**
A: 将所有命令的环境参数改为 `stage`，如 `/get-token test@optima.ai stage`

**Q: 如何清理本地数据库？**
A: 使用 `/db-connect commerce`，然后执行 `DELETE` 或 `TRUNCATE` 语句。或者重启 Docker Compose: `docker compose down -v && docker compose up -d`

**Q: 前端如何获取 Token？**
A: 前端应该调用 `POST /auth/login` 获取 Token，然后保存到 localStorage。开发时可以用 `/get-token` 快速获取。

---

**下一步**: 如果遇到无法解决的问题，使用 `/backend-logs` 查看详细日志，或查阅具体服务的 SKILL.md 文档。
