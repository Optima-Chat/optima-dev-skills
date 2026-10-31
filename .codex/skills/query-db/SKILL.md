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

## Tunnels are shared across sessions: by default, do NOT close them

A tunnel is not yours. The registry `~/.cache/optima-dev-skills/tunnel-ports.json` is shared
by every session, and `ensureTunnel` reuses whatever is on the recorded port as long as it is
healthy (`isTunnelHealthy(known) → return known` in `db-utils.ts`) — **it does not check who
opened it**. The source comment says so: "不自动关……且别人可能在复用这条" (do not auto-close;
someone else may be reusing this one).

⇒ **The default rule is: leave it.** An idle tunnel costs almost nothing and the CLI reuses or
reopens one on the next call, whereas closing a tunnel that someone is reusing kills **their
in-flight query** immediately.

### All of these are wrong

```bash
# WRONG — port/process patterns cannot tell ownership; a long `etime` is almost certainly not yours
ps -eo pid,args | grep 'ssh .*-L.*254' | awk '{print $1}' | xargs kill
pkill -f 'ssh.*25435'
lsof -ti:25435 | xargs kill        # also kills other sessions' psql connected to that port
```

**"Kill the pid the tool printed" is not safe either.** Only the session that *opened* the
tunnel gets that line; sessions that later *reuse* it get no hint at all. If A opened T and B is
reusing T, A following that line kills B's query. For the same reason `CLAUDE_PID` identifies
**who opened it, not who is using it**.

As of `0.16.23` the hint the tool prints is fixed (it now says the tunnel is long-lived, may be
reused by other sessions, and must not be closed casually, and points back to this section).
**But the copy installed in your process may still be older**: before `0.16.23` it printed
`用完请 kill <pids>` with an `lsof -ti:<port> | xargs kill` fallback. If you see that wording you
are on a pre-`0.16.23` build — do not follow it; this section wins.

### If you really must close one

Only when you know no other connection is using it:

```bash
# 1) count ESTABLISHED connections on that port. NOTE the word order: `state` must come
#    BEFORE the address expression (`ss -tnp "(…)" state established` errors with
#    `state does not look like a port` while still exiting 0 — a false "no connections");
#    `-H` drops the header, which would otherwise make the output never empty.
n=$(ss -H -tnp state established "( sport = :<port> or dport = :<port> )" | grep -c .)
# 2) only when n is 0, kill exactly the pids the tool printed (still never by port)
[ "$n" -eq 0 ] && kill <pid…>
```

(Verified 2026-10-30 in both directions: `n=2` with one live connection on the port, `n=0` with none.)

If unsure, leave it.

**Why this is spelled out (two real incidents, same day):** on 2026-10-30 two different sessions
each killed by port pattern and took down other sessions' long-lived tunnels — one up for two
days. In both cases the other session's **in-flight query died immediately** (the CLI reopens the
tunnel on the next call, so state recovers, but a running query does not). Both wrote the lesson
only into their own private memory, which the next person cannot see — hence this section.

Note: query-db is not the only tunnel opener — `resolveUserId` also tunnels to RDS on AWS, and
`account` / `entitlement` / `grant-credits` / `grant-subscription` all go through it and print the
same hint. Also, AWS defaults to **SSM** (`OPTIMA_DB_TUNNEL` defaults to `ssm`), whose tunnel
process is **not** `ssh`, so anything that matches processes by `ssh` will miss it there.


## Fallback

If the CLI is unavailable, fall back to the documented manual SSH/Infisical workflow from the repository docs or Claude skill content.
