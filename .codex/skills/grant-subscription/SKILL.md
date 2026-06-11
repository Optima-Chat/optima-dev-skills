---
name: "grant-subscription"
description: "Use when the user wants to grant or change a subscription plan such as trial, starter, pro, or enterprise for an Optima user."
---

# Grant Subscriptions

Use this skill when the user asks to open or change a subscription plan.

## Preferred Command

```bash
optima-grant-subscription <email> [options]
```

## Examples

```bash
optima-grant-subscription user@example.com
optima-grant-subscription user@example.com --plan starter --months 3
optima-grant-subscription user@example.com --plan enterprise --env prod
```

```bash
# cn-prod（国内环境）：plan 用 -cn 档，默认 pro-cn
optima-grant-subscription user@example.com --env cn-prod
optima-grant-subscription user@example.com --plan starter-cn --env cn-prod
```

## Guidance

- Default to `stage`.
- Confirm the user email before running on `prod` / `cn-prod`.
- `cn-prod` plans are the CNY-priced `-cn` ids (`starter-cn`, `pro-cn`, `enterprise-cn`, plus `trial`); bare USD ids are rejected client-side to avoid granting a USD-priced plan to a CN user.
- This operation replaces existing subscription state and resets the wallet granted balance according to the selected plan.
- Use `optima-query-db` afterward if the user asks for verification.
