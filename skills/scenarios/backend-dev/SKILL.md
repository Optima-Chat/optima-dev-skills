---
name: "Backend Development"
description: "后端开发场景 - 数据库迁移、API 开发、测试、性能优化，适用于 commerce-backend、user-auth、mcp-host 开发"
allowed-tools: ["Bash", "Read", "SlashCommand"]
---

# Backend Development - 后端开发场景

当你在开发 **commerce-backend**、**user-auth** 或 **mcp-host** 时，这个 Skill 提供常用操作和问题解决方案。

## 🎯 适用场景

- 开发 commerce-backend（电商 API）
- 开发 user-auth（用户认证）
- 开发 mcp-host（MCP 协调器）
- 开发 MCP 工具（commerce-mcp、scout-mcp 等）
- 数据库迁移和优化
- API 测试和调试

## 📋 常见任务和解决方案

### 1. 数据库迁移

**问题**: 需要创建新表、修改表结构或添加字段

**解决步骤**:

1. **连接数据库查看当前表结构**:
   ```
   /db-connect commerce
   ```
   ```sql
   -- 查看所有表
   \dt

   -- 查看表结构
   \d products
   ```

2. **创建迁移文件** (Alembic):
   ```bash
   # 在 commerce-backend 目录
   alembic revision --autogenerate -m "Add collections field to products"
   ```

3. **查看生成的迁移文件**:
   ```bash
   # 文件位置: alembic/versions/xxx_add_collections_field.py
   cat alembic/versions/xxx_add_collections_field.py
   ```

4. **执行迁移**:
   ```bash
   # 升级到最新版本
   alembic upgrade head

   # 查看迁移历史
   alembic history
   ```

5. **验证迁移**:
   ```
   /db-connect commerce
   ```
   ```sql
   -- 验证新字段
   \d products

   -- 测试新字段
   SELECT id, title, collections FROM products LIMIT 1;
   ```

**回滚迁移**:
```bash
# 回滚一个版本
alembic downgrade -1

# 回滚到特定版本
alembic downgrade <revision_id>
```

**常见问题**:
- 迁移冲突: 多人同时修改数据库，需要合并迁移文件
- 数据丢失: 删除列或表前需要备份数据
- 外键约束: 删除表时注意外键依赖

---

### 2. API 开发和测试

**问题**: 开发新的 API 端点，需要测试功能和性能

**解决步骤**:

1. **查看现有 API 结构**:
   ```
   /swagger commerce-backend
   ```
   - 了解现有端点设计模式
   - 参考类似功能的实现

2. **编写 API 端点**:
   ```python
   # app/routes/products.py
   @router.post("/products", response_model=ProductResponse)
   async def create_product(
       product: ProductCreate,
       current_user: User = Depends(get_current_user),
       db: Session = Depends(get_db)
   ):
       # 业务逻辑
       ...
   ```

3. **重启服务应用更改**:
   ```
   /restart-service commerce-backend
   ```

4. **测试 API**:
   ```
   /test-api /products POST
   ```
   - 测试正常情况
   - 测试边界情况（空值、超长字符串）
   - 测试错误情况（无效参数、权限不足）

5. **查看日志验证**:
   ```
   /backend-logs commerce-backend 50
   ```
   - 检查请求日志
   - 查看数据库查询
   - 确认响应时间

6. **性能测试** (可选):
   ```bash
   # 使用 ab (Apache Bench)
   ab -n 1000 -c 10 \
     -H "Authorization: Bearer $OPTIMA_TOKEN" \
     http://localhost:8280/products

   # 或使用 wrk
   wrk -t4 -c100 -d30s \
     -H "Authorization: Bearer $OPTIMA_TOKEN" \
     http://localhost:8280/products
   ```

**API 开发最佳实践**:
- 使用 Pydantic 模型验证请求数据
- 添加适当的错误处理（try-except）
- 记录关键操作日志
- 添加单元测试和集成测试
- 更新 Swagger 文档说明

---

### 3. 数据库查询优化

**问题**: API 响应慢，数据库查询耗时过长

**解决步骤**:

