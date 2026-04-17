---
name: "restart-ecs"
description: "Use when the user asks to restart or redeploy an ECS service in Stage or Prod."
---

# Restart ECS Services

Use this skill when the user needs an ECS service restart.

## Preferred Workflow

Use AWS ECS `update-service --force-new-deployment` against the correct cluster:

- `optima-stage-cluster`
- `optima-prod-cluster`

## Guidance

- Default to `stage`.
- Confirm before restarting `prod`.
- Treat this as an operational change, not a debugging shortcut; read logs first when possible.
- After triggering the restart, check service deployment status if the user asks for confirmation.
