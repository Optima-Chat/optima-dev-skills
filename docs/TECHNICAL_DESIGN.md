# Optima Dev Skills 技术设计方案

**版本**: 1.0.0
**日期**: 2025-11-23
**状态**: 设计阶段

## 1. 项目概述

### 1.1 背景

Optima AI 开发团队管理着 27+ 个仓库，涉及电商后端、前端应用、MCP 工具、基础设施等多个领域。团队成员在使用 Claude Code 进行开发时，需要频繁查询：

- 各服务的部署地址和端口
- API 文档位置和认证方式
- 如何注册测试用户
- 如何获取 Token 和查看日志
- 仓库间的依赖关系
- 部署流程和环境配置

目前这些信息分散在各仓库的 README、文档、内部 Wiki 中，查找效率低，新人上手困难。

### 1.2 目标

创建 **Optima Dev Skills**，一个模块化的 Claude Skills 集合，让 Claude Code 能够：

1. **自动加载相关信息** - 根据对话上下文，自动识别并加载相关仓库的开发信息
2. **快速回答常见问题** - 部署地址、API 文档、Token 获取、日志查看等
3. **引导开发流程** - 环境搭建、测试流程、部署规范
4. **降低认知负担** - 新人无需记忆大量仓库信息，对话即可获取

### 1.3 交付物

- **NPM 包**: `@optima-ai/dev-skills`
- **Skills 集合**: 15 个模块化 SKILL.md 文件
- **自动化脚本**: 6 个常用操作脚本
- **安装工具**: 一键安装到 `~/.claude/skills/optima-dev`
- **文档**: 技术设计、使用指南、维护手册

## 2. 技术架构

### 2.1 整体架构

采用 **Claude Skills 的渐进式加载架构**：

```
用户提问
    ↓
Claude 扫描所有 Skills 的 metadata (name + description)
    ↓
识别相关 Skills（如 "commerce-backend"）
    ↓
加载完整 SKILL.md 内容（<5k tokens）
    ↓
基于 Skill 内容回答问题或执行操作
```

**关键优势**：
- 仅在需要时加载，节省 tokens
- 模块化设计，易于扩展
- 自动识别，无需手动激活

### 2.2 目录结构设计

```
~/.claude/skills/optima-dev/
├── core/
│   └── SKILL.md                    # 核心索引、团队规范、快速链接
├── backend/
│   ├── commerce-backend/
│   │   └── SKILL.md               # 电商 API 服务
│   ├── user-auth/
│   │   └── SKILL.md               # 认证授权服务
│   └── mcp-host/
│       └── SKILL.md               # MCP 协调器
├── frontend/
│   ├── agentic-chat/
│   │   └── SKILL.md               # 卖家对话界面
│   └── optima-store/
│       └── SKILL.md               # 买家购物前端
├── mcp-tools/
│   ├── commerce-mcp/
│   │   └── SKILL.md               # 电商 MCP 工具
│   ├── scout-mcp/
│   │   └── SKILL.md               # 智能选品 MCP
│   ├── comfy-mcp/
│   │   └── SKILL.md               # 图像生成 MCP
│   └── google-ads-mcp/
│       └── SKILL.md               # Google Ads MCP
├── infrastructure/
│   ├── terraform/
│   │   └── SKILL.md               # 基础设施即代码
│   ├── deployment/
│   │   └── SKILL.md               # CI/CD 部署流程
│   └── monitoring/
│       └── SKILL.md               # 日志监控
├── onboarding/
│   ├── setup/
│   │   └── SKILL.md               # 环境搭建
│   ├── testing/
│   │   └── SKILL.md               # 测试流程
│   └── workflows/
│       └── SKILL.md               # Git 规范、PR 流程
├── cli-tools/
│   ├── commerce-cli/
│   │   └── SKILL.md               # 电商管理 CLI
│   └── optima-ops-cli/
│       └── SKILL.md               # 运维监控 CLI
└── scripts/
    ├── get-token.sh               # 获取 Token
    ├── health-check.sh            # 健康检查
    ├── view-logs.sh               # 查看日志
    ├── db-connect.sh              # 数据库连接
    ├── create-test-user.sh        # 创建测试用户
    └── env-setup.sh               # 环境配置助手
```

**设计原则**：
- 每个仓库一个独立 Skill，职责清晰
- 按功能分组（backend/frontend/mcp-tools），便于管理
- 核心 Skill 提供快速索引
- 脚本集中存放，便于调用

