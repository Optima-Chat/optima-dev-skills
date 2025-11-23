---
name: "Preparing Test Data"
description: "准备测试数据 - 创建测试用户、商品、订单，快速搭建测试环境"
allowed-tools: ["Bash", "SlashCommand"]
---

# 准备测试数据

当你需要测试数据时，使用这个场景。

## 🎯 适用情况

- CI 环境数据库是空的，需要测试数据
- 测试前端功能，需要商品、订单数据
- 测试 API，需要用户、商家账户
- 演示功能，需要完整的测试场景

## 🚀 快速开始

### 场景 1：前端开发测试数据

```
# 1. 创建商家和商品
/create-test-user merchant@test.com merchant
/create-test-product 20

# 2. 创建买家
/create-test-user buyer@test.com user

# 完成！现在有：
# - 1 个商家账户
# - 20 个测试商品
# - 1 个买家账户
```

### 场景 2：电商完整流程测试

```
# 1. 创建商家和商品
/create-test-user merchant@shop.com merchant
/create-test-product 10

# 2. 创建多个买家
/create-test-user buyer1@test.com user
/create-test-user buyer2@test.com user

# 3. 获取买家 Token 并创建订单
/get-token buyer1@test.com
/test-api /public/checkout POST

# 完成！可以测试完整的购买流程
```

### 场景 3：API 开发测试

```
# 只需要几个商品测试 API
/create-test-product 5

# 获取 Token 测试
/get-token merchant@optima.ai
/test-api /products GET
```

## 📋 命令详解

### 1. 创建测试用户

```
/create-test-user [email] [role]
```

**参数**：
- `email` - 用户邮箱（可选，默认自动生成）
- `role` - 用户角色：
  - `user` - 普通用户（默认）
  - `merchant` - 商家
  - `admin` - 管理员

**示例**：
```
# 创建普通用户
/create-test-user

# 创建商家
/create-test-user myshop@test.com merchant

# 创建管理员
/create-test-user admin@test.com admin
```

**返回信息**：
- 用户 ID
- 邮箱和密码
- 自动获取的 Token

### 2. 创建测试商品

```
/create-test-product [count] [merchant_id]
```

**参数**：
- `count` - 创建数量（默认 1）
- `merchant_id` - 商家 ID（默认当前用户）

**示例**：
```
# 创建 1 个测试商品
/create-test-product

# 创建 20 个测试商品
/create-test-product 20

# 为特定商家创建商品
/create-test-product 10 merchant-abc-123
```

**自动生成内容**：
- 商品标题（随机生成）
- 价格（$50-500）
- 描述
- 库存数量
- 分类和标签

### 3. 批量创建用户

```bash
# 创建 5 个普通用户
for i in {1..5}; do
  /create-test-user user$i@test.com user
done

# 创建 3 个商家
for i in {1..3}; do
  /create-test-user shop$i@test.com merchant
done
```

## 💡 常见测试场景

### 场景 A：测试商品列表页

**需求**：至少 20 个商品，不同分类

```
/create-test-product 20
```

**自动创建**：
- 珠宝类商品
- 服装类商品
- 配饰类商品
- 不同价格范围

### 场景 B：测试用户权限

**需求**：不同角色的用户

```
# 普通用户（只能浏览、下单）
/create-test-user buyer@test.com user

# 商家（可以管理商品、订单）
/create-test-user seller@test.com merchant

# 管理员（可以管理所有）
/create-test-user admin@test.com admin
```

**测试步骤**：
1. 用普通用户登录，尝试创建商品 → 应该返回 403
2. 用商家登录，创建商品 → 应该成功
3. 用管理员登录，查看所有用户 → 应该成功

### 场景 C：测试订单流程

**需求**：商品、买家、商家

```
# 1. 创建商家和商品
/create-test-user shop@test.com merchant
/create-test-product 10

# 2. 创建买家
/create-test-user buyer@test.com user

# 3. 买家登录并创建订单
/get-token buyer@test.com
/test-api /public/checkout POST '{
  "items": [
    {"product_id": "xxx", "quantity": 2}
  ]
}'

# 4. 商家查看订单
/get-token shop@test.com
/test-api /orders/merchant GET
```

