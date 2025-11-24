# /generate-test-token - 生成测试 Access Token

快速生成一个可用的测试 Access Token，包含完整的账户注册、token 获取和 merchant 设置。

**版本**: v0.5.4

## 使用场景

**API 测试**: 快速获取可用的 access token 进行 API 调用测试
**开发调试**: 生成测试账户用于功能开发和调试
**集成测试**: 在 CI/CD 中自动生成测试账户

## 🎯 使用方式：CLI 工具

使用 `optima-generate-test-token` CLI 工具，它会自动完成所有设置：

```bash
# 使用默认配置（随机生成账户信息）
optima-generate-test-token

# 自定义商户名称
optima-generate-test-token --business-name "我的测试店铺"

# 完全自定义
optima-generate-test-token \
  --email "custom@example.com" \
  --password "MyPass123" \
  --business-name "Custom Shop" \
  --phone "+1234567890"
```

## 工作流程

该工具会自动完成以下步骤：

1. **注册商家账户** - 在 Auth API 注册 merchant 角色用户
2. **获取 Access Token** - 通过 OAuth 2.0 password grant 获取 token
3. **设置 Merchant Profile** - 在 Commerce API 创建 merchant 资料
4. **保存 Token 到文件** - 将 token 保存到临时文件，避免复制粘贴错误

## 输出内容

工具执行成功后会输出：

- 账户邮箱和密码
- User ID 和 Merchant ID
- **Token 文件路径**（token 已保存到该文件）
- 使用示例（包括 commerce CLI 和 curl）

## 使用生成的 Token

### 方式 1: 使用 commerce CLI（推荐）

```bash
# 读取 token 并使用
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce product list

# 创建商品
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce product create \
  --title "测试商品" \
  --price 99.99 \
  --stock 100
```

### 方式 2: 使用 curl

```bash
# 查询商品
curl -H "Authorization: Bearer $(cat /tmp/optima-test-token-xxx.txt)" \
  https://api.optima.chat/api/products

# 查询用户信息
curl -H "Authorization: Bearer $(cat /tmp/optima-test-token-xxx.txt)" \
  https://auth.optima.chat/api/v1/users/me
```

## 命令参数

- `--email <email>` - 用户邮箱（默认：自动生成）
- `--password <password>` - 用户密码（默认：TestPassword123!）
- `--business-name <name>` - 商户名称（默认：自动生成）
- `--phone <phone>` - 联系电话（可选）
- `--address <address>` - 地址（可选）
- `--help, -h` - 显示帮助信息

## 示例

### 示例 1：快速生成

```bash
optima-generate-test-token
```

输出：
```
✅ Test token generated successfully!

📋 Details:
  Email:         test_1763996983959_wnjt4y@example.com
  Password:      TestPassword123!
  User ID:       14bb1340-0ffc-41c8-aac6-c8b7a6bbb1a0
  Role:          merchant
  Business Name: Test Merchant 1763996983959
  Merchant ID:   14bb1340-0ffc-41c8-aac6-c8b7a6bbb1a0

📁 Token File Path:
  /tmp/optima-test-token-1763997011780.txt
```

### 示例 2：自定义商户信息

```bash
optima-generate-test-token \
  --business-name "Claude 测试商店" \
  --phone "+8613800138000"
```

### 示例 3：使用 token 创建商品

```bash
# 生成 token
optima-generate-test-token

# 使用 token（复制上面输出的文件路径）
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=development \
commerce product create \
  --title "陶瓷杯" \
  --price 89 \
  --stock 20
```

## ⚠️ 注意事项

1. **仅用于开发环境** - 这些测试账户连接到 development 环境（api.optima.chat）
2. **Token 有效期** - Token 默认有效期 15 分钟，请及时使用
3. **临时文件** - Token 保存在系统临时目录，重启后可能被清理
4. **环境变量** - 使用 commerce CLI 时需要设置 `OPTIMA_ENV=development`

## 🔗 相关资源

- Commerce CLI: https://github.com/Optima-Chat/commerce-cli
- Auth API Docs: https://auth.optima.chat/docs
- Commerce API Docs: https://api.optima.chat/docs

## 技术细节

**API 调用流程**：
1. `POST /api/v1/auth/register/merchant` - 注册商家用户
2. `POST /api/v1/oauth/token` - 获取 access token（password grant）
3. `POST /api/merchants/me` - 设置 merchant profile

**使用的 Client ID**: `dev-skill-cli-he7fjmsp`

**默认 Merchant 信息**：
- 发货地址：中国深圳南山区科技园
- 联系电话：+8613800138000
- 联系邮箱：test@example.com
