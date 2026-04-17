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

## Guidance

- Default to `stage`.
- Confirm the user email before running on `prod`.
- This operation replaces existing subscription state and resets credits according to the selected plan.
- Use `optima-query-db` afterward if the user asks for verification.
