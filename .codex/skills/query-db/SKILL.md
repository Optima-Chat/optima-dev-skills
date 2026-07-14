---
name: "query-db"
description: "Use when the user asks to query Optima databases, inspect rows, validate data, or run SQL in CI, Stage, Prod, cn-prod, or cn-stage."
---

# Query Databases

Use this skill for SQL queries against Optima service databases.

## Preferred Command

Always prefer:

```bash
optima-query-db <service> "<sql>" [environment]
```

## Environments

`ci` (default), `stage`, `prod`, `cn-prod` (Aliyun production), `cn-stage` (Aliyun staging).

The CLI takes **positional arguments only — there are no flags**. Pass the environment as the 3rd positional argument, e.g. `optima-query-db gateway-core "SELECT 1" cn-stage`. Flag-style tokens such as `--env` are rejected with an error (see issue #60).

For `cn-prod` / `cn-stage`, two extra env vars are required (the CLI prints an actionable error when missing; see https://github.com/Optima-Chat/optima-dev-skills/issues/21 ):

- `INFISICAL_CN_EMAIL` + `INFISICAL_CN_PASSWORD` — cn Infisical login (1Password "Infisical cn-prod admin (secrets-cn.optima.chat)")
- `OPTIMA_CN_BUILDBOX_PASSWORD` — buildbox ECS root password for the RDS tunnel (1Password "Aliyun cn-prod buildbox ECS (root)"); optional when a healthy tunnel already exists

## Services

- `commerce-backend`
- `user-auth`
- `agentic-chat`
- `bi-backend`
- `session-gateway`
- `optima-logistics`
- `billing`
- `browser-backend`
- `optima-generation`

## Guidance

- Default to `ci` when the user does not specify an environment.
- For `prod`, restrict usage to focused `SELECT` queries.
- Prefer explicit columns and `LIMIT` over `SELECT *`.
- Use the CLI instead of rebuilding Infisical and SSH tunnel steps manually.

## Fallback

If the CLI is unavailable, fall back to the documented manual SSH/Infisical workflow from the repository docs or Claude skill content.
