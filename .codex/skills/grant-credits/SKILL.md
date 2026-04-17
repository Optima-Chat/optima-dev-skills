---
name: "grant-credits"
description: "Use when the user wants to add bonus or referral credits to an Optima user without changing their subscription."
---

# Grant Credits

Use this skill when the user asks to add credits directly.

## Preferred Command

```bash
optima-grant-credits <email> --amount <n> [options]
```

## Examples

```bash
optima-grant-credits user@example.com --amount 100
optima-grant-credits user@example.com --amount 500 --env prod
optima-grant-credits user@example.com --amount 300 --type referral --env prod
```

## Guidance

- Default to `stage`.
- Confirm the email and amount before using `prod`.
- This operation appends credits and does not replace the user's subscription.