### 2.3 Skill Metadata 设计

每个 SKILL.md 的 YAML frontmatter 格式：

**核心字段**：
- **name**: Skill 名称（简短、唯一）
- **description**: 详细描述，包含关键词，用于 Claude 判断相关性（重要）
- **allowed-tools**: 允许的工具列表（安全控制）

**description 设计原则**：
- 包含仓库名称
- 包含核心功能关键词
- 包含技术栈（帮助技术问题匹配）
- 包含部署信息（帮助运维问题匹配）

**示例**：

**好的 description**（精准匹配）:
- "Commerce Backend - 电商核心 API 服务，FastAPI + PostgreSQL，端口 8280，提供商品管理、订单处理、支付集成"

**不好的 description**（过于简略）:
- "后端服务"

### 2.4 内容组织策略

#### 2.4.1 核心信息层级

**Level 1 - 快速索引** (core/SKILL.md):
- 系统架构总览
- 所有服务的生产/开发地址
- 常用命令速查
- 紧急联系方式

**Level 2 - 服务详情** (各服务 SKILL.md):
- 服务功能说明
- 技术栈和依赖
- 部署地址和端口
- API 文档链接
- 本地开发指南
- 常见问题

**Level 3 - 操作指南** (onboarding/infrastructure):
- 环境搭建步骤
- 测试流程
- 部署流程
- 监控和排查

#### 2.4.2 信息更新策略

**静态信息**（写入 Skill）:
- 仓库 URL
- 技术栈
- 架构设计
- 端口映射

**动态信息**（引用方式）:
- API Key（引用 Infisical 路径）
- 数据库密码（引用环境变量）
- 当前部署状态（提供查询命令）

**原则**：Skills 中不存储敏感信息，仅提供获取方式。

## 3. 关键技术决策

### 3.1 敏感信息处理

**问题**：如何在 Skills 中提供认证信息，同时保证安全？

**方案**：**引用 + 脚本获取**

不直接存储密钥，而是提供：
1. **Infisical 路径** - 生产环境密钥引用路径
2. **环境变量名** - 本地开发环境变量
3. **获取脚本** - 自动化脚本帮助获取

**示例**（在 SKILL.md 中）:

```
## 认证信息

**生产环境 API Key**:
- Infisical 路径: `/prod/commerce-backend/COMMERCE_API_KEY`
- 获取方式: 运行 `scripts/get-token.sh commerce-backend prod`

**开发环境 API Key**:
- 本地 .env 文件: `COMMERCE_API_KEY=ock_test_xxxxx`
- 测试密钥位置: 查看仓库 `.env.example`

**新人获取**:
- 联系团队管理员开通 Infisical 访问权限
- 运行 `scripts/env-setup.sh` 配置本地环境
```

**优势**：
- 安全：不泄露实际密钥
- 实用：提供清晰的获取路径
- 自动化：脚本减少手动操作

### 3.2 Skills 粒度选择

**问题**：每个仓库一个 Skill，还是合并相关仓库？

**方案**：**每个核心仓库一个独立 Skill**

**理由**：
1. **精准加载** - Claude 能更准确判断需要哪个 Skill
2. **减少 tokens** - 避免加载无关信息
3. **易于维护** - 仓库信息变更时，仅更新对应 Skill
4. **可扩展** - 新增仓库时，添加新 Skill 即可

**分组策略**：
- 核心业务服务（6个）：独立 Skill
- MCP 工具（4个）：独立 Skill
- 基础设施（3个）：按功能分组
- 入职指南（3个）：按阶段分组

### 3.3 脚本集成方式

**问题**：自动化脚本如何与 Skills 配合？

**方案**：**Skills 提供引导，脚本执行操作**

**工作流**：
```
用户: "帮我获取 commerce-backend 的 API token"
    ↓
Claude 加载 backend/commerce-backend/SKILL.md
    ↓
Skill 内容指示: "运行 scripts/get-token.sh commerce-backend"
    ↓
Claude 执行脚本
    ↓
返回 Token
```

**6 个核心脚本**：

1. **get-token.sh** - 获取各服务 Token
   - 参数: 服务名、环境（prod/dev）
   - 输出: Token 字符串

2. **health-check.sh** - 服务健康检查
   - 参数: 服务名或 all
   - 输出: 各服务状态（running/stopped）

3. **view-logs.sh** - 查看服务日志
   - 参数: 服务名、行数
   - 输出: 日志内容

