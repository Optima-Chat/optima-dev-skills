---
name: "generate-test-token"
description: "当用户请求生成测试 token、创建测试账户、获取 access token、需要测试 API、API 测试、测试账户时，使用此技能。自动完成账户注册、token 获取和 merchant 设置。支持 CI、Stage、Prod、cn-prod、cn-stage 五个环境。"
allowed-tools: ["Bash", "SlashCommand"]
---

# 生成测试 Access Token

当你需要为 API 测试生成一个可用的 access token 时，使用这个场景。

## 🎯 执行方式：使用 CLI 工具

**重要**：无论用户使用 `/generate-test-token` 命令还是直接请求生成测试 token，都应该使用 `optima-generate-test-token` CLI 工具：

```bash
optima-generate-test-token [options]
```

**为什么使用 CLI 工具**：
- ✅ 自动注册商家账户（Auth API）
- ✅ 自动获取 OAuth access token
- ✅ 自动设置 merchant profile（Commerce API）
- ✅ Token 保存到文件，避免复制错误
- ✅ 一条命令完成所有设置

## 🎯 适用情况

- 需要测试 Commerce API 或 Auth API
- 开发新功能需要测试账户
- 调试 API 调用问题
- CI/CD 集成测试
- 演示功能需要临时账户

## 🚀 快速操作

### 基本使用

```bash
# CI 环境（默认）
optima-generate-test-token

# Stage 环境
optima-generate-test-token --env stage

# Prod 环境
optima-generate-test-token --env prod

# 自定义商户名称
optima-generate-test-token --business-name "我的测试店铺" --env stage

# 完全自定义
optima-generate-test-token \
  --email "test@example.com" \
  --password "MyPassword123" \
  --business-name "测试商店" \
  --env prod
```

### 环境说明

| 环境 | Auth URL | API URL |
|------|----------|---------|
| ci | `auth.optima.chat` | `api.optima.chat` |
| stage | `auth.stage.optima.onl` | `api.stage.optima.onl` |
| prod | `auth.optima.onl` | `api.optima.onl` |
| cn-prod | `auth.yzsgo.com` | `commerce.yzsgo.com` |
| cn-stage | `auth.stage.optima.chat` | `commerce.stage.optima.chat` |

### 使用生成的 Token

工具执行后会输出 token 文件路径，例如：`/tmp/optima-test-token-1763997011780.txt`

**方式 1: 使用 commerce CLI**

```bash
# 查询商品列表
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=ci \
commerce product list

# 创建商品
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=ci \
commerce product create \
  --title "测试商品" \
  --description "这是一个测试商品" \
  --price 99.99 \
  --stock 100 \
  --currency USD \
  --status active
```

**方式 2: 使用 curl**

```bash
# 查询用户信息
curl -H "Authorization: Bearer $(cat /tmp/optima-test-token-xxx.txt)" \
  https://auth.optima.chat/api/v1/users/me

# 查询商品
curl -H "Authorization: Bearer $(cat /tmp/optima-test-token-xxx.txt)" \
  https://api.optima.chat/api/products
```

## 📋 常见使用场景

### 场景 1：快速 API 测试

**用户请求**："我需要测试一下商品创建 API"

**步骤**：
1. 生成 token：`optima-generate-test-token`
2. 记录输出的 token 文件路径
3. 使用 token 创建商品：
   ```bash
   OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
   OPTIMA_ENV=ci \
   commerce product create --title "测试商品" --price 99.99 --stock 100
   ```

### 场景 2：调试 API 调用

**用户请求**："帮我生成一个测试账户，我要调试订单 API"

**步骤**：
1. 生成测试账户和 token：`optima-generate-test-token --business-name "订单测试店铺"`
2. 保存输出的账户信息（email, password, merchant_id）
3. 使用 token 查询订单：
   ```bash
   OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
   OPTIMA_ENV=ci \
   commerce order list
   ```

### 场景 3：演示功能

**用户请求**："创建一个演示账户，我要展示商品管理功能"

**步骤**：
1. 生成演示账户：`optima-generate-test-token --business-name "演示商店"`
2. 使用 token 创建演示数据：
   ```bash
   TOKEN_FILE=/tmp/optima-test-token-xxx.txt

   # 创建多个商品
   OPTIMA_TOKEN=$(cat $TOKEN_FILE) OPTIMA_ENV=ci \
   commerce product create --title "商品A" --price 49.99 --stock 50

   OPTIMA_TOKEN=$(cat $TOKEN_FILE) OPTIMA_ENV=ci \
   commerce product create --title "商品B" --price 89.99 --stock 30
   ```

### 场景 4：CI/CD 集成测试

**用户请求**："在 CI 环境中自动生成测试账户"

**步骤**：
1. 在 CI 脚本中调用：
   ```bash
   # 生成 token 并保存路径
   TOKEN_OUTPUT=$(optima-generate-test-token 2>&1)
   TOKEN_FILE=$(echo "$TOKEN_OUTPUT" | grep "Token File Path" -A 1 | tail -1 | xargs)

   # 在环境变量中设置
   export OPTIMA_TOKEN=$(cat $TOKEN_FILE)
   export OPTIMA_ENV=ci

   # 运行测试
   npm run test:api
   ```