### 场景 D：测试搜索和过滤

**需求**：多样化的商品数据

```
/create-test-product 50
```

**测试**：
```
# 按分类过滤
/test-api "/products?collections=jewelry" GET

# 按标签过滤
/test-api "/products?tags=featured" GET

# 价格范围过滤
/test-api "/products?min_price=100&max_price=500" GET
```

## 🗄️ 查看和管理测试数据

### 查看创建的数据

```
# 连接数据库查看
/query-db commerce

# 查看用户
SELECT id, email, role FROM users WHERE email LIKE '%test%';

# 查看商品
SELECT id, title, price FROM products WHERE tags @> ARRAY['test-data'];

# 查看订单
SELECT id, user_id, total_amount, status FROM orders;
```

### 清理测试数据

```
# 连接数据库
/query-db commerce

# 删除测试用户
DELETE FROM users WHERE email LIKE '%test%';

# 删除测试商品
DELETE FROM products WHERE tags @> ARRAY['test-data'];

# 或者完全重置数据库
docker compose down -v
docker compose up -d
docker compose exec commerce-backend alembic upgrade head
```

## 📊 预置测试账户

**CI 环境已有的测试账户**：

| 邮箱 | 密码 | 角色 | 用途 |
|------|------|------|------|
| test@optima.ai | test123 | user | 普通用户测试 |
| merchant@optima.ai | merchant123 | merchant | 商家功能测试 |
| admin@optima.ai | admin123 | admin | 管理员功能测试 |

**使用方式**：
```
/get-token test@optima.ai      # 普通用户
/get-token merchant@optima.ai  # 商家
/get-token admin@optima.ai     # 管理员
```

## ⚠️ 注意事项

### 1. 环境隔离

- **CI 环境**：随意创建、删除测试数据
- **Stage 环境**：可以创建测试数据，但要标记清楚
- **Prod 环境**：⚠️ **禁止**创建测试数据

### 2. 数据标记

创建的测试数据应该包含标识：
- 用户邮箱包含 `test` 关键字
- 商品标签包含 `test-data`
- 方便后续清理

### 3. 密码安全

测试账户使用简单密码（如 `test123`），**不要用于生产环境**。

### 4. 数据量控制

- CI 环境：创建少量数据即可（10-50 个商品）
- 性能测试：需要大量数据时，使用脚本批量创建
- 避免创建过多数据导致数据库膨胀

## 🔧 高级用法

### 创建特定类型的商品

```bash
# 创建高价商品（用于测试支付）
/test-api /products POST '{
  "title": "Luxury Diamond Necklace",
  "price": 5999.00,
  "stock_quantity": 5,
  "tags": ["luxury", "test-data"]
}'

# 创建低库存商品（用于测试库存告警）
/test-api /products POST '{
  "title": "Limited Edition Earrings",
  "price": 299.00,
  "stock_quantity": 2,
  "tags": ["limited", "test-data"]
}'
```

### 创建复杂订单数据

```bash
# 包含多个商品的订单
/test-api /public/checkout POST '{
  "items": [
    {"product_id": "prod-1", "quantity": 2},
    {"product_id": "prod-2", "quantity": 1},
    {"product_id": "prod-3", "quantity": 5}
  ],
  "shipping_address": {
    "street": "123 Test St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102"
  }
}'
```

## 🔗 相关命令

- `/create-test-user` - 创建测试用户
- `/create-test-product` - 创建测试商品
- `/get-token` - 获取用户 Token
- `/test-api` - 测试 API
- `/query-db` - 查看数据库数据

## 💡 最佳实践

1. **按需创建** - 不要一次创建过多数据
2. **及时清理** - 定期清理不用的测试数据
3. **数据真实** - 测试数据应尽量模拟真实场景
4. **环境隔离** - 测试数据只在 CI/Stage，不要污染 Prod
5. **文档记录** - 如果创建了特殊测试数据，记录下来方便团队使用
