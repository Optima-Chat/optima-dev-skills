# Optima Dev Skills For Codex

This repository provides shared development skills and CLI helpers for Optima engineers across `ci`, `stage`, and `prod`.

## Primary Entry Points

Prefer the installed CLI tools over reimplementing long shell workflows:

- `optima-query-db <service> "<sql>" [environment]`
- `optima-show-env <service> <stage|prod> [options]`
- `optima-generate-test-token [options]`
- `optima-grant-subscription <email> [options]`
- `optima-grant-credits <email|phone|userId> --credits <n> [options]`
- `optima-product <create|update|add-channel|toggle-channel|show> [options]` — manage paid-plugin marketplace Products + Stripe channels (Wave 1.5 admin endpoints; stage default)
- `optima-entitlement <grant|revoke|list> [options]` — admin-grant / revoke / list paid-plugin entitlements (refuses revoke of PAYMENT / PARTNER source)
- `optima-plugin <show|set-paid|set-default> [options]` — flip a plugin's skills-side paid/free state (isPaid) + defaultForUser (the user-facing gate; pairs with optima-product for the billing side)

For code-reading tasks across Optima repositories, use `gh` commands against `Optima-Chat/<repo>`.

## Installed Codex Skills

After `npm install -g @optima-chat/dev-skills`, this package installs skills under `~/.codex/skills/optima-dev/`:

- `logs`
- `query-db`
- `show-env`
- `generate-test-token`
- `read-code`
- `grant-subscription`
- `grant-credits`
- `restart-ecs`
- `use-commerce-cli`

## Tooling Assumptions

Most operational commands depend on local access to:

- `gh`
- `curl`
- `ssh` / `sshpass`
- `aws`
- `psql`

Some flows also require:

- GitHub Variables on `Optima-Chat/optima-dev-skills`
- Infisical access
- `~/.ssh/optima-ec2-key` for Stage/Prod database access

## Safety Rules

- Default to `ci` or `stage` when possible.
- Treat `prod` as read-only unless the user explicitly asks for a write action.
- For `prod`, prefer limited queries and targeted operational commands.
- Do not expose secrets unless the user explicitly asks to inspect them.

## Platform Notes

- Claude Code uses `.claude/commands` and `.claude/skills`.
- Codex uses the installed skills plus this repository guidance.
- The shared source of truth for actual behavior is the CLI/helper implementation under `bin/helpers/`.
