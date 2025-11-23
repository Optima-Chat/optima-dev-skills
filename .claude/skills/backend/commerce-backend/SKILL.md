---
name: "Commerce Backend"
description: "Optima 电商核心 API 服务 - 商品管理、订单处理、库存、物流、支付集成，FastAPI + PostgreSQL + S3，端口 8280/8293"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# Commerce Backend - 电商核心 API 服务

Optima Commerce 的核心后端服务，处理所有电商业务逻辑。

## 📦 服务概述

**核心功能**：
- 商品管理（CRUD、图片、变体、分类、标签）
- 订单处理（创建、支付、发货、完成、取消）
- 库存管理（更新、低库存告警、历史记录）
- 物流计算（EasyShip 集成）
- 支付处理（Stripe 集成）
- 商家管理（店铺配置、Homepage 配置）
- 多货币、多语言（I18N）支持

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/commerce-backend

**技术栈**:
- Python 3.11+
- FastAPI
- SQLAlchemy (ORM)
- PostgreSQL 15
- MinIO/S3 (对象存储)
- Stripe (支付)
- EasyShip (物流)

**部署地址**:
- **生产环境**: https://api.optima.shop (端口 8293)
- **Stage-ECS**: https://api.stage.optima.onl (端口 8200)
- **本地开发**: http://localhost:8280

**API 文档**:
- Swagger UI: https://api.optima.shop/docs
- OpenAPI JSON: https://api.optima.shop/openapi.json

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
cd ~/optima/core-services/commerce-backend

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（复制 .env.example）
cp .env.example .env

# 启动数据库和 MinIO
docker compose up -d postgres minio redis

# 运行数据库迁移
alembic upgrade head

# 启动服务
uvicorn app.main:app --host 0.0.0.0 --port 8280 --reload
```

### Docker 开发

```bash
docker compose up
# 服务运行在 http://localhost:8280
```

## 🔑 认证信息

### OAuth 统一认证

Commerce Backend 使用 User Auth 服务的 OAuth 统一认证（JWT Token）。

### 获取 Token

**步骤 1：登录获取 JWT Token**

```bash
# 从 User Auth 服务获取 Token
curl -X POST https://auth.optima.shop/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@optima.ai",
    "password": "test123"
  }'
```

**响应**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

**步骤 2：使用 Token 调用 Commerce Backend API**

```bash
curl -X GET https://api.optima.shop/products \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 开发环境快速获取 Token

```bash
# 本地开发环境
curl -X POST http://localhost:8290/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@optima.ai","password":"test123"}'
```

### Token 刷新

当 Access Token 过期时，使用 Refresh Token 获取新的 Token：

```bash
curl -X POST https://auth.optima.shop/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'
```

## 📖 核心 API 端点

### 商品管理

```
POST   /products              # 创建商品
GET    /products              # 商品列表（支持过滤）
GET    /products/{id}         # 商品详情
PUT    /products/{id}         # 更新商品
DELETE /products/{id}         # 删除商品（软删除）

POST   /products/{id}/images  # 添加商品图片
DELETE /products/{id}/images  # 删除商品图片
```

**过滤参数**:
- `?collections=summer,sale` - 按分类过滤
- `?tags=featured,new` - 按标签过滤
- `?status=active` - 按状态过滤
- `?merchant_id=xxx` - 按商家过滤

### 订单管理

```
# 商家端
GET    /orders/merchant        # 商家订单列表
GET    /orders/merchant/{id}   # 商家订单详情
POST   /orders/merchant/{id}/ship      # 发货
POST   /orders/merchant/{id}/complete  # 完成订单
POST   /orders/merchant/{id}/cancel    # 取消订单

# 公开端点（买家）
POST   /public/checkout        # 创建结账会话（Stripe）
```

### 库存管理

```
GET    /inventory/{product_id}  # 查询库存
POST   /inventory/update        # 更新库存
GET    /inventory/low-stock     # 低库存商品
```

### 物流

```
POST   /shipping/calculate      # 计算运费（EasyShip）
POST   /shipping/create         # 创建运单
GET    /shipping/track/{tracking_number}  # 物流跟踪
```

### Homepage 配置

```
GET    /homepage/config         # 获取 Homepage 配置
POST   /homepage/sections       # 创建 Section
PUT    /homepage/sections/{id}  # 更新 Section
DELETE /homepage/sections/{id}  # 删除 Section
POST   /homepage/sections/reorder  # 重排序
POST   /homepage/settings       # 更新全局设置
```

### 公开 API（无需认证）

```
GET    /public/stores/{merchant_id}           # 店铺信息
GET    /public/products?merchant={merchant_id}  # 商品列表
GET    /public/products/{id}    # 商品详情
POST   /public/checkout         # 创建结账会话
```

## 🗄️ 数据库

