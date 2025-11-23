# Optima Dev Skills

**Claude Skills for Optima AI Development Team**

Optima Dev Skills 是为 Optima AI 开发团队设计的 Claude Skills 集合，旨在加速 Claude Code 开发效率，提供团队仓库、部署、测试等关键信息的即时访问。

## 🎯 核心价值

- **自动加载相关信息** - Claude Code 根据对话上下文，自动识别并加载相关仓库的开发信息
- **快速回答常见问题** - 部署地址、API 文档、Token 获取、日志查看等一问即答
- **引导开发流程** - 环境搭建、测试流程、部署规范清晰明了
- **降低认知负担** - 新人无需记忆 27+ 个仓库信息，对话即可获取

## 📦 安装

```bash
npm install -g @optima-ai/dev-skills
```

安装后，Skills 会自动复制到 `~/.claude/skills/optima-dev/`

## 🏗️ Skills 结构

```
optima-dev/
├── core/              # 核心索引、团队规范
├── backend/           # 后端服务 (3个)
├── frontend/          # 前端应用 (2个)
├── mcp-tools/         # MCP 工具集 (4个)
├── infrastructure/    # 基础设施 (3个)
├── onboarding/        # 新人入职 (3个)
├── cli-tools/         # CLI 工具 (2个)
└── scripts/           # 自动化脚本 (6个)
```

**总计 15 个模块化 Skills + 6 个自动化脚本**

## 🚀 快速开始

安装后，在 Claude Code 中直接提问：

- "commerce-backend 的 API 文档在哪？"
- "如何获取开发环境的 Token？"
- "查看 mcp-host 的日志"
- "新人如何搭建本地开发环境？"

Claude 会自动加载相关 Skill 并回答。

## 📚 文档

- [技术设计文档](docs/TECHNICAL_DESIGN.md) - 完整的技术架构和设计决策
- [使用指南](docs/USER_GUIDE.md) - 如何使用和维护（待完成）
- [贡献指南](docs/CONTRIBUTING.md) - 如何贡献内容（待完成）

## 🔧 自动化脚本

安装后可用的脚本：

- `get-token.sh` - 获取各服务 Token
- `health-check.sh` - 服务健康检查
- `view-logs.sh` - 查看服务日志
- `db-connect.sh` - 数据库连接
- `create-test-user.sh` - 创建测试用户
- `env-setup.sh` - 环境配置助手

## 🎯 覆盖的仓库

### 核心电商系统
- commerce-backend - 电商核心 API
- user-auth - 认证授权服务
- mcp-host - MCP 协调器
- agentic-chat - 卖家对话界面
- optima-store - 买家购物前端

### MCP 工具集
- commerce-mcp - 电商 MCP 工具（21个工具）
- scout-mcp - 智能选品 MCP
- comfy-mcp - 图像生成 MCP
- google-ads-mcp - Google Ads MCP（16个工具）

### 基础设施与工具
- optima-terraform - 基础设施即代码
- commerce-cli - 电商管理 CLI（95+命令）
- optima-ops-cli - 运维监控 CLI（47命令）

## 🔐 安全说明

本 Skills 集合**不包含**任何敏感信息（API Key、密码等），仅提供：
- 服务地址和端口
- 文档链接
- 获取密钥的方式（Infisical 路径、环境变量名）
- 自动化脚本（安全的只读操作）

## 🛠️ 开发状态

**当前版本**: 0.1.0 (设计阶段)

**完成进度**:
- ✅ 技术设计文档
- ⏳ Skills 内容编写
- ⏳ 自动化脚本开发
- ⏳ NPM 包结构
- ⏳ 测试验证

## 📝 维护

Skills 内容由 Optima AI 开发团队维护。如发现信息过时或错误：

1. 提交 Issue
2. 或直接提交 PR 修复
3. Review 通过后，自动发布新版本

## 📄 License

MIT

## 🙋 联系

- GitHub Issues: https://github.com/Optima-Chat/optima-dev-skills/issues
- 团队内部：开发者微信群

---

**🤖 Generated with Claude Code**
