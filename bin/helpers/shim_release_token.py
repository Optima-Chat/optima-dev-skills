#!/usr/bin/env python3
"""Portable encrypted optima-shim build-token refresh; no pipeline/deploy action.

Canonical source: optima-terraform yunxiao/shim_release_token.py. The dev-skills
package vendors these exact bytes so its installed CLI needs no Terraform clone.
"""
import argparse
import json
import os
import re
import subprocess
from urllib.parse import urlencode

ORG = "6a17b6282bf8b1184fc0e0c6"
EP = "devops.cn-hangzhou.aliyuncs.com"
PROF = "aliyun-optima"
BUILDBOX = "root@47.94.105.163"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]

# Runtime envs are NOT secret/masked in Flow. Keep this token in a dedicated
# encrypted variable group; never send it through StartPipelineRun params.
SHIM_TOKEN_KEY = "OPTIMA_SHIM_GITHUB_TOKEN"


def shim_group_api(method, group_id="", body=None, query=None):
    """Secret-safe ROA request: anonymous RAM fd, no body/response in logs/argv."""
    cmd = ["aliyun", "devops", method, f"/organization/{ORG}/variableGroups" + (f"/{group_id}" if group_id else ""),
           "--endpoint", EP, "--profile", PROF]
    for key, value in (query or {}).items():
        cmd += [f"--{key}", str(value)]
    fd = None
    try:
        if body is not None:
            fd = os.memfd_create("shim-variable-group", os.MFD_CLOEXEC)
            os.write(fd, urlencode(body).encode())
            os.lseek(fd, 0, os.SEEK_SET)
            cmd += ["--header", "Content-Type=application/x-www-form-urlencoded",
                    "--body-file", f"/proc/self/fd/{fd}"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                                pass_fds=(() if fd is None else (fd,)))
        data = json.loads(result.stdout)
        if result.returncode != 0 or not isinstance(data, dict) or data.get("success") is not True:
            raise ValueError("unsuccessful API response")
        return data
    except (OSError, ValueError, subprocess.SubprocessError):
        # CLI errors may echo request bodies, including on otherwise valid JSON.
        raise SystemExit("✗ shim encrypted variable-group API failed; response suppressed") from None
    finally:
        if fd is not None:
            os.close(fd)


def find_shim_group(environment):
    """Exact unique name across bounded pages. Never print group values."""
    expected = f"agent-runtime-shim-{environment}"
    matches, seen, cursor, count = [], set(), "", 0
    total = None
    for _ in range(20):
        query = {"maxResults": 100}
        if cursor:
            query["nextToken"] = cursor
        data = shim_group_api("GET", query=query)
        groups = data.get("variableGroups")
        if not isinstance(groups, list):
            raise SystemExit("✗ invalid shim variable-group listing")
        count += len(groups)
        reported = data.get("totalCount")
        if reported is not None:
            if not isinstance(reported, int) or reported < 0 or (total is not None and total != reported):
                raise SystemExit("✗ inconsistent shim variable-group totalCount")
            total = reported
        matches.extend(g for g in groups if g.get("name") == expected)
        cursor = data.get("nextToken") or ""
        if not cursor:
            if total is not None and count != total:
                raise SystemExit("✗ incomplete shim variable-group listing")
            if len(matches) != 1:
                raise SystemExit("✗ expected exactly one dedicated shim variable group; configure it first")
            return str(matches[0].get("id", ""))
        if cursor in seen:
            break
        seen.add(cursor)
    raise SystemExit("✗ shim variable-group pagination incomplete; refusing ambiguous selection")


def refresh_shim_token(service, environment, pipeline_id, group_id=None):
    if service != "agent-runtime":
        return
    group_id = group_id or find_shim_group(environment)
    if not re.fullmatch(r"[1-9][0-9]*", str(group_id)):
        raise SystemExit("✗ invalid dedicated shim variable-group ID")
    expected_name = f"agent-runtime-shim-{environment}"
    group = shim_group_api("GET", group_id).get("variableGroup", {})
    variables = group.get("variables", [])
    related = group.get("relatedPipelines", [])
    if (group.get("name") != expected_name or str(group.get("id")) != str(group_id)
            or len(variables) != 1 or variables[0].get("name") != SHIM_TOKEN_KEY
            or variables[0].get("isEncrypted") is not True
            or {str(p.get("id")) for p in related} != {str(pipeline_id)}):
        raise SystemExit("✗ shim group must contain only its encrypted token and belong only to this pipeline")
    # Existing buildbox key stays on buildbox. Explicit --repo replaces defaults.
    command = ("set +x; set -a; . /etc/cn-deploy/gh-app-codeup-mirror.env; set +a; "
               "/usr/local/bin/gh-app-codeup-token --repo optima-shim")
    # Same local password-file entry used by the existing buildbox tooling;
    # sshpass reads the file itself, never exposing its contents in arguments.
    password_file = os.path.expanduser("~/.buildbox_pw")
    ssh = (["sshpass", "-f", password_file, "ssh", "-o", "ConnectTimeout=8",
            "-o", "NumberOfPasswordPrompts=1"] if os.path.isfile(password_file) else SSH)
    try:
        minted = subprocess.run([*ssh, BUILDBOX, command], capture_output=True, text=True, timeout=45)
    except (OSError, subprocess.SubprocessError):
        raise SystemExit("✗ shim token mint failed; output suppressed") from None
    token = minted.stdout.strip()
    if minted.returncode != 0 or not re.fullmatch(r"ghs_[A-Za-z0-9_]+", token):
        raise SystemExit("✗ shim token mint failed; output suppressed")
    shim_group_api("PUT", group_id, {"name": expected_name,
        "description": "Build-only optima-shim contents:read installation token; expires in 1h",
        "variables": json.dumps([{"name": SHIM_TOKEN_KEY, "isEncrypted": True, "value": token}])})
    # Refresh does not revoke any previously minted token. Concurrent refreshes
    # have identical repo/read scope; either valid token is sufficient. No cleanup
    # writes blank/stale values into the shared group. Queued jobs after expiry fail
    # closed and must be started again through cn-run to mint a fresh token.
    print("  shim: dedicated encrypted group refreshed (single-repo/read-only, 1h)")


def main():
    global PROF
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", choices=["stage", "prod"], required=True)
    parser.add_argument("--pipeline-id", type=int, required=True)
    parser.add_argument("--profile", default="aliyun-optima")
    args = parser.parse_args()
    PROF = args.profile
    refresh_shim_token("agent-runtime", args.env, args.pipeline_id)


if __name__ == "__main__":
    main()
