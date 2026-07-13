---
name: cn-deploy
description: 当用户请求把服务发布/部署/构建到 cn-stage、跑云效流水线、cn-stage 发版、部署某个分支到 cn-stage、触发 cn 构建、yunxiao 部署、"把 xx 发到 cn"时，使用此技能。覆盖 cn-stage 全部 20 个服务（构建→DB迁移→SAE 发布一条龙）。
---

# cn-deploy - 云效 cn-stage 流水线发布

## 用途

把服务的 GitHub 代码经云效 Flow 流水线发布到阿里云 cn-stage（SAE）。一条命令完成：
Codeup mirror 同步 → 构建（含 NEXT_PUBLIC 自动烤/境内镜像源改写）→ DB 迁移 → SAE 滚动发布 → 部署 sha 校验。

## 命令

```bash
optima-cn-deploy <service>                    # main 全链发布
optima-cn-deploy <service> --branch feat/xxx  # 非 main 分支构建+部署
optima-cn-deploy <service> --no-wait          # 只触发不等待
optima-cn-deploy --list                       # 列出全部可发服务
```

## 使用要点

1. **先 `--list` 确认服务名**（20 个服务，含 commerce-backend / optima-scout）。
2. 全链约 3-8 分钟（agentic-chat 最重）。触发后会输出云效 run 链接，可发给用户自行围观。
3. **凭证零配置**：构建凭证由云效变量组 `cn-stage-build-credentials`(41970) 供给，不需要注入任何 secret。
4. 分支构建会把该分支代码部署到 cn-stage（替换现运行版本）——用户明确要求部署分支时才用。
5. 失败排查：命令输出的 flow.aliyun.com 链接里看具体 step 日志；常见原因是该分支/仓的 Codeup mirror 凭证问题（命令会在 mirror 步就报错并中止，不会构建旧代码）。
6. 成功标准：最后一行 `✓ SAE ImageUrl tag=<sha>` —— 流水线绿且 SAE 真的钉到了目标 commit。只看流水线绿不算完成。

## 前置依赖

- `aliyun` CLI 已配置（profile 默认 `aliyun-optima`，可用环境变量 `OPTIMA_ALIYUN_PROFILE` 覆盖为自己的 RAM 用户 profile）
- `gh` 已登录（mirror 同步需要 GitHub token）

## 边界

- 只发 **cn-stage**，不发 cn-prod（cn-prod 发布另走人工卡点流程）。
- 服务注册表是 optima-terraform `alicloud/stacks/cn-prod-buildbox/yunxiao/` 的快照；新增服务先在那边 gen-pipelines 建好流水线，再同步本工具的 SERVICES 表。
