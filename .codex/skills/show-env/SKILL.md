---
name: "show-env"
description: "Use when the user asks to inspect environment variables, service configuration, or Infisical-backed settings for Stage or Prod."
---

# Inspect Environment Configuration

Use this skill to inspect current shell environment variables or service configuration stored in Infisical.

## Preferred Command

```bash
optima-show-env <service> <stage|prod> [options]
```

## Common Options

```bash
optima-show-env commerce-backend stage --filter DATABASE
optima-show-env user-auth prod --keys-only
```

## Guidance

- For local shell variables, simple shell commands like `env` or `echo $VAR` are enough.
- For service configuration, prefer `optima-show-env` over raw Infisical API calls.
- If the user only needs key names, use `--keys-only` to avoid exposing values unnecessarily.
