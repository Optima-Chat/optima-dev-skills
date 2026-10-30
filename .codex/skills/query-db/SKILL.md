---
name: "query-db"
description: "Use when the user asks to query Optima databases, inspect rows, validate data, or run SQL in CI, Stage, Prod, cn-prod, or cn-stage."
---

# Query Databases

Use this skill for SQL queries against Optima service databases.

## Preferred Command

Always prefer:

```bash
optima-query-db <service> "<sql>" [environment]
```

## Environments

`ci` (default), `stage`, `prod`, `cn-prod` (Aliyun production), `cn-stage` (Aliyun staging).

Pass the environment as the 3rd positional argument (`optima-query-db gateway-core "SELECT 1" cn-stage`) or via the `--env` flag (`--env cn-stage`, consistent with optima-logs). Any other flag, extra positional argument, unknown environment name, or comment-only SQL is rejected with a hard error instead of a silent empty result (see issue #60).

For `cn-prod` / `cn-stage`, two extra env vars are required (the CLI prints an actionable error when missing; see https://github.com/Optima-Chat/optima-dev-skills/issues/21 ):

- `INFISICAL_CN_EMAIL` + `INFISICAL_CN_PASSWORD` — cn Infisical login (1Password "Infisical cn-prod admin (secrets-cn.optima.chat)")
- `OPTIMA_CN_BUILDBOX_PASSWORD` — buildbox ECS root password for the RDS tunnel (1Password "Aliyun cn-prod buildbox ECS (root)"); optional when a healthy tunnel already exists

AWS `stage`/`prod` Infisical config comes from GitHub Variables (4× `gh api`, 20s timeout, 3 attempts; #105). If api.github.com is flaky, bypass by exporting **all four** of `INFISICAL_URL` / `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` / `INFISICAL_PROJECT_ID`, or put them in `~/.infisical_aws_creds` (`chmod 600`; override path with `INFISICAL_AWS_CREDS_FILE`). A partial set is ignored with a warning.

## Services

- `commerce-backend`
- `user-auth`
- `agentic-chat`
- `bi-backend`
- `session-gateway`
- `optima-logistics`
- `billing`
- `browser-backend`
- `optima-generation`

## Guidance

- Default to `ci` when the user does not specify an environment.
- For `prod`, restrict usage to focused `SELECT` queries.
- Prefer explicit columns and `LIMIT` over `SELECT *`.
- Use the CLI instead of rebuilding Infisical and SSH tunnel steps manually.

## Closing tunnels: kill ONLY the pid the tool printed

Tunnels stay up in the background; the tool does not close them for you. But when you do
close one, **never kill by port or process pattern**:

```bash
# WRONG — this takes down other sessions' long-lived tunnels
ps -eo pid,args | grep 'ssh .*-L.*254' | awk '{print $1}' | xargs kill
pkill -f 'ssh.*25435'
```

Several Claude sessions on this machine may each hold their own tunnel, and a port pattern
cannot tell them apart — the one with a long `etime` is almost certainly not yours.

1. **Preferred: use the pids the tool printed.** When it opens a tunnel it prints
   `ℹ️ 本次新开了 DB 隧道：pid A,B, localhost:<port> → <host>. … 用完请 kill A B`
   Keep that line and kill exactly those pids. Do not filter it out of the output.
2. **If you no longer have that line** (e.g. the tunnel was opened in an earlier turn),
   claim by `CLAUDE_PID`:

   ```bash
   # print the owning session of each tunnel; kill only the ones whose owner is you
   for pid in $(pgrep -f 'ssh .*-L .*:.*rds'); do
     owner=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | sed -n 's/^CLAUDE_PID=//p')
     printf 'pid=%s owner=%s etime=%s\n' "$pid" "${owner:-<unreadable>}" "$(ps -o etime= -p $pid | tr -d ' ')"
   done
   ```

   Verified 2026-10-30: a freshly opened tunnel's `/proc/<pid>/environ` carries the
   `CLAUDE_PID` of the session that opened it. If the owner is unreadable, do not kill it.
3. **If neither works, leave it.** An idle tunnel costs almost nothing and the CLI reuses
   or reopens one on the next call; killing someone else's costs more.

**Why this is spelled out (two real incidents, same day):** on 2026-10-30 two different
sessions each killed by port pattern and took down other sessions' long-lived tunnels —
one of them a tunnel that had been up for two days. In both cases the other session's
**in-flight query died immediately** (`optima-query-db` reopens the tunnel on the next
call, so state recovers, but a running query does not). Both wrote the lesson only into
their own private memory, which the next person cannot see — hence this section.


## Fallback

If the CLI is unavailable, fall back to the documented manual SSH/Infisical workflow from the repository docs or Claude skill content.