1. **查看慢查询日志**:
   ```
   /db-connect commerce
   ```
   ```sql
   -- 查看当前运行的查询
   SELECT pid, query_start, state, query
   FROM pg_stat_activity
   WHERE state = 'active'
   ORDER BY query_start;

   -- 查看表大小
   SELECT
     schemaname,
     tablename,
     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
   ```

2. **分析查询执行计划**:
   ```sql
   -- 使用 EXPLAIN ANALYZE
   EXPLAIN ANALYZE
   SELECT * FROM products
   WHERE collections @> ARRAY['jewelry']
   AND status = 'active'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

3. **添加索引**:
   ```sql
   -- 为常用查询字段添加索引
   CREATE INDEX idx_products_status ON products(status);
   CREATE INDEX idx_products_created_at ON products(created_at DESC);

   -- 为 JSONB 字段添加 GIN 索引
   CREATE INDEX idx_products_collections ON products USING GIN(collections);

   -- 组合索引
   CREATE INDEX idx_products_status_created ON products(status, created_at DESC);
   ```

4. **验证索引效果**:
   ```sql
   -- 再次运行 EXPLAIN ANALYZE
   EXPLAIN ANALYZE
   SELECT * FROM products
   WHERE status = 'active'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

5. **监控性能**:
   ```
   /backend-logs commerce-backend
   ```
   - 查看响应时间
   - 检查数据库查询耗时

**优化技巧**:
- 避免 `SELECT *`，只查询需要的字段
- 使用分页（LIMIT + OFFSET）
- 避免 N+1 查询问题（使用 JOIN 或 eager loading）
- 使用 Redis 缓存热门数据
- 定期运行 `VACUUM` 和 `ANALYZE`

---

### 4. 第三方 API 集成调试

**问题**: Stripe、EasyShip 等第三方 API 调用失败

**解决步骤**:

1. **查看错误日志**:
   ```
   /backend-logs commerce-backend 100
   ```
   - 查找 Stripe 或 EasyShip 相关错误
   - 记录错误代码和消息

2. **检查 API 凭证**:
   ```bash
   # 使用 Infisical 获取密钥
   infisical export --env=local | grep STRIPE
   infisical export --env=local | grep EASYSHIP
   ```

3. **测试 API 连接**:
   ```bash
   # 测试 Stripe API
   curl https://api.stripe.com/v1/customers \
     -u "sk_test_xxxxx:"

   # 测试 EasyShip API
   curl https://api.easyship.com/v1/rates \
     -H "Authorization: Bearer easyship_xxxxx"
   ```

4. **使用测试模式**:
   - Stripe: 使用 `sk_test_` 开头的测试密钥
   - EasyShip: 使用 Sandbox 环境

5. **查看第三方 API 日志**:
   - Stripe Dashboard: https://dashboard.stripe.com/test/logs
   - EasyShip Dashboard: https://app.easyship.com/api-logs

**常见错误**:
- API Key 过期或无效
- Webhook 签名验证失败
- Rate Limit 超限
- 网络连接问题（防火墙、代理）

---

### 5. 本地开发环境问题

**问题**: Docker 容器启动失败或服务异常

**解决步骤**:

1. **检查所有服务状态**:
   ```
   /service-status local
   ```

2. **查看 Docker 日志**:
   ```
   /backend-logs commerce-backend
   ```
   或
   ```bash
   docker compose logs -f commerce-backend
   ```

3. **重启 Docker Compose**:
   ```bash
   # 重启所有服务
   docker compose restart

   # 重启单个服务
   docker compose restart commerce-backend

   # 完全重建
   docker compose down
   docker compose up -d --build
   ```

4. **清理 Docker 数据**:
   ```bash
   # ⚠️ 注意: 这会删除所有数据
   docker compose down -v
   docker compose up -d

   # 重新运行迁移
   docker compose exec commerce-backend alembic upgrade head
   ```

5. **检查端口冲突**:
   ```bash
   # 查看端口占用
   lsof -i :8280
   lsof -i :8282
   lsof -i :8290

   # 或使用 netstat
   netstat -an | grep LISTEN | grep 8280
   ```

