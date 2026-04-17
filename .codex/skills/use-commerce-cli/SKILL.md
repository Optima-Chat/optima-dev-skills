---
name: "use-commerce-cli"
description: "Use when the user wants to manage Optima commerce resources such as products, orders, inventory, collections, storefront content, or localization through the commerce CLI."
---

# Use Commerce CLI

Use this skill when the user wants to manage store resources through the `commerce` CLI.

## Requirements

Set both:

- `OPTIMA_TOKEN`
- `OPTIMA_ENV`

## Example

```bash
OPTIMA_TOKEN=$(cat /tmp/optima-test-token-xxx.txt) \
OPTIMA_ENV=ci \
commerce product list
```

## Guidance

- If the user does not already have a token, use the `generate-test-token` skill first.
- Match `OPTIMA_ENV` to the token environment.
- Prefer explicit commands over broad destructive bulk actions.
