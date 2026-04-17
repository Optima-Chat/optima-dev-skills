---
name: "read-code"
description: "Use when the user wants to inspect code, repository structure, implementation details, or compare repositories under the Optima-Chat GitHub organization."
---

# Read Optima Repositories

Use this skill when the user asks to inspect code from another Optima repository.

## Preferred Tools

Use GitHub CLI against `Optima-Chat/<repo>`:

- `gh repo view`
- `gh api repos/Optima-Chat/<repo>/contents/...`
- `gh search code ... --repo Optima-Chat/<repo>`

## Common Repositories

- `commerce-backend`
- `user-auth`
- `mcp-host`
- `agentic-chat`
- `commerce-mcp`
- `shopify-mcp`
- `google-ads-mcp`
- `optima-store`
- `commerce-cli`
- `optima-terraform`

## Guidance

- Read `README.md` or `CLAUDE.md` first when present.
- For large files, use the GitHub `download_url` or raw content endpoint.
- Prefer targeted code search before opening many files.
