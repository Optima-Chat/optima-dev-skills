---
name: "logs"
description: "Use when the user asks to inspect service logs, debug runtime failures, or compare logs across CI, Stage, Prod, cn-prod, and cn-stage for Optima services."
---

# Inspect Service Logs

Use this skill when the user needs service logs for debugging or operational checks.

## Preferred Flow

Use the local shell and follow the environment-specific workflow:

- `ci`: SSH to the shared CI host and read Docker Compose logs
- `stage`: read AWS CloudWatch logs from `/ecs/<service>-stage`
- `prod`: read AWS CloudWatch logs from `/ecs/<service>-prod` with `--region ap-southeast-1`
- `cn-prod` / `cn-stage`: Alibaba Cloud SAE (cn-beijing) — use `optima-logs <service> --env cn-prod|cn-stage`, which queries SLS directly (no buildbox hop)

## Common Services

- `commerce-backend`
- `user-auth`
- `agentic-chat`
- `bi-backend`
- `session-gateway`
- `optima-scout`
- `billing`
- `browser-backend`
- `optima-generation`

## Guidance

- Default to `ci` unless the user clearly requests another environment — note `ci` is the SSH + Docker Compose path, **not** `optima-logs`.
- 🔴 `optima-logs` with no `--env` defaults to **`cn-prod` (Alibaba Cloud production)**, not `ci` (see `bin/helpers/logs.ts`). Always pass `--env` explicitly, or you will be reading production logs while believing you are reading CI.
- For `prod`, keep the query narrow and use the exact service the user asked for.
- When investigating an error, read enough context around the failure instead of only grepping a single line.

## Related Skills

- `query-db` for data verification after log analysis
- `show-env` for configuration-related failures
- `restart-ecs` for controlled service restarts
