---
name: "Troubleshooting"
description: "排查问题 - API 错误、服务异常、数据库问题的快速诊断和解决"
allowed-tools: ["Bash", "SlashCommand"]
---

# 排查问题

当遇到错误或异常时，使用这个场景快速定位和解决问题。

## 🎯 适用情况

- API 返回错误（500、403、401等）
- 服务无响应或崩溃
- 数据库连接失败
- Token 过期或无效
- 前端无法连接后端

## 🚨 常见问题快速解决

### 问题 1：API 返回 500 错误

**症状**：
```json
{
  "detail": "Internal server error"
}
```

**排查步骤**：

1. **查看后端日志**：
```
/backend-logs commerce-backend 100
```

2. **找到错误堆栈**：
```
ERROR - 2024-11-23 10:30:45 - Exception in /products endpoint
Traceback:
  File "app/routes/products.py", line 45
    merchant = db.query(Merchant).filter(id == product.merchant_id).first()
  AttributeError: merchant_id not found
```

3. **定位原因**：
   - 数据库数据问题
   - 代码逻辑错误
   - 第三方 API 失败

4. **解决方案**：
```
# 检查数据库
/query-db commerce
SELECT * FROM products WHERE id = 'xxx';

# 如果是代码问题，修复后重启
/restart-service commerce-backend
```

---

### 问题 2：API 返回 401 Unauthorized

**症状**：
```json
{
  "detail": "Invalid or expired token"
}
```

**排查步骤**：

1. **检查 Token 是否存在**：
```bash
echo $OPTIMA_TOKEN
```

2. **重新获取 Token**：
```
/get-token test@optima.ai
```

3. **验证 Token 有效性**：
```
/test-api /users/me GET
```

**常见原因**：
- Token 已过期（默认 1 小时有效期）
- Token 格式错误（缺少 "Bearer " 前缀）
- 使用了错误环境的 Token

**解决方案**：
```
# 获取新 Token
/get-token

# 确认 Token 已保存
echo $OPTIMA_TOKEN

# 重新测试
/test-api /products GET
```

---

### 问题 3：API 返回 403 Forbidden

**症状**：
```json
{
  "detail": "Insufficient permissions"
}
```

**排查步骤**：

1. **检查用户角色**：
```
/test-api /users/me GET
```

返回：
```json
{
  "id": "xxx",
  "email": "test@optima.ai",
  "role": "user"  ← 普通用户没有创建商品的权限
}
```

2. **使用正确角色的账户**：
```
# 创建商品需要 merchant 权限
/get-token merchant@optima.ai

# 管理用户需要 admin 权限
/get-token admin@optima.ai
```

**权限矩阵**：
| 操作 | user | merchant | admin |
|------|------|----------|-------|
| 浏览商品 | ✅ | ✅ | ✅ |
| 创建订单 | ✅ | ✅ | ✅ |
| 创建商品 | ❌ | ✅ | ✅ |
| 管理订单 | ❌ | ✅（仅自己的） | ✅ |
| 管理用户 | ❌ | ❌ | ✅ |

---

### 问题 4：服务无响应或连接被拒绝

**症状**：
```
Error: Connection refused
Error: ERR_CONNECTION_REFUSED
```

**排查步骤**：

1. **检查所有服务状态**：
```
/health-check all
```

返回：
```
✅ commerce-backend: Running
❌ user-auth: Connection refused
✅ postgres: Connected
```

2. **查看具体服务状态**：
```
/service-status
```

3. **重启异常服务**：
```
/restart-service user-auth
```

4. **查看重启日志**：
```
/backend-logs user-auth 50
```

**常见原因**：
- Docker 容器未启动
- 端口被占用
- 环境变量配置错误
- 依赖服务（数据库、Redis）未运行

**解决方案**：
```
# 重启所有服务
docker compose restart

# 或重新启动 Docker Compose
docker compose down
docker compose up -d

# 检查端口占用
lsof -i :8280  # commerce-backend
lsof -i :8290  # user-auth
```

---

### 问题 5：数据库连接失败

**症状**：
```
ERROR - Database connection failed
ERROR - could not connect to server
```

**排查步骤**：

1. **检查数据库服务**：
```
/health-check
```

2. **检查 Docker 容器**：
```bash
docker compose ps postgres
```

3. **尝试手动连接**：
```
/query-db commerce
```

4. **查看后端日志中的数据库错误**：
```
/backend-logs commerce-backend 100 | grep -i database
```

**常见原因**：
- PostgreSQL 容器未启动
- 数据库密码错误
- 数据库端口配置错误
- 数据库磁盘空间不足

**解决方案**：
```
# 重启数据库
docker compose restart postgres

# 检查数据库日志
docker compose logs postgres --tail 100

# 如果数据损坏，重建数据库
docker compose down -v
docker compose up -d
docker compose exec commerce-backend alembic upgrade head
```

---

### 问题 6：CORS 错误

**症状**（浏览器控制台）：
```
Access to fetch at 'https://api.optima.chat/products' from origin
'http://localhost:3000' has been blocked by CORS policy
```

