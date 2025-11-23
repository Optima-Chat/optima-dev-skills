---
name: "Database Tasks"
description: "数据库操作 - 连接数据库、查询数据、运行迁移，管理数据"
allowed-tools: ["Bash", "SlashCommand"]
---

# 数据库操作

当你需要操作数据库时，使用这个场景。

## 🎯 适用情况

- 查看数据库中的数据
- 验证 API 操作是否正确写入
- 运行数据库迁移
- 调试数据相关问题
- 清理测试数据

## 🚀 快速开始

### 连接数据库

```
/db-connect commerce
```

**自动连接到**：
- CI：PostgreSQL on dev.optima.chat
- Stage：RDS
- Prod：RDS（只读权限）

**进入 psql 后可用命令**：
```sql
\dt              -- 查看所有表
\d products      -- 查看表结构
\q               -- 退出
```

## 📊 常用查询

### 查看商品数据

```sql
-- 查看所有商品
SELECT id, title, price, status FROM products LIMIT 10;

-- 按分类过滤
SELECT id, title, price
FROM products
WHERE collections @> ARRAY['jewelry'];

-- 按状态过滤
SELECT id, title, status
FROM products
WHERE status = 'active';

-- 查看低库存商品
SELECT id, title, stock_quantity
FROM products
WHERE stock_quantity < 10
ORDER BY stock_quantity ASC;
```

### 查看订单数据

```sql
-- 查看所有订单
SELECT id, user_id, total_amount, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;

-- 查看特定用户的订单
SELECT id, total_amount, status, created_at
FROM orders
WHERE user_id = 'user-xxx'
ORDER BY created_at DESC;

-- 查看待发货订单
SELECT id, user_id, total_amount, created_at
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC;

-- 统计今日订单
SELECT
  COUNT(*) as total_orders,
  SUM(total_amount) as total_revenue
FROM orders
WHERE created_at >= CURRENT_DATE;
```

### 查看用户数据

```sql
-- 查看所有用户
SELECT id, email, role, created_at
FROM users
ORDER BY created_at DESC
LIMIT 10;

-- 查看特定角色的用户
SELECT id, email, created_at
FROM users
WHERE role = 'merchant';

-- 查看测试用户
SELECT id, email, role
FROM users
WHERE email LIKE '%test%';
```

### 查看库存数据

```sql
-- 查看所有库存
SELECT product_id, quantity, updated_at
FROM inventory
ORDER BY updated_at DESC
LIMIT 10;

-- 查看低库存告警
SELECT
  p.id,
  p.title,
  i.quantity
FROM products p
JOIN inventory i ON i.product_id = p.id
WHERE i.quantity < 10
ORDER BY i.quantity ASC;
```

## 🔧 数据库迁移

### 查看迁移状态

```bash
# 在 commerce-backend 目录
cd ~/optima/core-services/commerce-backend

# 查看迁移历史
alembic history

# 查看当前版本
alembic current
```

### 创建新迁移

```bash
# 自动生成迁移（基于模型更改）
alembic revision --autogenerate -m "Add collections field to products"

# 手动创建迁移
alembic revision -m "Manual migration"
```

**生成的迁移文件**：
```
alembic/versions/abc123_add_collections_field.py
```

**检查迁移文件**：
```python
def upgrade():
    op.add_column('products', sa.Column('collections', sa.ARRAY(sa.String()), nullable=True))

def downgrade():
    op.drop_column('products', 'collections')
```

### 执行迁移

```bash
# 升级到最新版本
alembic upgrade head

# 升级一个版本
alembic upgrade +1

# 升级到特定版本
alembic upgrade abc123
```

### 回滚迁移

```bash
# 回滚一个版本
alembic downgrade -1

# 回滚到特定版本
alembic downgrade abc123

# 回滚到初始状态
alembic downgrade base
```

## 📋 验证数据操作

### 验证 API 创建的数据

**场景**：前端调用 API 创建商品，验证是否成功写入

```sql
-- 1. 记录创建前的商品数量
SELECT COUNT(*) FROM products;

-- 2. 调用 API 创建商品
-- /test-api /products POST

-- 3. 查看新创建的商品
SELECT id, title, price, created_at
FROM products
ORDER BY created_at DESC
LIMIT 1;

-- 4. 验证数据是否正确
SELECT * FROM products WHERE id = 'xxx';
```

### 验证订单数据完整性

```sql
-- 检查订单和订单项的关联
SELECT
  o.id as order_id,
  o.total_amount,
  COUNT(oi.id) as item_count,
  SUM(oi.quantity * oi.price) as calculated_total
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.total_amount
HAVING o.total_amount != SUM(oi.quantity * oi.price);

-- 如果返回结果，说明订单金额和明细不一致
```

### 验证库存更新

