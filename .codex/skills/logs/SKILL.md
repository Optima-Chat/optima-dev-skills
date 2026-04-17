---
name: "logs"
description: "Use when the user asks to inspect service logs, debug runtime failures, or compare CI, Stage, and Prod logs for Optima services."
---

# Inspect Service Logs

Use this skill when the user needs service logs for debugging or operational checks.

## Preferred Flow

Use the local shell and follow the environment-specific workflow:

- `ci`: SSH to the shared CI host and read Docker Compose logs
- `stage`: read AWS CloudWatch logs from `/ecs/<service>-stage`
- `prod`: read AWS CloudWatch logs from `/ecs/<service>-prod` with `--region ap-southeast-1`

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

- Default to `ci` unless the user clearly requests `stage` or `prod`.
- For `prod`, keep the query narrow and use the exact service the user asked for.
- When investigating an error, read enough context around the failure instead of only grepping a single line.

## Related Skills

- `query-db` for data verification after log analysis
- `show-env` for configuration-related failures
- `restart-ecs` for controlled service restarts
