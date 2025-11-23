---
name: "User Auth"
description: "Optima 用户认证授权服务 - JWT、OAuth2、社交登录、API 密钥管理，FastAPI + PostgreSQL，端口 8292/8000"
allowed-tools: ["Bash", "Read", "WebFetch"]
---

# User Auth - 认证授权服务

Optima AI 平台的统一认证授权服务，提供 JWT、OAuth2、社交登录等功能。

## 📦 服务概述

**核心功能**：
- 用户注册和登录（JWT）
- OAuth2 授权服务器
- 社交登录（Google、GitHub）
- API 密钥管理
- 用户权限管理
- Session 管理
- 密码重置

## 🔗 基本信息

**仓库**: https://github.com/Optima-Chat/user-auth

**技术栈**:
- Python 3.11+
- FastAPI
- SQLAlchemy
- PostgreSQL 15
- JWT (python-jose)
- OAuth2
- Redis (Session 存储)

**部署地址**:
- **生产环境**: https://auth.optima.shop (端口 8292)
- **Stage-ECS**: https://auth.stage.optima.onl (端口 8000)
- **本地开发**: http://localhost:8290

**API 文档**:
- Swagger UI: https://auth.optima.shop/docs
- OpenAPI JSON: https://auth.optima.shop/openapi.json

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
cd ~/optima/core-services/user-auth

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env

# 启动数据库
docker compose up -d postgres redis

# 运行迁移
alembic upgrade head

# 启动服务
uvicorn app.main:app --host 0.0.0.0 --port 8290 --reload
```

## 🔑 认证方式

### 1. JWT Token 认证（用户登录）

**流程**:
```
用户登录 → 获取 Access Token + Refresh Token → 使用 Token 访问 API
```

**登录获取 Token**:
```bash
curl -X POST http://localhost:8290/auth/login \
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
  "token_type": "bearer",
  "expires_in": 1800
}
```

**使用 Token**:
```bash
curl -X GET http://localhost:8290/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 2. API Key 认证（服务间调用）

**创建 API Key**:
```bash
curl -X POST http://localhost:8290/users/api-keys \
  -H "Authorization: Bearer {your_jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Service",
    "scopes": ["read:users", "write:users"]
  }'
```

**使用 API Key**:
```bash
curl -X GET http://localhost:8290/users/me \
  -H "X-API-Key: uak_xxxxxxxxxxxxx"
```

### 3. OAuth2 授权（第三方应用）

**授权流程**:
```
第三方应用 → /oauth/authorize → 用户同意 → 回调 /oauth/callback → 获取 access_token
```

**获取授权码**:
```
https://auth.optima.shop/oauth/authorize?
  client_id=optima_client&
  response_type=code&
  redirect_uri=https://example.com/callback&
  scope=read:profile
```

**交换 Token**:
```bash
curl -X POST https://auth.optima.shop/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=AUTHORIZATION_CODE" \
  -d "client_id=optima_client" \
  -d "client_secret=CLIENT_SECRET" \
  -d "redirect_uri=https://example.com/callback"
```

## 📖 核心 API 端点

### 用户认证

```
POST   /auth/register          # 用户注册
POST   /auth/login             # 用户登录
POST   /auth/refresh           # 刷新 Token
POST   /auth/logout            # 登出
POST   /auth/forgot-password   # 忘记密码
POST   /auth/reset-password    # 重置密码
```

### 用户管理

```
GET    /users/me               # 当前用户信息
PUT    /users/me               # 更新用户信息
POST   /users/api-keys         # 创建 API 密钥
GET    /users/api-keys         # API 密钥列表
DELETE /users/api-keys/{id}    # 删除 API 密钥
```

### OAuth2 端点

```
GET    /oauth/authorize        # OAuth 授权页面
POST   /oauth/token            # 获取/刷新 Token
POST   /oauth/revoke           # 撤销 Token
GET    /oauth/userinfo         # 获取用户信息（OpenID Connect）
```

### 社交登录

```
GET    /oauth/google/login     # Google 登录（重定向到 Google）
GET    /oauth/google/callback  # Google 回调
GET    /oauth/github/login     # GitHub 登录
GET    /oauth/github/callback  # GitHub 回调
```

### 管理员端点

```
GET    /admin/users            # 用户列表
GET    /admin/users/{id}       # 用户详情
PUT    /admin/users/{id}       # 更新用户
DELETE /admin/users/{id}       # 删除用户
POST   /admin/users/{id}/ban   # 封禁用户
```

## 🗄️ 数据库

### 连接信息

**生产环境**:
- 数据库名: `optima_auth`
- 用户: `auth_user`
- 主机: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
- 端口: 5432

**Stage 环境**:
- 数据库名: `optima_stage_auth`
- 用户: `auth_stage_user`

**本地开发**:
- Docker Compose PostgreSQL
- 端口: 5432

### 数据模型

