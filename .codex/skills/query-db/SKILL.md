---
name: "query-db"
description: "Use when the user asks to query Optima databases, inspect rows, validate data, or run SQL in CI, Stage, or Prod."
---

# Query Databases

Use this skill for SQL queries against Optima service databases.

## Preferred Command

Always prefer:

```bash
optima-query-db <service> "<sql>" [environment]
```

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