### 连接信息

**生产环境**:
- 数据库名: `optima_commerce`
- 用户: `commerce_user`
- 主机: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- 端口: 5432

**Stage 环境**:
- 数据库名: `optima_stage_commerce`
- 用户: `commerce_stage_user`

**本地开发**:
- 使用 Docker Compose 启动的 PostgreSQL
- 端口: 8282

### 数据库迁移

使用 Alembic 管理迁移：

```bash
# 创建新迁移
alembic revision --autogenerate -m "Add collections field"

# 执行迁移
alembic upgrade head

# 回滚
alembic downgrade -1

# 查看迁移历史
alembic history
```

## 📁 项目结构（核心模块）

基于架构文档，Commerce Backend 包含 23 个核心模块：

**核心业务**:
- `app/routes/products.py` - 商品管理
- `app/routes/orders.py` - 订单处理
- `app/routes/inventory.py` - 库存管理
- `app/routes/shipping.py` - 物流计算
- `app/routes/checkout.py` - 结账流程

**支持功能**:
- `app/routes/media.py` - 媒体上传（图片、视频）
- `app/routes/i18n.py` - 国际化翻译
- `app/routes/homepage.py` - Homepage 配置
- `app/routes/cart.py` - 购物车

**第三方集成**:
- `app/services/stripe_service.py` - Stripe 支付
- `app/services/easyship_service.py` - EasyShip 物流
- `app/services/s3_service.py` - MinIO/S3 存储

**数据模型**:
- `app/models/` - SQLAlchemy 模型定义

详细架构文档：~/optima/documentation/optima-docs/OPTIMA_COMMERCE_ARCHITECTURE.md

## 🛠️ 常用操作

### 查看日志

**生产环境**（SSH 到 EC2）:
```bash
docker logs -f optima-commerce-backend-prod --tail 100
```

**Stage-ECS**:
```bash
aws logs tail /ecs/commerce-backend-stage --follow
```

**本地开发**:
```bash
docker compose logs -f
```

### 健康检查

```bash
# 检查服务状态
curl https://api.optima.shop/health

# 检查数据库连接
curl https://api.optima.shop/health/db
```

### 创建测试商品

```bash
curl -X POST http://localhost:8280/products \
  -H "Authorization: Bearer ock_test_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pearl Earrings",
    "price": 299.00,
    "description": "Beautiful freshwater pearl earrings",
    "collections": ["jewelry", "new"],
    "tags": ["featured"]
  }'
```

### 导入/导出商品（CSV）

```bash
# 导出商品（支持 collections 和 tags）
curl https://api.optima.shop/products/export?format=csv \
  -H "Authorization: Bearer ock_live_xxxxx" \
  -o products.csv

# 导入商品
curl -X POST https://api.optima.shop/products/import \
  -H "Authorization: Bearer ock_live_xxxxx" \
  -F "file=@products.csv"
```

## 🐛 故障排查

### 常见错误

**1. 数据库连接失败**
```
Error: could not connect to server
```
- 检查数据库是否运行：`docker ps | grep postgres`
- 检查环境变量：`DATABASE_URL` 是否正确
- 本地开发：确保 Docker Compose 已启动

**2. MinIO 上传失败**
```
Error: connection refused on port 8283
```
- 检查 MinIO 是否运行：`docker ps | grep minio`
- 检查环境变量：`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`
- 访问 MinIO UI：http://localhost:8284

**3. Stripe Webhook 验证失败**
```
Error: Invalid signature
```
- 检查 `STRIPE_WEBHOOK_SECRET` 是否正确
- Stripe Dashboard > Webhooks > 查看签名密钥
- 本地测试：使用 `stripe listen --forward-to localhost:8280/webhooks/stripe`

**4. 商品图片无法访问**
```
Error: 403 Forbidden
```
- 检查 MinIO bucket 权限：bucket 应设置为 public-read
- 检查 `MINIO_PUBLIC_DOMAIN` 配置
- 验证图片 URL 格式：`http://localhost:8284/commerce/products/xxx.jpg`

## 🔗 相关服务

**依赖服务**:
- User Auth - 用户认证和授权
- MinIO/S3 - 对象存储
- PostgreSQL - 数据库
- Redis - 缓存

**被调用方**:
- Commerce MCP - 通过 MCP 协议调用 Commerce Backend API
- Optima Store - 买家前端直接调用公开 API
- Agentic Chat - 通过 MCP Host 调用

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/commerce-backend/blob/main/README.md
- **架构文档**: ~/optima/documentation/optima-docs/OPTIMA_COMMERCE_ARCHITECTURE.md (PR #196)
- **API 文档**: https://api.optima.shop/docs
- **Stripe 集成**: https://stripe.com/docs/api
- **EasyShip 集成**: https://developers.easyship.com/
