# /create-test-product - 创建测试商品

快速创建测试商品数据，用于前端开发和功能测试。

## 使用场景

**前端开发者**: 需要商品数据测试商品列表、详情页、购物车
**后端开发者**: 测试商品相关 API、搜索、过滤功能
**测试**: 准备测试数据

## 用法

/create-test-product [count] [merchant_id] [environment]

## 参数

- `count` (可选): 创建数量，默认 1
- `merchant_id` (可选): 商家 ID，默认使用当前登录用户
- `environment` (可选): 环境（local/stage），默认 local

## 执行逻辑

1. **自动获取 Token**: 调用 /get-token 获取认证 Token
2. **生成商品数据**: 随机生成商品信息（标题、价格、描述、分类、标签）
3. **调用 API 创建**: POST /products
4. **返回创建结果**: 显示商品 ID、标题、价格

## 命令示例

### 创建单个测试商品

```bash
# 步骤 1: 获取 Token
TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@optima.ai","password":"merchant123"}' \
  | jq -r '.access_token')

# 步骤 2: 创建商品
curl -X POST http://localhost:8280/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pearl Earrings - Elegant Design",
    "price": 299.00,
    "description": "Beautiful freshwater pearl earrings with 925 silver setting. Perfect for weddings and special occasions.",
    "stock_quantity": 50,
    "status": "active",
    "collections": ["jewelry", "new-arrivals"],
    "tags": ["featured", "bestseller"],
    "images": [
      "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800"
    ]
  }'
```

### 批量创建 10 个测试商品

```bash
TOKEN=$(curl -s -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@optima.ai","password":"merchant123"}' \
  | jq -r '.access_token')

# 循环创建 10 个商品
for i in {1..10}; do
  curl -X POST http://localhost:8280/products \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"Test Product $i\",
      \"price\": $((RANDOM % 500 + 50)).99,
      \"description\": \"This is test product number $i\",
      \"stock_quantity\": $((RANDOM % 100 + 10)),
      \"status\": \"active\",
      \"collections\": [\"test\"],
      \"tags\": [\"test-data\"]
    }"
  echo ""
done
```

## 预定义商品模板

### 珠宝类商品

```json
{
  "title": "Pearl Earrings - Classic Style",
  "price": 299.00,
  "description": "Elegant freshwater pearl earrings",
  "stock_quantity": 50,
  "collections": ["jewelry", "earrings"],
  "tags": ["pearl", "elegant", "featured"]
}
```

### 服装类商品

```json
{
  "title": "Summer Dress - Floral Print",
  "price": 89.99,
  "description": "Light and breezy summer dress with floral pattern",
  "stock_quantity": 30,
  "collections": ["clothing", "summer"],
  "tags": ["dress", "summer", "new"]
}
```

### 配饰类商品

```json
{
  "title": "Leather Handbag - Brown",
  "price": 199.00,
  "description": "Genuine leather handbag with multiple compartments",
  "stock_quantity": 20,
  "collections": ["accessories", "bags"],
  "tags": ["leather", "handbag", "bestseller"]
}
```

### 电子产品

```json
{
  "title": "Wireless Earbuds - Pro",
  "price": 149.99,
  "description": "High-quality wireless earbuds with noise cancellation",
  "stock_quantity": 100,
  "collections": ["electronics", "audio"],
  "tags": ["wireless", "tech", "featured"]
}
```

## 预期输出

### 创建单个商品

```
🛍️ 创建测试商品 (本地环境)

✅ 成功创建商品:

ID: 7c88e5a3-1234-5678-90ab-cdef12345678
标题: Pearl Earrings - Elegant Design
价格: $299.00
库存: 50
状态: active
分类: jewelry, new-arrivals
标签: featured, bestseller

🔗 查看商品:
API: http://localhost:8280/products/7c88e5a3-1234-5678-90ab-cdef12345678
店铺: http://localhost:3001/products/7c88e5a3-1234-5678-90ab-cdef12345678
```

### 批量创建 10 个商品

```
🛍️ 批量创建测试商品 (本地环境)

创建数量: 10

✅ 1/10: Test Product 1 - $159.99 (ID: abc-123)
✅ 2/10: Test Product 2 - $289.99 (ID: abc-124)
✅ 3/10: Test Product 3 - $99.99 (ID: abc-125)
✅ 4/10: Test Product 4 - $449.99 (ID: abc-126)
✅ 5/10: Test Product 5 - $199.99 (ID: abc-127)
✅ 6/10: Test Product 6 - $329.99 (ID: abc-128)
✅ 7/10: Test Product 7 - $89.99 (ID: abc-129)
✅ 8/10: Test Product 8 - $259.99 (ID: abc-130)
✅ 9/10: Test Product 9 - $399.99 (ID: abc-131)
✅ 10/10: Test Product 10 - $179.99 (ID: abc-132)

📊 创建完成: 10/10 成功, 0 失败

🔗 查看商品列表:
API: http://localhost:8280/products?tags=test-data
店铺: http://localhost:3001/products?tags=test-data
```

## 高级用法

### 创建带变体的商品（尺寸、颜色）

```bash
curl -X POST http://localhost:8280/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "T-Shirt - Premium Cotton",
    "price": 39.99,
    "description": "High-quality cotton t-shirt",
    "status": "active",
    "collections": ["clothing"],
    "variants": [
      {"size": "S", "color": "White", "stock": 20, "price": 39.99},
      {"size": "M", "color": "White", "stock": 30, "price": 39.99},
      {"size": "L", "color": "White", "stock": 25, "price": 39.99},
      {"size": "S", "color": "Black", "stock": 15, "price": 39.99},
      {"size": "M", "color": "Black", "stock": 25, "price": 39.99},
      {"size": "L", "color": "Black", "stock": 20, "price": 39.99}
    ]
  }'
```

### 创建带多张图片的商品

```bash
curl -X POST http://localhost:8280/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pearl Necklace - 18 inch",
    "price": 599.00,
    "description": "Stunning freshwater pearl necklace",
    "collections": ["jewelry"],
    "images": [
      "https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800",
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800",
      "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800"
    ]
  }'
```

## 清理测试数据

删除所有测试商品:

```bash
# 获取所有测试商品 ID
PRODUCT_IDS=$(curl -s http://localhost:8280/products?tags=test-data \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.products[].id')

# 批量删除
for id in $PRODUCT_IDS; do
  curl -X DELETE http://localhost:8280/products/$id \
    -H "Authorization: Bearer $TOKEN"
done
```

## 故障排查

### 创建失败 - 401 Unauthorized

- Token 可能已过期，重新获取: `/get-token merchant@optima.ai`
- 确认使用的是 merchant 角色用户

### 创建失败 - 403 Forbidden

- 普通用户无法创建商品，需要 merchant 或 admin 角色
- 使用: `/get-token merchant@optima.ai`

### 创建失败 - 422 Validation Error

- 检查必需字段: title, price
- 价格必须大于 0
- 库存数量必须 >= 0

## 相关命令

- /get-token - 获取认证 Token
- /create-test-user - 创建测试用户
- /test-api - 测试商品 API
- /query-db - 查看数据库中的商品数据