**核心表**:
- `users` - 用户基本信息
- `api_keys` - API 密钥
- `oauth_clients` - OAuth 客户端
- `oauth_tokens` - OAuth Token
- `sessions` - 用户会话（存储在 Redis）

## 📁 项目结构

```
app/
├── routes/
│   ├── auth.py           # 认证端点
│   ├── users.py          # 用户管理
│   ├── oauth.py          # OAuth2 端点
│   └── admin.py          # 管理员端点
├── models/
│   ├── user.py           # 用户模型
│   ├── api_key.py        # API 密钥模型
│   └── oauth.py          # OAuth 模型
├── services/
│   ├── auth_service.py   # 认证逻辑
│   ├── token_service.py  # Token 管理
│   └── oauth_service.py  # OAuth 逻辑
├── core/
│   ├── security.py       # 密码哈希、JWT 工具
│   └── config.py         # 配置管理
└── main.py               # FastAPI 应用入口
```

## 🛠️ 常用操作

### 创建测试用户

**开发环境**:
```bash
curl -X POST http://localhost:8290/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@optima.ai",
    "password": "test123",
    "username": "testuser"
  }'
```

**生产环境**（通过脚本）:
```bash
cd ~/optima/core-services/user-auth
python scripts/create_user.py \
  --email admin@optima.ai \
  --password SecurePass123 \
  --role admin
```

### 查看日志

**生产环境**:
```bash
docker logs -f optima-user-auth-prod --tail 100
```

**Stage-ECS**:
```bash
aws logs tail /ecs/user-auth-stage --follow
```

**本地开发**:
```bash
docker compose logs -f
```

### 健康检查

```bash
curl https://auth.optima.shop/health
```

### 重置用户密码（管理员）

```bash
cd ~/optima/core-services/user-auth
python scripts/reset_password.py \
  --email user@example.com \
  --password NewPassword123
```

## 🔒 安全配置

### 环境变量（关键配置）

**JWT 配置**:
- `JWT_SECRET_KEY` - JWT 签名密钥（至少 32 字节，从 Infisical 获取）
- `JWT_ALGORITHM` - 签名算法（默认 HS256）
- `ACCESS_TOKEN_EXPIRE_MINUTES` - Access Token 过期时间（默认 30 分钟）
- `REFRESH_TOKEN_EXPIRE_DAYS` - Refresh Token 过期时间（默认 7 天）

**OAuth2 配置**:
- `OAUTH_CLIENT_ID` - OAuth 客户端 ID
- `OAUTH_CLIENT_SECRET` - OAuth 客户端密钥（从 Infisical 获取）
- `GOOGLE_CLIENT_ID` - Google OAuth ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Secret
- `GITHUB_CLIENT_ID` - GitHub OAuth ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth Secret

**Redis 配置**（Session 存储）:
- `REDIS_URL` - Redis 连接 URL
- `SESSION_EXPIRE_SECONDS` - Session 过期时间（默认 3600 秒）

### 密钥获取

**开发环境**:
查看 `.env.example` 文件

**生产环境**:
从 Infisical 获取：
```
/prod/user-auth/JWT_SECRET_KEY
/prod/user-auth/OAUTH_CLIENT_SECRET
/prod/user-auth/GOOGLE_CLIENT_SECRET
```

## 🐛 故障排查

### 常见错误

**1. Token 验证失败**
```
Error: Could not validate credentials
```
- 检查 `JWT_SECRET_KEY` 是否与生成 Token 时一致
- 检查 Token 是否过期
- 确认 `Authorization` header 格式：`Bearer {token}`

**2. Redis 连接失败**
```
Error: Connection refused on port 6379
```
- 检查 Redis 是否运行：`docker ps | grep redis`
- 检查 `REDIS_URL` 配置
- 本地开发：`docker compose up -d redis`

**3. OAuth 回调失败**
```
Error: Invalid redirect_uri
```
- 检查 OAuth 客户端配置中的 `redirect_uri`
- 确保 `redirect_uri` 与请求参数一致
- Google/GitHub OAuth 设置中添加回调 URL

**4. 数据库迁移失败**
```
Error: Target database is not up to date
```
- 运行迁移：`alembic upgrade head`
- 检查数据库连接：`psql $DATABASE_URL`
- 查看迁移历史：`alembic history`

## 🔗 相关服务

**被调用方**:
- Commerce Backend - 验证用户 Token
- MCP Host - OAuth 授权
- Agentic Chat - 用户登录
- Optima Store - 买家登录

**依赖服务**:
- PostgreSQL - 用户数据存储
- Redis - Session 和 Token 存储
- Google OAuth - 社交登录
- GitHub OAuth - 社交登录

## 📚 相关文档

- **仓库 README**: https://github.com/Optima-Chat/user-auth/blob/main/README.md
- **API 文档**: https://auth.optima.shop/docs
- **JWT 文档**: https://jwt.io/
- **OAuth2 规范**: https://oauth.net/2/
- **FastAPI Security**: https://fastapi.tiangolo.com/tutorial/security/