4. **db-connect.sh** - 数据库连接
   - 参数: 数据库名（commerce/mcp/auth）
   - 输出: 连接信息或直接进入 psql

5. **create-test-user.sh** - 创建测试用户
   - 参数: 用户邮箱、角色
   - 输出: 用户 ID 和初始密码

6. **env-setup.sh** - 环境配置助手
   - 交互式设置本地 .env 文件
   - 检查依赖安装

**技术选择**：
- Shell 脚本（跨平台兼容）
- 使用 optima-ops-cli（已有47个运维命令）
- 错误处理和友好提示

### 3.4 NPM 包分发

**问题**：如何让团队成员方便安装和更新？

**方案**：**NPM 包 + 自动安装脚本**

**包名**: `@optima-ai/dev-skills`

**安装流程**:
```
用户运行: npm install -g @optima-ai/dev-skills
    ↓
postinstall 脚本自动执行
    ↓
复制 skills/ 到 ~/.claude/skills/optima-dev/
    ↓
复制 scripts/ 到 ~/.claude/skills/optima-dev/scripts/
    ↓
设置脚本执行权限
    ↓
完成提示
```

**更新流程**:
```
npm update -g @optima-ai/dev-skills
```

**优势**：
- 熟悉的 NPM 生态
- 版本管理（可回滚）
- 团队统一版本
- CI/CD 集成方便

## 4. 内容规范

### 4.1 SKILL.md 标准模板

每个 SKILL.md 包含以下部分：

**1. YAML Frontmatter**
- name
- description
- allowed-tools

**2. 服务概述**
- 一句话功能描述
- 核心能力列表

**3. 基本信息**
- 仓库 URL
- 技术栈
- 部署地址（生产/开发/Stage）
- API 文档地址
- 端口映射

**4. 快速开始**
- 本地开发启动命令
- 依赖安装
- 环境变量配置

**5. 认证信息**
- Token 获取方式
- API Key 位置
- OAuth 配置（如适用）

**6. 常用操作**
- 高频操作命令
- 健康检查
- 日志查看
- 数据库访问

**7. 相关链接**
- API 文档
- Swagger/OpenAPI
- 依赖的其他服务
- 关联仓库

**8. 故障排查**
- 常见错误和解决方案
- 调试技巧

### 4.2 文档写作原则

**DO（推荐）**:
- ✅ 使用标题和列表组织信息
- ✅ 提供清晰的命令引用（用反引号）
- ✅ 包含完整的 URL
- ✅ 说明命令的作用和参数
- ✅ 提供上下文和背景
- ✅ 使用表格展示结构化数据

**DON'T（避免）**:
- ❌ 直接粘贴大段代码（除非说明关键技术选择）
- ❌ 包含敏感信息（密钥、密码）
- ❌ 过于详细的实现细节（链接到源码）
- ❌ 重复已有文档（链接即可）
- ❌ 使用模糊的描述（"可能"、"大概"）

**代码示例的使用场景**（仅在这些情况下包含）:
1. 说明 API 调用格式
2. 展示配置文件结构
3. 解释关键技术选择
4. 提供快速验证命令

**示例对比**：

**❌ 不好的写法**（代码过多）:
```
## 创建商品

在 commerce-backend 中，创建商品的实现如下：

[50行 Python 代码]

这个函数首先验证输入，然后...
```

**✅ 好的写法**（引导为主）:
```
## 创建商品

**API 端点**: `POST /products`

**认证**: Bearer Token (ock_live_xxxxx)

**请求示例**:
curl -X POST https://api.optima.chat/products \
  -H "Authorization: Bearer ock_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"title": "Pearl Earrings", "price": 299}'

**完整 API 文档**: https://api.optima.chat/docs

**代码参考**: 查看 `app/routes/products.py` 中的 `create_product()` 函数
```

## 5. 实施计划

### 5.1 阶段划分

**Phase 1: 核心 Skills（第1周）**
- core/SKILL.md - 系统总览
- backend/ 3个核心服务
- frontend/ 2个主要应用
- onboarding/testing/ - 测试流程

**Phase 2: 工具和基础设施（第2周）**
- mcp-tools/ 4个 MCP 服务
- infrastructure/ 3个基础设施
- cli-tools/ 2个 CLI 工具

**Phase 3: 自动化和分发（第3周）**
- 6个自动化脚本
- NPM 包结构
- 安装测试
- 文档完善