## 📋 工具输出说明

成功执行后会输出：

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

💡 Usage Examples:
  # Read token from file:
  TOKEN=$(cat /tmp/optima-test-token-1763997011780.txt)

  # Use with commerce CLI:
  OPTIMA_TOKEN=$(cat /tmp/optima-test-token-1763997011780.txt) OPTIMA_ENV=ci commerce product list

  # Use in curl:
  curl -H "Authorization: Bearer $(cat /tmp/optima-test-token-1763997011780.txt)" https://api.optima.chat/api/products
```

**关键信息**：
- **Email/Password**: 账户登录凭证，可用于后续登录
- **Merchant ID**: 商户 ID，部分 API 可能需要
- **Token File Path**: Token 文件路径，这是最重要的信息！

## ⚠️ 注意事项

### 环境设置

使用 commerce CLI 时**必须**设置环境变量：
```bash
OPTIMA_ENV=ci  # 必需，与上面 --env 取同一个值 (ci/stage/prod/cn-prod/cn-stage)
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt)  # 必需，读取 token
```

### Token 有效期

- Token 默认有效期为 **15 分钟**
- 如果 token 过期，重新运行 `optima-generate-test-token` 即可
- 错误信息："Invalid or expired token"

### 文件管理

- Token 保存在系统临时目录（`/tmp/` 或 `/var/folders/...`）
- 系统重启后可能被清理
- 建议在使用完成后手动删除敏感文件

### 支持的环境

工具支持五个环境，使用 `--env` 参数指定：

| 环境 | Auth API | Commerce API |
|------|----------|--------------|
| ci (默认) | `https://auth.optima.chat` | `https://api.optima.chat` |
| stage | `https://auth.stage.optima.onl` | `https://api.stage.optima.onl` |
| prod | `https://auth.optima.onl` | `https://api.optima.onl` |
| cn-prod | `https://auth.yzsgo.com` | `https://commerce.yzsgo.com` |
| cn-stage | `https://auth.stage.optima.chat` | `https://commerce.stage.optima.chat` |

⚠️ **注意**：Prod / cn-prod 环境创建的账户会出现在生产系统中，请谨慎使用。

## 💡 最佳实践

### 1. Token 文件路径管理

```bash
# 方法 1：直接从输出复制路径
optima-generate-test-token
# 复制输出中的 "Token File Path"

# 方法 2：保存到变量
TOKEN_FILE=$(optima-generate-test-token 2>&1 | grep "Token File Path" -A 1 | tail -1 | xargs)
OPTIMA_TOKEN=$(cat "$TOKEN_FILE")
```

### 2. 重复使用同一个 token

```bash
# 将 token 路径保存到环境变量
export TOKEN_FILE=/tmp/optima-test-token-1763997011780.txt

# 后续使用
OPTIMA_TOKEN=$(cat $TOKEN_FILE) OPTIMA_ENV=ci commerce product list
OPTIMA_TOKEN=$(cat $TOKEN_FILE) OPTIMA_ENV=ci commerce order list
```

### 3. 自定义账户信息（可选）

只有在需要特定账户信息时才自定义：

```bash
# 自定义商户名称
optima-generate-test-token --business-name "我的专属测试店铺"

# 完全自定义（适合重复测试）
optima-generate-test-token \
  --email "mytest@example.com" \
  --password "MyStrongPassword123!" \
  --business-name "固定测试店铺"
```

### 4. 清理测试数据

```bash
# 测试完成后删除 token 文件
rm /tmp/optima-test-token-*.txt
```

## 🔧 故障排查

### 问题 1：Token 无效

**错误信息**: "Invalid or expired token"

**解决方案**:
- Token 已过期（15分钟），重新生成
- 环境变量设置错误，检查 `OPTIMA_ENV=ci`
- Token 文件路径错误，检查文件是否存在

### 问题 2：Merchant profile 未设置

**错误信息**: "Merchant profile setup required"

**解决方案**:
- 这不应该发生，工具会自动设置
- 检查工具输出是否显示 "✓ Merchant profile setup complete"
- 如果没有，可能是网络问题，重新运行

### 问题 3：命令不存在

**错误信息**: "command not found: optima-generate-test-token"

**解决方案**:
```bash
# 安装或更新工具
npm install -g @optima-chat/dev-skills@latest

# 或本地使用
npx @optima-chat/dev-skills generate-test-token
```

## 🔗 相关命令

- `optima-generate-test-token` - CLI 生成工具（主要方式）
- `/generate-test-token` - Slash 命令（备用方式，详细使用方法请查看 `/generate-test-token --help`）
- `commerce auth login` - Commerce CLI 登录
- `commerce product create` - 创建商品
- `commerce order list` - 查询订单

## 📚 更多资源

- **Commerce CLI**: https://github.com/Optima-Chat/commerce-cli
- **Auth API Docs**: https://auth.optima.chat/docs
- **Commerce API Docs**: https://api.optima.chat/docs
- **OAuth 2.0 文档**: https://auth.optima.chat/docs#/OAuth%202.0
