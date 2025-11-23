# /test-api - 测试 API 端点

快速测试 API 端点，自动处理认证和请求格式。

## 使用场景

**前端开发者**: 验证 API 响应格式，调试前端集成
**后端开发者**: 测试 API 功能，验证业务逻辑
**调试**: 快速复现和排查 API 问题

## 用法

/test-api [endpoint] [method] [data]

## 参数

- `endpoint` (必需): API 端点路径
  - `/products` - 商品列表
  - `/products/{id}` - 商品详情
  - `/orders` - 订单列表
  - `/auth/login` - 登录
  - 等等
- `method` (可选): HTTP 方法（GET/POST/PUT/DELETE），默认 GET
- `data` (可选): 请求数据（JSON 格式）

## 执行逻辑

1. **自动识别服务**: 根据端点路径选择正确的 base URL
   - `/products`, `/orders`, `/inventory` → Commerce Backend (8280)
   - `/auth`, `/users`, `/oauth` → User Auth (8290)
   - `/mcp`, `/skills`, `/tools` → MCP Host (8300)

2. **自动添加认证**:
   - 使用环境变量 `$OPTIMA_TOKEN`
   - 如果未设置，自动调用 /get-token

3. **自动选择环境**:
   - 默认本地环境（localhost）
   - 可指定 stage 或 prod

4. **执行请求并格式化输出**

## 命令示例

### GET 请求 - 获取商品列表

```bash
# 自动获取 Token（如果需要）
TOKEN=${OPTIMA_TOKEN:-$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}' \
  | jq -r '.access_token')}

# 调用 API
curl -X GET http://localhost:8280/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### GET 请求 - 获取单个商品

```bash
curl -X GET http://localhost:8280/products/7c88e5a3-1234-5678-90ab-cdef12345678 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### GET 请求 - 带查询参数

```bash
# 商品列表 - 按分类过滤
curl -X GET "http://localhost:8280/products?collections=jewelry&status=active" \
  -H "Authorization: Bearer $TOKEN"

# 商品列表 - 按标签过滤
curl -X GET "http://localhost:8280/products?tags=featured,bestseller&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# 订单列表 - 按状态过滤
curl -X GET "http://localhost:8280/orders/merchant?status=pending" \
  -H "Authorization: Bearer $TOKEN"
```

### POST 请求 - 创建商品

```bash
curl -X POST http://localhost:8280/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pearl Earrings - Classic",
    "price": 299.00,
    "description": "Beautiful pearl earrings",
    "stock_quantity": 50,
    "collections": ["jewelry"],
    "tags": ["featured"]
  }'
```

### PUT 请求 - 更新商品

```bash
curl -X PUT http://localhost:8280/products/7c88e5a3-1234-5678-90ab-cdef12345678 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 349.00,
    "stock_quantity": 40
  }'
```

### DELETE 请求 - 删除商品

```bash
curl -X DELETE http://localhost:8280/products/7c88e5a3-1234-5678-90ab-cdef12345678 \
  -H "Authorization: Bearer $TOKEN"
```

### POST 请求 - 登录（无需 Token）

```bash
# 登录不需要 Token
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@optima.ai",
    "password": "test123"
  }'
```

### POST 请求 - 调用 MCP 工具

```bash
curl -X POST http://localhost:8300/mcp/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "get_products",
    "arguments": {
      "limit": 10,
      "collections": ["jewelry"]
    }
  }'
```

## 预期输出

### 成功响应（商品列表）

```
🔍 测试 API: GET /products

🌐 环境: local (http://localhost:8280)
🔑 认证: ✅ 使用 JWT Token
📤 请求: GET /products?limit=10

⏱️ 响应时间: 45ms
📊 状态码: 200 OK

📦 响应数据:
{
  "products": [
    {
      "id": "7c88e5a3-1234-5678-90ab-cdef12345678",
      "title": "Pearl Earrings - Classic",
      "price": 299.00,
      "status": "active",
      "collections": ["jewelry"],
      "tags": ["featured"],
      "created_at": "2024-11-23T10:00:00Z"
    },
    {
      "id": "abc-456",
      "title": "Pearl Necklace",
      "price": 599.00,
      "status": "active",
      "collections": ["jewelry"],
      "tags": ["bestseller"],
      "created_at": "2024-11-22T15:30:00Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 10
}

✅ 测试成功
```

