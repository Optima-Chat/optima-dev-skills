---
name: "Calling APIs"
description: "了解 API 调用方式 - 获取 Token、查看文档、测试 API，快速集成后端服务"
allowed-tools: ["Bash", "SlashCommand"]
---

# 调用 API

当你需要调用后端 API 时，使用这个场景。

## 🎯 适用情况

- 前端开发需要调用后端 API
- 测试 API 功能是否正常
- 了解 API 参数和响应格式
- 调试 API 集成问题

## 🚀 快速开始（3 步）

### 步骤 1：查看 API 文档

```
/swagger commerce-backend
```

**自动打开 Swagger UI**：
- Stage：https://api.stage.optima.onl/docs
- Prod：https://api.optima.shop/docs

**Swagger UI 功能**：
- 查看所有 API 端点
- 查看请求参数和响应格式
- 直接在浏览器测试 API（Try it out）

### 步骤 2：获取认证 Token

```
/get-token
```

**自动获取并保存 Token**：
- 默认使用测试账户（test@optima.ai）
- Token 自动保存到 `$OPTIMA_TOKEN`
- 有效期 1 小时

**不同角色的 Token**：
```
/get-token test@optima.ai          # 普通用户
/get-token merchant@optima.ai      # 商家用户
/get-token admin@optima.ai         # 管理员
```

### 步骤 3：测试 API

```
/test-api /products GET
```

**自动处理**：
- 自动添加 Authorization header
- 自动选择正确的环境（Stage/Prod）
- 格式化显示响应结果

## 📖 常用 API 端点

### Commerce Backend API

**商品相关**：
```
GET    /products              # 商品列表
GET    /products/{id}         # 商品详情
POST   /products              # 创建商品（需要 merchant 权限）
PUT    /products/{id}         # 更新商品
DELETE /products/{id}         # 删除商品
```

**订单相关**：
```
GET    /orders/merchant       # 商家订单列表
GET    /orders/merchant/{id}  # 订单详情
POST   /orders/merchant/{id}/ship      # 发货
POST   /orders/merchant/{id}/complete  # 完成订单
```

**公开 API（无需认证）**：
```
GET    /public/products       # 公开商品列表
GET    /public/products/{id}  # 公开商品详情
POST   /public/checkout       # 创建结账会话
```

### User Auth API

**认证相关**：
```
POST   /auth/login            # 登录（无需认证）
POST   /auth/register         # 注册（无需认证）
POST   /auth/refresh          # 刷新 Token
GET    /users/me              # 当前用户信息
```

## 💡 实际使用示例

### 示例 1：获取商品列表

```
# 1. 获取 Token
/get-token merchant@optima.ai

# 2. 查看 API 文档
/swagger commerce-backend

# 3. 测试 API
/test-api /products GET
```

**响应示例**：
```json
{
  "products": [
    {
      "id": "abc-123",
      "title": "Pearl Earrings",
      "price": 299.00,
      "status": "active"
    }
  ],
  "total": 1
}
```

### 示例 2：创建商品

```
# 1. 获取商家 Token
/get-token merchant@optima.ai

# 2. 创建商品
/test-api /products POST '{
  "title": "Pearl Necklace",
  "price": 599.00,
  "description": "Beautiful pearl necklace",
  "stock_quantity": 50
}'
```

### 示例 3：带参数的 API 调用

```
# 按分类过滤商品
/test-api "/products?collections=jewelry&status=active" GET

# 分页查询
/test-api "/products?page=1&limit=20" GET
```

## 🔧 在代码中使用 API

### JavaScript/TypeScript（前端）

```typescript
// 1. 保存 Token 到 localStorage
localStorage.setItem('optima_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');

// 2. 调用 API
const response = await fetch('http://localhost:8280/products', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('optima_token')}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

### Python（后端测试）

```python
import requests

# 1. 获取 Token
response = requests.post('http://localhost:8290/auth/login', json={
    'email': 'test@optima.ai',
    'password': 'test123'
})
token = response.json()['access_token']

# 2. 调用 API
headers = {'Authorization': f'Bearer {token}'}
response = requests.get('http://localhost:8280/products', headers=headers)
products = response.json()
```

### cURL（命令行）

```bash
# 1. 获取 Token（使用 /get-token 更简单）
TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}' \
  | jq -r '.access_token')

# 2. 调用 API
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8280/products
```

## ⚠️ 常见错误和解决

### 错误 1：401 Unauthorized

```json
{"detail": "Invalid or expired token"}
```

**原因**：Token 无效或过期

**解决**：
```
/get-token  # 重新获取 Token
```

### 错误 2：403 Forbidden

```json
{"detail": "Insufficient permissions"}
```

**原因**：权限不足（如普通用户尝试创建商品）

**解决**：
```
/get-token merchant@optima.ai  # 使用商家账户
```

### 错误 3：422 Validation Error

```json
{
  "detail": [
    {
      "loc": ["body", "price"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**原因**：请求参数缺失或格式错误

**解决**：
1. 查看 Swagger 文档确认必需字段
2. 检查参数类型（string/number/boolean）

### 错误 4：500 Internal Server Error

```json
{"detail": "Internal server error"}
```

**原因**：后端服务异常

**解决**：
```
/backend-logs commerce-backend 100  # 查看详细错误日志
```

## 🌐 不同环境的 API 地址

### Stage-ECS

| 服务 | 地址 | Swagger |
|------|------|---------|
| Commerce Backend | https://api.stage.optima.onl | /docs |
| User Auth | https://auth.stage.optima.onl | /docs |
| MCP Host | https://mcp.stage.optima.onl | /docs |

### Prod

| 服务 | 地址 | Swagger |
|------|------|---------|
| Commerce Backend | https://api.optima.shop | /docs |
| User Auth | https://auth.optima.shop | /docs |
| MCP Host | https://mcp.optima.shop | /docs |

## 💡 最佳实践

1. **先看文档，再调用** - 用 /swagger 确认 API 格式
2. **使用测试环境** - Stage 测试通过后再上 Prod
3. **保存 Token** - 避免频繁重新获取
4. **错误处理** - 前端代码要处理 401、403、500 等错误
5. **日志排查** - API 出错时，用 /backend-logs 查看详细信息

## 🔗 相关命令

- `/swagger` - 查看 API 文档
- `/get-token` - 获取认证 Token
- `/test-api` - 测试 API 端点
- `/backend-logs` - 查看 API 错误日志
- `/health-check` - 检查 API 服务是否运行

## 📚 API 设计规范

Optima API 遵循 RESTful 设计：
- **GET** - 查询资源
- **POST** - 创建资源
- **PUT** - 更新资源（完整更新）
- **PATCH** - 更新资源（部分更新）
- **DELETE** - 删除资源

响应格式统一为 JSON，状态码遵循 HTTP 标准。
