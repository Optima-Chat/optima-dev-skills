---
name: cn-deploy
description: 当用户请求把服务发布/部署/构建到 cn-stage、跑云效流水线、cn-stage 发版、部署某个分支到 cn-stage、触发 cn 构建、yunxiao 部署、"把 xx 发到 cn"时，使用此技能。覆盖 cn-stage 全部 21 个服务（构建→DB迁移→SAE 发布一条龙；含 build-only 的 agent-runtime）。
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

1. **先 `--list` 确认服务名**（21 个服务，含 commerce-backend / optima-scout / build-only 的 agent-runtime）。
2. 全链约 3-8 分钟（agentic-chat 最重）。触发后会输出云效 run 链接，可发给用户自行围观。
3. **凭证零配置**：构建凭证由云效变量组 `cn-stage-build-credentials`(41970) 供给，不需要注入任何 secret。
4. 分支构建会把该分支代码部署到 cn-stage（替换现运行版本）——用户明确要求部署分支时才用。
5. 失败排查：命令输出的 flow.aliyun.com 链接里看具体 step 日志；常见原因是该分支/仓的 Codeup mirror 凭证问题（命令会在 mirror 步就报错并中止，不会构建旧代码）。
6. 成功标准：最后一行 `✓ SAE ImageUrl tag=<sha>` —— 流水线绿且 SAE 真的钉到了目标 commit。只看流水线绿不算完成。
7. **build-only 服务（`agent-runtime`）**：非 SAE 常驻（gateway-core 按 session 拉起的镜像）。成功标准不是 SAE ImageUrl，而是流水线绿即可——release 段自动把 ACR digest 回写 Infisical `/services/gateway-core/ALIYUN_AGENT_RUNTIME_IMAGE`(#807) 并滚动重启 gateway-core（任一步失败即 exit 非 0）。工具最后一行为 `✓ 流水线 SUCCESS(build-only)…` —— CLI 以流水线终态为准，未独立校验 Infisical/gateway-core（digest 与重启变更单见 run『发版』段日志）。


## cn-prod vtag 发版（⚠️ 待 svenyang 首次验证通过后再日常使用）

```bash
optima-cn-deploy <service> --vtag cn-v1.2.3               # 先 stage 同 tag 验证
optima-cn-deploy <service> --env prod --vtag cn-v1.2.3    # prod 发版
```

- prod 是 vtag 制：必须先 `git tag cn-vX.Y.Z && git push`，工具拒绝无 vtag / 裸 v* / 带 --branch 的 prod 请求
- prod 流水线构建后**停在人工卡点**（xbfool/svenyang 在云效控制台审批），之后 DB 迁移 + digest 钉死部署自动走完
- 成功标准：prod SAE ImageUrl 为 `@sha256:` digest 寻址（工具最后一行校验）
- 用户请求发 cn-prod 时：确认已有 stage 验证过的 cn-v tag；没有则先引导走 stage

## 前置依赖

- `aliyun` CLI 已配置（profile 默认 `aliyun-optima`，可用环境变量 `OPTIMA_ALIYUN_PROFILE` 覆盖为自己的 RAM 用户 profile）
- `gh` 已登录（mirror 同步需要 GitHub token）

## 边界

- cn-prod 仅走 vtag 制（见上），且有人工卡点闸门；日常无 vtag 的构建只发 cn-stage。
- 服务注册表是 optima-terraform `alicloud/stacks/cn-prod-buildbox/yunxiao/` 的快照；新增服务先在那边 gen-pipelines 建好流水线，再同步本工具的 SERVICES 表。
