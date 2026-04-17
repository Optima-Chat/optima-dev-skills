# Codex Migration Notes

This repository now supports both Claude Code and Codex from the same npm package.

## Compatibility Model

The package is split into three layers:

1. Execution layer
   `bin/helpers/*.ts` contains the actual implementation for database access, environment inspection, token generation, and account operations.

2. Claude adapter layer
   `.claude/commands/*` and `.claude/skills/*` keep the existing Claude Code workflow intact.

3. Codex adapter layer
   `.codex/skills/*` and `AGENTS.md` provide the Codex-facing usage guidance.

## Installation Behavior

`npm install -g @optima-chat/dev-skills` now installs:

- Claude commands into `~/.claude/commands`
- Claude skills into `~/.claude/skills`
- Codex skills into `~/.codex/skills/optima-dev`

If `CODEX_HOME` is set, Codex skills are installed into `$CODEX_HOME/skills/optima-dev` instead.

## Mapping Strategy

Claude slash commands are not copied verbatim into Codex. Codex skills instead describe:

- when to use the capability
- which CLI to prefer
- what fallback shell workflow exists
- what safety rules apply

That keeps Codex guidance focused on intent and local command execution rather than Claude-specific slash command semantics.

## Maintenance Rules

- Keep implementation logic in `bin/helpers/*`.
- Keep Claude-specific UX only in `.claude/*`.
- Keep Codex-specific UX only in `.codex/*`.
- When behavior changes, update both `.claude/skills/*` and `.codex/skills/*` if the user-facing workflow changes.