**常见问题**:
- 端口被占用: 修改 docker-compose.yml 或关闭占用端口的进程
- 数据库连接失败: 检查 `DATABASE_URL` 环境变量
- 磁盘空间不足: `docker system prune -a`

---

### 6. 单元测试和集成测试

**问题**: 运行测试或编写新测试

**解决步骤**:

1. **运行所有测试**:
   ```bash
   # 在项目目录
   pytest

   # 运行特定测试文件
   pytest tests/test_products.py

   # 运行特定测试函数
   pytest tests/test_products.py::test_create_product

   # 显示详细输出
   pytest -v -s
   ```

2. **查看测试覆盖率**:
   ```bash
   pytest --cov=app --cov-report=html
   open htmlcov/index.html
   ```

3. **编写测试**:
   ```python
   # tests/test_products.py
   import pytest
   from fastapi.testclient import TestClient

   def test_create_product(client: TestClient, auth_headers):
       response = client.post(
           "/products",
           headers=auth_headers,
           json={
               "title": "Test Product",
               "price": 99.99,
               "collections": ["test"]
           }
       )
       assert response.status_code == 201
       data = response.json()
       assert data["title"] == "Test Product"
       assert data["price"] == 99.99
   ```

4. **测试数据库事务**:
   ```python
   # 使用 pytest fixture 自动回滚
   @pytest.fixture
   def db_session():
       session = Session()
       yield session
       session.rollback()
       session.close()
   ```

**测试最佳实践**:
- 每个 API 端点至少 1 个测试
- 测试正常情况和错误情况
- 使用 fixtures 管理测试数据
- 测试应该独立、可重复
- 集成测试使用独立的测试数据库

---

### 7. 生产环境部署

**问题**: 部署到 Stage 或 Prod 环境

**解决步骤**:

1. **确认代码已推送**:
   ```bash
   git status
   git push origin main
   ```

2. **触发 GitHub Actions 部署**:
   - 推送到 `main` 分支自动部署到 Stage
   - 推送 tag 部署到 Prod（如 `v1.2.0`）

3. **查看部署状态**:
   ```bash
   # 查看 GitHub Actions
   gh run list --limit 5

   # 查看具体 workflow
   gh run view <run-id>
   ```

4. **验证部署**:
   ```
   /health-check stage
   ```
   或
   ```bash
   curl https://api.stage.optima.onl/health
   ```

5. **查看部署日志**:
   ```
   /backend-logs commerce-backend stage
   ```
   或
   ```bash
   aws logs tail /ecs/commerce-backend-stage --follow
   ```

6. **回滚部署** (如果需要):
   ```bash
   # ECS 回滚到上一个任务定义
   aws ecs update-service \
     --cluster optima-stage \
     --service commerce-backend-stage \
     --task-definition commerce-backend-stage:previous
   ```

**部署检查清单**:
- [ ] 所有测试通过
- [ ] 数据库迁移已测试
- [ ] 环境变量已配置（Infisical）
- [ ] 依赖版本兼容
- [ ] API 文档已更新
- [ ] 日志监控配置正确

---

## 🚀 快速命令速查

### 数据库操作

```bash
# 连接数据库
/db-connect commerce

# 运行迁移
alembic upgrade head

# 创建迁移
alembic revision --autogenerate -m "Description"

# 查看迁移历史
alembic history
```

### API 开发

```bash
# 重启服务
/restart-service commerce-backend

# 测试 API
/test-api /products POST

# 查看 API 文档
/swagger commerce-backend

# 查看日志
/backend-logs commerce-backend 50
```

### 测试

```bash
# 运行测试
pytest

# 测试覆盖率
pytest --cov=app --cov-report=html

# 运行特定测试
pytest tests/test_products.py -v
```

### 部署

```bash
# 检查服务状态
/health-check stage

# 查看部署日志
/backend-logs commerce-backend stage

# 查看 ECS 服务
aws ecs describe-services \
  --cluster optima-stage \
  --services commerce-backend-stage
```

---

## 🗄️ 数据库管理

### 常用 SQL 查询