**排查步骤**：

1. **检查后端 CORS 配置**：
```
/backend-logs commerce-backend | grep CORS
```

2. **验证前端 URL 是否在白名单**：
   - 后端默认允许：`http://localhost:3000`, `http://localhost:3001`

3. **临时解决**（开发环境）：
   - 使用浏览器插件（CORS Unblock）
   - 使用代理（Next.js、Vite 内置）

4. **永久解决**：
   - 修改后端 CORS 配置（`app/main.py`）
   - 添加你的前端 URL 到 `allow_origins`

**检查后端配置**：
```python
# app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        # 添加你的 URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

### 问题 7：前端显示"Network Error"

**症状**：
```
Error: Network Error
Error: Failed to fetch
```

**排查步骤**：

1. **检查后端是否运行**：
```
/health-check commerce-backend
```

2. **检查 API 地址是否正确**：
```typescript
// 前端代码
const API_URL = 'https://api.optima.chat';  // CI
// const API_URL = 'https://api.stage.optima.onl';  // Stage
// const API_URL = 'https://api.optima.shop';  // Prod
```

3. **测试 API 可访问性**：
```
curl https://api.optima.chat/health
```

4. **检查防火墙或代理**

**常见原因**：
- 后端服务未启动
- API 地址配置错误（端口、域名）
- 网络问题（VPN、防火墙）
- 浏览器缓存

**解决方案**：
```
# 确认服务运行
/service-status

# 清除浏览器缓存
# Chrome: Cmd+Shift+Delete

# 重启前端开发服务器
npm run dev
```

---

## 🔍 通用排查流程

遇到任何问题时，按以下顺序排查：

### 1. 检查服务状态
```
/health-check all
/service-status
```

### 2. 查看日志
```
/backend-logs [service-name] 100
```

### 3. 检查数据库
```
/query-db commerce
```

### 4. 重启服务（如果需要）
```
/restart-service [service-name]
```

### 5. 验证修复
```
/test-api [endpoint] [method]
```

## 💡 排查技巧

### 1. 从日志找线索

```
# 查找错误
/backend-logs commerce-backend 200 | grep ERROR

# 查找特定 API
/backend-logs commerce-backend 100 | grep "GET /products"

# 查找最近的错误
docker compose logs commerce-backend --since 5m | grep ERROR
```

### 2. 对比环境差异

```
# 本地正常，Stage 出错？
# 对比环境变量、数据库数据、日志

# 查看本地日志
/backend-logs commerce-backend local

# 查看 Stage 日志
/backend-logs commerce-backend stage
```

### 3. 复现问题

```
# 记录复现步骤
1. 用户登录：/get-token buyer@test.com
2. 创建订单：/test-api /public/checkout POST
3. 错误出现：500 Internal Server Error

# 查看该时间点的日志
/backend-logs commerce-backend 100
```

### 4. 隔离问题

```
# 是所有用户都有问题，还是特定用户？
/get-token user1@test.com
/test-api /products GET

/get-token user2@test.com
/test-api /products GET

# 是所有 API 都有问题，还是特定 API？
/test-api /products GET
/test-api /orders GET
/test-api /users/me GET
```

## 🚑 紧急情况处理

### 生产环境服务宕机

1. **立即通知团队**
2. **查看日志定位问题**：
```
/backend-logs commerce-backend 200 prod
```
3. **如果是代码问题，回滚部署**
4. **如果是资源问题（内存、CPU），重启服务**：
```
/restart-service commerce-backend prod
```

### 数据丢失或损坏

1. **不要慌，不要随意操作**
2. **连接数据库检查**：
```
/query-db commerce prod
```
3. **如果有备份，从备份恢复**
4. **如果没有备份，联系 DBA 或 DevOps**

## 🔗 相关命令

- `/backend-logs` - 查看服务日志
- `/health-check` - 健康检查
- `/service-status` - 服务状态
- `/restart-service` - 重启服务
- `/query-db` - 连接数据库
- `/get-token` - 获取 Token
- `/test-api` - 测试 API

## 📚 错误代码速查

| 状态码 | 含义 | 常见原因 | 解决方案 |
|--------|------|----------|----------|
| 400 | Bad Request | 请求参数错误 | 检查参数格式 |
| 401 | Unauthorized | Token 无效/过期 | 重新获取 Token |
| 403 | Forbidden | 权限不足 | 使用正确角色账户 |
| 404 | Not Found | 资源不存在 | 检查 ID 是否正确 |
| 422 | Validation Error | 数据验证失败 | 检查必需字段 |
| 500 | Internal Server Error | 服务器内部错误 | 查看日志定位 |
| 502 | Bad Gateway | 后端服务不可用 | 检查服务状态 |
| 503 | Service Unavailable | 服务暂时不可用 | 重启服务 |

## 💡 最佳实践

1. **保持冷静** - 错误都是可以解决的
2. **先看日志** - 日志包含最多信息
3. **逐步排查** - 从简单到复杂
4. **记录过程** - 方便复现和分享
5. **寻求帮助** - 不要一个人死磕，团队协作
