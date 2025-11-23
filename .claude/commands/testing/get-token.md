# /get-token - 获取 JWT Token

快速获取用户 JWT Token，用于 API 测试和开发。

## 使用场景

**前端开发者**: 测试需要认证的 API 端点
**后端开发者**: 调试权限相关逻辑，测试不同角色的 Token
**API 测试**: 快速获取 Token 进行接口调用

## 用法

/get-token [user] [environment]

## 参数

- `user` (可选): 用户邮箱，默认 `test@optima.ai`
  - `test@optima.ai` - 测试用户（role: user）
  - `merchant@optima.ai` - 测试商家（role: merchant）
  - `admin@optima.ai` - 管理员（role: admin）
  - 或指定其他邮箱
- `environment` (可选): 环境（local/stage/prod），默认 local

## 执行逻辑

1. 识别目标环境和用户
2. 调用 User Auth 登录接口
3. 解析返回的 JWT Token
4. **自动保存到环境变量** `OPTIMA_TOKEN`（方便后续使用）
5. 显示 Token 信息（有效期、角色等）
6. 提供复制命令

## 命令示例

### 本地环境 - 测试用户

```bash
# 获取 Token
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@optima.ai",
    "password": "test123"
  }' | jq -r '.access_token'
```

**响应示例**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3Yzg4ZTVhMy0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6InRlc3RAb3B0aW1hLmFpIiwicm9sZSI6InVzZXIiLCJleHAiOjE3MzI0MDAwMDB9.abc123xyz",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### 本地环境 - 商家用户

```bash
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant@optima.ai",
    "password": "merchant123"
  }' | jq -r '.access_token'
```

### 本地环境 - 管理员

```bash
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@optima.ai",
    "password": "admin123"
  }' | jq -r '.access_token'
```

### Stage-ECS 环境

```bash
curl -X POST https://auth.stage.optima.onl/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@optima.ai",
    "password": "test123"
  }' | jq -r '.access_token'
```

### Prod 环境（使用真实用户）

```bash
# ⚠️ 生产环境不要使用测试账户
curl -X POST https://auth.optima.shop/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-real-email@example.com",
    "password": "your-password"
  }' | jq -r '.access_token'
```

## 预期输出

```
🔑 获取 JWT Token (本地环境)

用户: test@optima.ai
角色: user
环境: local

✅ Token 获取成功！

Access Token:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3Yzg4ZTVhMy0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6InRlc3RAb3B0aW1hLmFpIiwicm9sZSI6InVzZXIiLCJleHAiOjE3MzI0MDAwMDB9.abc123xyz

📋 Token 信息:
- 有效期: 1 小时
- 过期时间: 2024-11-23 18:00:00
- 用户 ID: 7c88e5a3-1234-5678-90ab-cdef12345678
- 角色: user

💾 已自动保存到环境变量: $OPTIMA_TOKEN

📝 后续使用示例:
# 测试 API
curl -H "Authorization: Bearer $OPTIMA_TOKEN" http://localhost:8280/products

# 手动复制 Token
export OPTIMA_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Token 使用示例

### 调用 Commerce Backend API

```bash
# 使用环境变量
curl -H "Authorization: Bearer $OPTIMA_TOKEN" \
  http://localhost:8280/products

# 或直接使用 Token
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:8280/products
```

### 调用 MCP Host API

```bash
curl -H "Authorization: Bearer $OPTIMA_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8300/mcp/tools/call \
  -d '{
    "tool_name": "get_products",
    "arguments": {"limit": 10}
  }'
```

### 在 Postman/Thunder Client 中使用

1. Authorization 类型选择: Bearer Token
2. Token 值粘贴: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## 测试用户账户

### 本地环境预置账户

| 邮箱 | 密码 | 角色 | 用途 |
|------|------|------|------|
| test@optima.ai | test123 | user | 普通用户测试 |
| merchant@optima.ai | merchant123 | merchant | 商家功能测试 |
| admin@optima.ai | admin123 | admin | 管理员功能测试 |

### 创建新测试用户

如果需要创建新的测试用户，使用 `/create-test-user` 命令。

## Token 刷新

当 Access Token 过期时，使用 Refresh Token 获取新 Token:

```bash
curl -X POST http://localhost:8290/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }' | jq -r '.access_token'
```

## 故障排查

### 登录失败 - 401 Unauthorized

```
Error: Invalid email or password
```

- 检查邮箱和密码是否正确
- 确认用户是否已创建（使用 /create-test-user）
- 本地环境: 检查数据库中是否有该用户

### Token 已过期

```
Error: Token expired
```

- Access Token 默认有效期 1 小时
- 使用 Refresh Token 获取新 Token
- 或重新调用 /get-token

### User Auth 服务无法访问

```
Error: Connection refused
```

- 检查 User Auth 是否运行: `/health-check user-auth`
- 查看日志: `/backend-logs user-auth`
- 重启服务: `/restart-service user-auth`

## 相关命令

- /create-test-user - 创建测试用户
- /test-api - 使用 Token 测试 API
- /health-check - 检查 User Auth 服务状态
