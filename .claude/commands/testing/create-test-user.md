# /create-test-user - 创建测试用户

快速创建测试用户，用于开发和测试。

## 使用场景

**前端开发者**: 测试用户登录、注册流程
**后端开发者**: 测试用户权限、角色相关功能
**测试**: 准备不同角色的测试账户

## 用法

/create-test-user [email] [role] [environment]

## 参数

- `email` (可选): 用户邮箱，默认自动生成（test-{random}@optima.ai）
- `role` (可选): 用户角色
  - `user` - 普通用户（默认）
  - `merchant` - 商家
  - `admin` - 管理员
- `environment` (可选): 环境（local/stage），默认 local

## 执行逻辑

1. 生成用户信息（邮箱、密码、角色）
2. 调用 User Auth 注册接口
3. 返回用户凭证（邮箱、密码、Token）
4. 自动保存到环境变量（方便后续使用）

## 命令示例

### 创建普通用户

```bash
curl -X POST http://localhost:8290/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@optima.ai",
    "password": "test123456",
    "role": "user",
    "name": "Test User"
  }'
```

**响应**:
```json
{
  "id": "7c88e5a3-1234-5678-90ab-cdef12345678",
  "email": "testuser@optima.ai",
  "role": "user",
  "name": "Test User",
  "created_at": "2024-11-23T10:00:00Z"
}
```

### 创建商家用户

```bash
curl -X POST http://localhost:8290/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "merchant1@optima.ai",
    "password": "merchant123",
    "role": "merchant",
    "name": "Test Merchant",
    "merchant_info": {
      "store_name": "Test Store",
      "description": "A test merchant store"
    }
  }'
```

### 创建管理员用户

```bash
# ⚠️ 注意: 创建管理员需要现有管理员权限

# 步骤 1: 以管理员身份登录
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@optima.ai","password":"admin123"}' \
  | jq -r '.access_token')

# 步骤 2: 创建新管理员
curl -X POST http://localhost:8290/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newadmin@optima.ai",
    "password": "admin123456",
    "role": "admin",
    "name": "New Admin"
  }'
```

### 批量创建 5 个测试用户

```bash
# 创建 5 个普通用户
for i in {1..5}; do
  curl -X POST http://localhost:8290/auth/register \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"user$i@optima.ai\",
      \"password\": \"test123\",
      \"role\": \"user\",
      \"name\": \"Test User $i\"
    }"
  echo ""
done
```

## 预期输出

### 创建单个用户

```
👤 创建测试用户 (本地环境)

✅ 用户创建成功！

📧 邮箱: testuser@optima.ai
🔑 密码: test123456
👔 角色: user
🆔 用户 ID: 7c88e5a3-1234-5678-90ab-cdef12345678

🔐 自动登录获取 Token...
✅ Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

💾 已保存到环境变量: $TEST_USER_TOKEN

📝 后续使用:
# 使用此账户登录
/get-token testuser@optima.ai

# 测试 API
curl -H "Authorization: Bearer $TEST_USER_TOKEN" \
  http://localhost:8280/products
```

### 创建商家用户

```
🏪 创建测试商家 (本地环境)

✅ 商家创建成功！

📧 邮箱: merchant1@optima.ai
🔑 密码: merchant123
👔 角色: merchant
🏬 店铺名: Test Store
🆔 用户 ID: abc-123
🆔 商家 ID: merchant-abc-123

🔐 自动登录获取 Token...
✅ Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

💾 已保存到环境变量: $TEST_MERCHANT_TOKEN

📝 商家功能测试:
# 创建商品
/create-test-product 10 merchant-abc-123

# 查看商家订单
curl -H "Authorization: Bearer $TEST_MERCHANT_TOKEN" \
  http://localhost:8280/orders/merchant
```

### 批量创建用户

```
👥 批量创建测试用户 (本地环境)

创建数量: 5

✅ 1/5: user1@optima.ai (ID: abc-001)
✅ 2/5: user2@optima.ai (ID: abc-002)
✅ 3/5: user3@optima.ai (ID: abc-003)
✅ 4/5: user4@optima.ai (ID: abc-004)
✅ 5/5: user5@optima.ai (ID: abc-005)

📊 创建完成: 5/5 成功, 0 失败

🔑 统一密码: test123

📝 测试使用:
# 登录任意用户
/get-token user1@optima.ai
/get-token user2@optima.ai
```

## 预定义测试账户（本地环境）

| 邮箱 | 密码 | 角色 | 用途 |
|------|------|------|------|
| test@optima.ai | test123 | user | 普通用户功能测试 |
| merchant@optima.ai | merchant123 | merchant | 商家功能测试 |
| admin@optima.ai | admin123 | admin | 管理员功能测试 |

## 用户角色权限

### user (普通用户)

**权限**:
- 浏览商品
- 创建订单
- 查看自己的订单
- 更新个人信息

**限制**:
- 无法创建商品
- 无法查看其他用户订单
- 无法访问管理员功能

### merchant (商家)

**权限**:
- user 的所有权限
- 创建、更新、删除商品
- 查看商家订单
- 管理库存
- 配置店铺信息
- 处理订单（发货、退款）

**限制**:
- 只能管理自己的商品和订单
- 无法访问管理员功能

### admin (管理员)

**权限**:
- merchant 的所有权限
- 查看所有用户
- 创建、更新、删除任何用户
- 查看所有订单
- 系统配置管理
- 查看系统统计数据

## 用户数据示例

### 普通用户数据

```json
{
  "email": "testuser@optima.ai",
  "password": "test123456",
  "role": "user",
  "name": "Test User",
  "phone": "+1-555-0123",
  "address": {
    "street": "123 Test Street",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102",
    "country": "US"
  }
}
```

### 商家用户数据

```json
{
  "email": "merchant1@optima.ai",
  "password": "merchant123",
  "role": "merchant",
  "name": "Test Merchant",
  "merchant_info": {
    "store_name": "Elegant Pearls",
    "description": "Premium pearl jewelry store",
    "business_email": "contact@elegantpearls.com",
    "phone": "+1-555-9999",
    "address": {
      "street": "456 Business Ave",
      "city": "New York",
      "state": "NY",
      "zip": "10001",
      "country": "US"
    }
  }
}
```

## 清理测试数据

删除所有测试用户（需要管理员权限）:

```bash
# 登录管理员
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@optima.ai","password":"admin123"}' \
  | jq -r '.access_token')

# 获取所有测试用户 ID (邮箱包含 test 或 user)
USER_IDS=$(curl -s http://localhost:8290/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq -r '.users[] | select(.email | test("test|user")) | .id')

# 批量删除
for id in $USER_IDS; do
  curl -X DELETE http://localhost:8290/admin/users/$id \
    -H "Authorization: Bearer $ADMIN_TOKEN"
done
```

## 故障排查

### 注册失败 - 409 Conflict

```
Error: Email already exists
```

- 该邮箱已被注册
- 使用不同的邮箱或删除现有用户

### 注册失败 - 422 Validation Error

```
Error: Invalid email format
```

- 检查邮箱格式是否正确
- 密码至少 6 位

### 无法创建管理员 - 403 Forbidden

- 只有现有管理员可以创建新管理员
- 使用管理员账户登录后再创建

## 相关命令

- /get-token - 获取用户 Token
- /create-test-product - 创建测试商品（商家权限）
- /db-connect - 查看数据库中的用户数据
- /test-api - 测试用户相关 API
