# Optima Dev Skills For Codex

This repository provides shared development skills and CLI helpers for Optima engineers across `ci`, `stage`, `prod`, `cn-stage`, and `cn-prod` (Aliyun).

## Primary Entry Points

Prefer the installed CLI tools over reimplementing long shell workflows:

- `optima-query-db <service> "<sql>" [environment]`
- `optima-show-env <service> <stage|prod> [options]`
- `optima-generate-test-token [options]`
- `optima-grant-subscription <email> [options]`
- `optima-grant-credits <email|phone|userId> --credits <n> [options]`
- `optima-product <create|update|add-channel|toggle-channel|show> [options]` — manage paid-plugin marketplace Products + Stripe channels (Wave 1.5 admin endpoints; stage default)
- `optima-entitlement <grant|revoke|list> [options]` — admin-grant / revoke / list paid-plugin entitlements (refuses revoke of PAYMENT / PARTNER source)
- `optima-cn-deploy <service> [--branch feat/xxx] [--no-wait]` — 云效 Flow 发布到 cn-stage(mirror 同步→构建→DB 迁移→SAE 发布→sha 校验;20 服务,凭证由云效变量组供给零配置)
- `optima-plugin <show|set-paid|set-default|set-status> [options]` — flip a plugin's skills-side paid/free state (isPaid) + defaultForUser (the user-facing gate; pairs with optima-product for the billing side) + lifecycle status (ACTIVE|BETA|DEPRECATED — retire/restore a marketplace plugin)

For code-reading tasks across Optima repositories, use `gh` commands against `Optima-Chat/<repo>`.

## Installed Codex Skills

After `npm install -g @optima-chat/dev-skills`, this package installs skills under `~/.codex/skills/optima-dev/`. `scripts/install.js` copies every directory it finds, so the list below mirrors `.codex/skills/` exactly and is pinned by `tests/service-matrix-alignment.test.js` — adding a skill without updating this list turns the test red.

- `account`
- `cn-deploy`
- `entitlement`
- `generate-test-token`
- `grant-credits`
- `grant-subscription`
- `logs`
- `query-db`
- `read-code`
- `reset-onboarding`
- `restart-ecs`
- `show-env`
- `use-commerce-cli`
- `yzsgo-e2e`

`discount-codes` and `gateway-admin` exist under `.claude/skills/` only, so they are not installed for Codex.

## Tooling Assumptions

Most operational commands depend on local access to:

- `gh`
- `curl`
- `ssh` / `sshpass`
- `aws`
- `psql`

Some flows also require:

- GitHub Variables on `Optima-Chat/optima-dev-skills`
- Infisical access
- `~/.ssh/optima-ec2-key` for Stage/Prod database access

## Safety Rules

- Default to `ci` or `stage` when possible; on the Aliyun side, default to `cn-stage`.
- Treat `prod` and `cn-prod` as read-only unless the user explicitly asks for a write action — `cn-prod` holds real production user data.
- For `prod` / `cn-prod`, prefer limited queries and targeted operational commands.
- Do not expose secrets unless the user explicitly asks to inspect them.

## Platform Notes

- Claude Code uses `.claude/commands` and `.claude/skills`.
- Codex uses the installed skills plus this repository guidance.
- The shared source of truth for actual behavior is the CLI/helper implementation under `bin/helpers/`.
