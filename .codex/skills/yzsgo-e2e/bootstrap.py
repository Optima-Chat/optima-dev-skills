#!/usr/bin/env python3
"""yzsgo-e2e 自举：把「能装的」依赖装好。**征得用户同意由 SKILL.md/Claude 负责问**，
本脚本只在被调用时执行对应动作。托管 venv 放 ~/.cache/yzsgo-e2e/venv——不碰系统 python
（macOS/发行版的系统 python 常是外部管理，pip install 会被拒），最稳、可复现、不污染。"""
import os, subprocess, sys

VENV = os.path.expanduser("~/.cache/yzsgo-e2e/venv")


def venv_python(base: str = VENV) -> str:
    return os.path.join(base, "bin", "python")


def plan_actions(missing_names: list, base: str = VENV) -> list:
    """纯函数：把缺项名映射成要执行的命令序列。供单测 + 让 Claude/用户预知会跑什么。
    返回 [(动作名, [[argv...], ...]), ...]。只覆盖 auto 类缺项（manual 类装不了，不在此）。"""
    plan = []
    for n in missing_names:
        if n == "venv+playwright":
            plan.append(("setup", [
                [sys.executable, "-m", "venv", base],
                [venv_python(base), "-m", "pip", "install", "-q", "playwright"],
                [venv_python(base), "-m", "playwright", "install", "chromium"],
            ]))
        elif n == "sshpass":
            plan.append(("install-sshpass", [["brew", "install", "hudochenkov/sshpass/sshpass"]]))
        elif n == "chrome-9222":
            plan.append(("launch-chrome", [[
                "open", "-na", "Google Chrome", "--args",
                "--remote-debugging-port=9222", "--user-data-dir=/tmp/yzsgo-chrome",
                "https://www.yzsgo.com"]]))
    return plan


def _run(cmds: list) -> bool:
    for c in cmds:
        print("+", " ".join(c))
        if subprocess.run(c).returncode != 0:
            print(f"[bootstrap] 命令失败：{' '.join(c)}", file=sys.stderr)
            return False
    return True


def _do(name: str) -> bool:
    plan = plan_actions([name])
    if not plan:
        print(f"[bootstrap] 无法自动处理 {name}（可能是 manual 类，需人工准备）", file=sys.stderr)
        return False
    return _run([c for _, cmds in plan for c in cmds])


# 动作名 → 触发它的缺项名
_CMD_TO_MISSING = {"setup": "venv+playwright", "install-sshpass": "sshpass", "launch-chrome": "chrome-9222"}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    miss = _CMD_TO_MISSING.get(cmd)
    if not miss:
        print(f"未知命令 {cmd}；可用：{' / '.join(_CMD_TO_MISSING)}", file=sys.stderr)
        sys.exit(2)
    ok = _do(miss)
    if cmd == "launch-chrome" and ok:
        print("已起调试端口 Chrome；请在弹出的窗口里手动登录测试账号（登一次即长期免登）。")
    sys.exit(0 if ok else 1)