```sql
-- 查看库存历史记录
SELECT
  product_id,
  quantity,
  operation,
  updated_at
FROM inventory_history
WHERE product_id = 'prod-xxx'
ORDER BY updated_at DESC
LIMIT 10;
```

## 🗑️ 清理数据

### 清理测试数据

```sql
-- 删除测试用户
DELETE FROM users WHERE email LIKE '%test%';

-- 删除测试商品
DELETE FROM products WHERE tags @> ARRAY['test-data'];

-- 删除测试订单（级联删除订单项）
DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%test%'
);
```

### 清理特定日期的数据

```sql
-- 删除今天创建的测试数据
DELETE FROM products
WHERE created_at >= CURRENT_DATE
AND tags @> ARRAY['test-data'];
```

### 完全重置数据库

```bash
# ⚠️ 警告：这会删除所有数据
docker compose down -v
docker compose up -d

# 重新运行迁移
docker compose exec commerce-backend alembic upgrade head
```

## 🔍 数据分析查询

### 商品统计

```sql
-- 统计商品总数
SELECT COUNT(*) FROM products;

-- 按状态统计
SELECT status, COUNT(*)
FROM products
GROUP BY status;

-- 按分类统计
SELECT
  unnest(collections) as collection,
  COUNT(*)
FROM products
GROUP BY collection
ORDER BY count DESC;

-- 价格分布
SELECT
  CASE
    WHEN price < 100 THEN '0-100'
    WHEN price < 500 THEN '100-500'
    ELSE '500+'
  END as price_range,
  COUNT(*)
FROM products
GROUP BY price_range;
```

### 订单统计

```sql
-- 今日订单统计
SELECT
  COUNT(*) as order_count,
  SUM(total_amount) as revenue,
  AVG(total_amount) as avg_order_value
FROM orders
WHERE created_at >= CURRENT_DATE;

-- 按状态统计订单
SELECT status, COUNT(*), SUM(total_amount)
FROM orders
GROUP BY status;

-- 热销商品
SELECT
  p.id,
  p.title,
  COUNT(oi.id) as order_count,
  SUM(oi.quantity) as total_sold
FROM products p
JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.title
ORDER BY total_sold DESC
LIMIT 10;
```

### 用户统计

```sql
-- 按角色统计用户
SELECT role, COUNT(*)
FROM users
GROUP BY role;

-- 用户增长趋势
SELECT
  DATE(created_at) as date,
  COUNT(*) as new_users
FROM users
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date;
```

## 🛠️ 性能优化

### 查看慢查询

```sql
-- 查看当前运行的查询
SELECT
  pid,
  query_start,
  state,
  query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start;
```

### 查看表大小

```sql
-- 查看所有表大小
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 查看索引使用情况

```sql
-- 查看索引扫描次数
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- 未使用的索引
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_stat_user_indexes
WHERE idx_scan = 0;
```

### 添加索引

```sql
-- 为常用查询字段添加索引
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_created_at ON products(created_at DESC);

-- 为 JSONB/ARRAY 字段添加 GIN 索引
CREATE INDEX idx_products_collections ON products USING GIN(collections);
CREATE INDEX idx_products_tags ON products USING GIN(tags);

-- 组合索引
CREATE INDEX idx_products_status_created ON products(status, created_at DESC);
```

## ⚠️ 安全注意事项

### CI 环境

- ✅ 可以随意增删改查
- ✅ 可以删除所有数据
- ✅ 可以运行实验性查询

### Stage 环境

- ⚠️ 可以查询数据
- ⚠️ 谨慎修改数据
- ❌ 不要删除大量数据

### Prod 环境

- ✅ 只读查询（使用只读用户）
- ❌ 禁止 INSERT、UPDATE、DELETE
- ❌ 禁止 DROP、TRUNCATE
- ⚠️ 所有生产数据操作需要审批

### 只读用户限制

Prod 环境使用只读用户连接：

```sql
-- 可以执行
SELECT * FROM products;

-- 不能执行
INSERT INTO products ...;  -- ERROR: permission denied
UPDATE products ...;       -- ERROR: permission denied
DELETE FROM products ...;  -- ERROR: permission denied
```

## 🔗 相关命令

- `/db-connect` - 连接数据库
- `/backend-logs` - 查看数据库相关日志
- `/test-api` - 测试 API 并验证数据
- `/create-test-product` - 创建测试数据

## 💡 最佳实践

1. **查询前先 LIMIT** - 避免返回过多数据
2. **修改前先 SELECT** - 确认影响范围
3. **备份重要数据** - 删除前先导出
4. **使用事务** - 复杂操作用 BEGIN/COMMIT
5. **善用 EXPLAIN** - 分析查询性能

```sql
-- 使用事务
BEGIN;
UPDATE products SET price = price * 1.1 WHERE category = 'jewelry';
-- 检查结果
SELECT * FROM products WHERE category = 'jewelry';
-- 如果正确则提交，否则回滚
COMMIT;
-- ROLLBACK;
```