**Phase 4: 团队验证（第4周）**
- 内部试用
- 收集反馈
- 迭代优化
- 正式发布

### 5.2 优先级排序

**P0（必需）**:
- core/SKILL.md
- backend/commerce-backend/
- backend/user-auth/
- onboarding/testing/
- scripts/get-token.sh
- scripts/health-check.sh

**P1（重要）**:
- frontend/agentic-chat/
- frontend/optima-store/
- mcp-tools/commerce-mcp/
- infrastructure/deployment/
- scripts/view-logs.sh
- scripts/create-test-user.sh

**P2（可选）**:
- mcp-tools/scout-mcp/
- mcp-tools/comfy-mcp/
- infrastructure/monitoring/
- cli-tools/

### 5.3 维护策略

**自动更新触发**：
- 服务地址变更
- 新增仓库
- API 重大变更
- 部署流程调整

**更新流程**：
1. 提交 PR 到 optima-dev-skills 仓库
2. Code Review
3. 合并后自动发布新版本 NPM 包
4. 团队成员运行 `npm update -g @optima-ai/dev-skills`

**版本管理**：
- 遵循 Semantic Versioning
- MAJOR：Skills 结构调整
- MINOR：新增 Skills
- PATCH：内容更新、错误修复

## 6. 成功指标

### 6.1 量化指标

**开发效率**:
- 新人环境搭建时间：从 4小时 降至 1小时
- 常见问题查询时间：从 5分钟 降至 30秒
- Token 获取时间：从 3分钟 降至 10秒

**使用率**:
- 团队成员安装率：100%
- 每周 Skill 加载次数：50+
- 脚本执行次数：20+/周

**质量指标**:
- 文档准确率：95%+
- 脚本成功率：98%+
- 用户满意度：4.5/5

### 6.2 定性指标

**开发体验**:
- 新人反馈：显著降低学习曲线
- 开发者反馈：减少上下文切换
- Claude Code 效率：更精准的回答

**知识管理**:
- 知识集中化：避免信息碎片化
- 知识时效性：易于更新
- 知识传承：新人快速上手

## 7. 风险和缓解

### 7.1 信息过时风险

**风险**：服务地址、API 变更后，Skills 未及时更新

**缓解措施**:
- CI/CD 集成健康检查，URL 失效时告警
- 每次部署变更后，自动 PR 提醒更新 Skills
- 每月定期 Review

### 7.2 敏感信息泄露

**风险**：不小心在 Skills 中包含密钥

**缓解措施**:
- PR Review 强制检查
- Git hooks 检测敏感信息
- NPM 包发布前扫描

### 7.3 Skills 加载失败

**风险**：YAML 格式错误，导致 Skill 无法加载

**缓解措施**:
- YAML 格式验证工具
- CI 自动检查所有 SKILL.md
- 提供验证脚本

### 7.4 维护负担

**风险**：27+ 仓库，维护 15 个 Skills 工作量大

**缓解措施**:
- 模板化内容生成
- 自动化信息提取（从 README/OpenAPI）
- 核心 Skills 优先维护

## 8. 附录

### 8.1 Claude Skills 技术参考

**官方文档**: https://docs.claude.com/en/docs/agents-and-tools/agent-skills

**核心特性**:
- Progressive Disclosure（渐进式加载）
- Metadata Scanning（~100 tokens）
- Full Content Loading（<5k tokens）
- Tool Restriction（allowed-tools）

**最佳实践**:
- Description 要包含关键词
- 内容组织清晰（标题、列表、表格）
- 避免冗余信息
- 提供可操作的指引

### 8.2 相关项目参考

**类似项目**:
- cc-chat - Claude Code 社区 CLI
- optima-ops-cli - 运维监控 CLI（47命令）
- awesome-claude-skills - 社区 Skills 集合

**技术栈对比**:
- cc-chat: TypeScript + NPM 包分发 ✅
- optima-ops-cli: TypeScript + 配置驱动 ✅
- 本项目: 结合两者优势

### 8.3 团队协作

**负责人**:
- 技术架构: 待定
- 内容编写: 待定
- 脚本开发: 待定
- 测试验证: 全员

**沟通渠道**:
- GitHub Issues: 功能需求和 Bug
- PR Review: 内容审核
- 周会: 进度同步

---

**文档版本**: 1.0.0
**最后更新**: 2025-11-23
**下一步**: 等待团队 Review 和确认关键技术决策