```sql
-- 查看表大小
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size('public.' || tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.' || tablename) DESC;

-- 查看索引使用情况
SELECT
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- 查看慢查询
SELECT
  query,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 查看表行数
SELECT
  schemaname,
  tablename,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

### 数据备份

```bash
# 备份数据库
pg_dump -h localhost -p 8282 -U commerce_user optima_commerce > backup.sql

# 恢复数据库
psql -h localhost -p 8282 -U commerce_user optima_commerce < backup.sql

# 只备份表结构
pg_dump -h localhost -p 8282 -U commerce_user --schema-only optima_commerce > schema.sql

# 只备份数据
pg_dump -h localhost -p 8282 -U commerce_user --data-only optima_commerce > data.sql
```

---

## 📊 性能监控

### 日志分析

```bash
# 查看错误日志
docker compose logs commerce-backend | grep ERROR

# 统计 API 调用次数
docker compose logs commerce-backend | grep "GET /products" | wc -l

# 查看响应时间
docker compose logs commerce-backend | grep "response_time"
```

### 资源使用

```bash
# 查看 Docker 容器资源使用
docker stats

# 查看数据库连接数
/db-connect commerce
```sql
SELECT count(*) FROM pg_stat_activity;
```

---

## 🔗 相关服务端口

| 服务 | 本地端口 | Swagger | 数据库 |
|------|---------|---------|--------|
| Commerce Backend | 8280 | /docs | optima_commerce |
| User Auth | 8290 | /docs | optima_auth |
| MCP Host | 8300 | /docs | optima_mcp |
| PostgreSQL | 8282 | - | - |
| Redis | 8285 | - | - |
| MinIO | 8283/8284 | - | - |

---

## 📚 相关文档

- **架构文档**: ~/optima/documentation/optima-docs/OPTIMA_COMMERCE_ARCHITECTURE.md
- **Commerce Backend**: skills/backend/commerce-backend/SKILL.md
- **User Auth**: skills/backend/user-auth/SKILL.md
- **MCP Host**: skills/backend/mcp-host/SKILL.md
- **FastAPI 文档**: https://fastapi.tiangolo.com/
- **SQLAlchemy 文档**: https://docs.sqlalchemy.org/
- **Alembic 文档**: https://alembic.sqlalchemy.org/

---

## 💡 开发技巧

### 1. 热重载开发

```bash
# FastAPI 自动重载
uvicorn app.main:app --reload --host 0.0.0.0 --port 8280
```

### 2. 使用 IPython 调试

```python
# 在代码中添加断点
import IPython; IPython.embed()

# 或使用 pdb
import pdb; pdb.set_trace()
```

### 3. 数据库迁移最佳实践

```bash
# 1. 自动生成迁移
alembic revision --autogenerate -m "Add field"

# 2. 检查生成的迁移文件
cat alembic/versions/xxx_add_field.py

# 3. 修改迁移文件（如果需要）
# 添加默认值、数据迁移逻辑等

# 4. 测试迁移（升级 + 降级）
alembic upgrade head
alembic downgrade -1
alembic upgrade head

# 5. 提交代码
git add alembic/versions/xxx_add_field.py
git commit -m "Add field to table"
```

### 4. 环境变量管理

```bash
# 使用 Infisical 同步环境变量
infisical export --env=local > .env

# 或使用 direnv
echo 'export DATABASE_URL="postgresql://..."' >> .envrc
direnv allow
```

---

## ❓ 常见问题

**Q: 如何在本地测试 Stripe Webhook？**
A: 使用 Stripe CLI:
```bash
stripe listen --forward-to localhost:8280/webhooks/stripe
```

**Q: 如何重置本地数据库？**
A:
```bash
docker compose down -v
docker compose up -d
docker compose exec commerce-backend alembic upgrade head
```

**Q: 如何查看 SQL 执行日志？**
A: 在 FastAPI 中启用 SQLAlchemy echo:
```python
engine = create_engine(DATABASE_URL, echo=True)
```

**Q: 如何处理数据库迁移冲突？**
A: 合并迁移文件，或创建新的迁移文件依赖两个冲突的迁移。

---

**下一步**: 如果遇到数据库或性能问题，使用 `/db-connect` 和性能分析工具进一步诊断。
