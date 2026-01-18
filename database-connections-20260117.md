# 数据库连接信息

> 更新于 2026-01-17，已验证连接有效性

---

## Prod RDS

**主机**: `optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
**端口**: `5432`

### 核心服务（已验证 ✓）

| 服务 | 数据库 | 用户名 | 密码 | 连接 URL |
|------|--------|--------|------|----------|
| User Auth | `optima_auth` | `auth_user` | `CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07` | `postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_auth` |
| Commerce | `optima_commerce` | `commerce_user` | `paIxbyCX6nDIY9IAQ07o5g7gvq0WuBER` | `postgresql://commerce_user:paIxbyCX6nDIY9IAQ07o5g7gvq0WuBER@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_commerce` |
| MCP Host | `optima_mcp` | `mcp_user` | `DJdq7Tsbpt1fCwskhA2zW96JrynlDeNY` | `postgresql://mcp_user:DJdq7Tsbpt1fCwskhA2zW96JrynlDeNY@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_mcp` |
| Agentic Chat | `optima_chat` | `chat_user` | `7mDRp5wt8LnpL6T832XiXlwLodmpbGM0` | `postgresql://chat_user:7mDRp5wt8LnpL6T832XiXlwLodmpbGM0@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_chat` |

### 其他服务（已验证 ✓）

| 服务 | 数据库 | 用户名 | 密码 | 连接 URL |
|------|--------|--------|------|----------|
| BI | `optima_bi` | `bi_user` | `l2Ezy3syxNKpoZJPAr7aDNal46Fhnl` | `postgresql://bi_user:l2Ezy3syxNKpoZJPAr7aDNal46Fhnl@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_bi` |
| AI Shell | `optima_ai_shell` | `ai_shell_user` | `EPG_91Ipg.0HXXWanzikDimK_4-2ku3V` | `postgresql://ai_shell_user:EPG_91Ipg.0HXXWanzikDimK_4-2ku3V@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_ai_shell` |
| Google Ads | `optima_google_ads` | `google_ads_stage_user` | `pWgkETBhqwHdYYB~z1z-scKzk2GKjssD` | `postgresql://google_ads_stage_user:pWgkETBhqwHdYYB~z1z-scKzk2GKjssD@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_google_ads` |

---

## Stage RDS

**主机**: `optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com`
**端口**: `5432`

### 核心服务（已验证 ✓）

| 服务 | 数据库 | 用户名 | 密码 | 连接 URL |
|------|--------|--------|------|----------|
| User Auth | `optima_auth` | `auth_user` | `CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07` | `postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_auth` |
| Commerce | `optima_commerce` | `commerce_user` | `paIxbyCX6nDIY9IAQ07o5g7gvq0WuBER` | `postgresql://commerce_user:paIxbyCX6nDIY9IAQ07o5g7gvq0WuBER@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_commerce` |
| MCP Host | `optima_mcp` | `mcp_user` | `DJdq7Tsbpt1fCwskhA2zW96JrynlDeNY` | `postgresql://mcp_user:DJdq7Tsbpt1fCwskhA2zW96JrynlDeNY@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_mcp` |
| Agentic Chat | `optima_chat` | `chat_user` | `7mDRp5wt8LnpL6T832XiXlwLodmpbGM0` | `postgresql://chat_user:7mDRp5wt8LnpL6T832XiXlwLodmpbGM0@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_chat` |

### 其他服务（已验证 ✓）

| 服务 | 数据库 | 用户名 | 密码 | 连接 URL |
|------|--------|--------|------|----------|
| BI | `optima_bi` | `bi_user` | `l2Ezy3syxNKpoZJPAr7aDNal46Fhnl` | `postgresql://bi_user:l2Ezy3syxNKpoZJPAr7aDNal46Fhnl@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_bi` |
| AI Shell | `optima_shell` | `shell_user` | `ZskXEnDnTCBE171cC5IVscg6rPd269CU` | `postgresql://shell_user:ZskXEnDnTCBE171cC5IVscg6rPd269CU@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_shell` |

### 未配置

| 服务 | 状态 |
|------|------|
| Google Ads | Stage RDS 未创建用户/数据库 |

---

## 注意事项

1. **连接方式**: 只能从 VPC 内部连接（EC2、ECS 等）
2. **密码中的特殊字符**: 如果密码包含 `~` 等特殊字符，在 URL 中需要 URL 编码
3. **AI Shell 数据库名差异**: Prod 用 `optima_ai_shell`，Stage 用 `optima_shell`
4. **Google Ads**: Stage RDS 尚未配置

---

## 连接方式

### Prod RDS - 通过 Shared EC2 跳板机

Prod RDS 在私有子网，**无法本地直连**，需要通过 EC2：

```bash
# SSH 到 Shared EC2
ssh -i ~/.ssh/optima-ec2-key ec2-user@13.251.46.219

# 在 EC2 上用 Docker 连接
docker run --rm --network host postgres:15-alpine psql \
  "postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_auth" \
  -c "SELECT current_database();"
```

```bash
# 或者 SSH 端口转发（本地工具连接）
ssh -i ~/.ssh/optima-ec2-key -L 5433:optima-prod-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432 ec2-user@13.251.46.219 -N

# 另开终端，本地连接 localhost:5433
psql "postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@localhost:5433/optima_auth"
```

### Stage RDS - 本地直连

Stage RDS 在公有子网，**可以本地直连**：

```bash
# 直接连接
psql "postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_auth"

# 或用 Docker
docker run --rm postgres:15-alpine psql \
  "postgresql://auth_user:CmUbtesYZkPsMnEqNEjzK9tpcyAE6o07@optima-stage-postgres.ctg866o0ehac.ap-southeast-1.rds.amazonaws.com:5432/optima_auth" \
  -c "SELECT current_database();"
```
