---
name: "generate-test-token"
description: "Use when the user needs a test merchant account, an access token for API testing, or a temporary account for CI, Stage, or Prod verification."
---

# Generate Test Access Tokens

Use this skill when the user needs a usable Optima merchant token for API testing.

## Preferred Command

```bash
optima-generate-test-token [options]
```

## Examples

```bash
optima-generate-test-token
optima-generate-test-token --env stage
optima-generate-test-token --business-name "Demo Shop" --env prod
```

## Guidance

- Default to `ci`.
- The command handles merchant registration, OAuth token creation, and merchant profile setup.
- The command writes the token to a temporary file; report that path back to the user.
- For `prod`, remind the user that the created account will exist in the production system.

## Follow-up

Use the generated token with `commerce` CLI commands or `curl` requests.