### 错误响应（401 未授权）

```
🔍 测试 API: GET /products

🌐 环境: local (http://localhost:8280)
🔑 认证: ❌ Token 无效或已过期

⏱️ 响应时间: 12ms
📊 状态码: 401 Unauthorized

❌ 错误信息:
{
  "detail": "Invalid or expired token"
}

💡 建议:
- 重新获取 Token: /get-token
- 检查 Token 是否正确: echo $OPTIMA_TOKEN
```

### 错误响应（422 验证错误）

```
🔍 测试 API: POST /products

🌐 环境: local (http://localhost:8280)
🔑 认证: ✅ 使用 JWT Token
📤 请求: POST /products

⏱️ 响应时间: 23ms
📊 状态码: 422 Unprocessable Entity

❌ 验证错误:
{
  "detail": [
    {
      "loc": ["body", "title"],
      "msg": "field required",
      "type": "value_error.missing"
    },
    {
      "loc": ["body", "price"],
      "msg": "ensure this value is greater than 0",
      "type": "value_error.number.not_gt"
    }
  ]
}

💡 建议:
- 检查必需字段: title, price
- 确保 price > 0
```

## 常用 API 端点速查

### Commerce Backend (端口 8280)

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /products | GET | 是 | 商品列表 |
| /products/{id} | GET | 是 | 商品详情 |
| /products | POST | 是(商家) | 创建商品 |
| /products/{id} | PUT | 是(商家) | 更新商品 |
| /products/{id} | DELETE | 是(商家) | 删除商品 |
| /orders/merchant | GET | 是(商家) | 商家订单列表 |
| /orders/merchant/{id} | GET | 是(商家) | 订单详情 |
| /inventory/{product_id} | GET | 是 | 查询库存 |
| /shipping/calculate | POST | 是 | 计算运费 |
| /public/products | GET | 否 | 公开商品列表 |
| /public/checkout | POST | 否 | 创建结账会话 |

### User Auth (端口 8290)

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /auth/login | POST | 否 | 用户登录 |
| /auth/register | POST | 否 | 用户注册 |
| /auth/refresh | POST | 否 | 刷新 Token |
| /users/me | GET | 是 | 当前用户信息 |
| /users/me | PUT | 是 | 更新用户信息 |
| /oauth/authorize/{provider} | GET | 否 | OAuth 授权 |
| /admin/users | GET | 是(管理员) | 所有用户列表 |

### MCP Host (端口 8300)

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /mcp/tools/list | GET | 是 | 所有 MCP 工具 |
| /mcp/tools/call | POST | 是 | 调用 MCP 工具 |
| /skills/domains | GET | 是 | 所有技能域 |
| /health | GET | 否 | 健康检查 |

## Stage/Prod 环境测试

### Stage-ECS

```bash
# 替换 base URL
curl -X GET https://api.stage.optima.onl/products \
  -H "Authorization: Bearer $OPTIMA_TOKEN"
```

### Prod

```bash
# ⚠️ 谨慎操作生产环境
curl -X GET https://api.optima.shop/products \
  -H "Authorization: Bearer $OPTIMA_TOKEN"
```

## 故障排查

### Token 相关错误

- Token 未设置: `export OPTIMA_TOKEN="your_token"`
- Token 过期: `/get-token` 重新获取
- 权限不足: 使用对应角色的账户（merchant/admin）

### 连接错误

- 服务未运行: `/health-check` 检查状态
- 端口错误: 确认服务端口配置
- 网络问题: 检查防火墙、VPN

### 数据格式错误

- JSON 格式: 使用 `jq` 验证 JSON
- 必需字段: 查看 API 文档确认字段
- 数据类型: 确保类型正确（string/number/boolean）

## 相关命令

- /get-token - 获取认证 Token
- /health-check - 检查服务状态
- /logs - 查看 API 日志
- /swagger - 查看 API 文档
