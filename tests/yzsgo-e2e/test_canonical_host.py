"""The skill must target the canonical host app.yzsgo.com (dev-skills#111).

Since 2026-09-24 www.yzsgo.com and the apex 301 to app.yzsgo.com
(optima-terraform#467/#468), and the login state lives in localStorage, which is
per-origin. A default that still says www lands on app with nobody logged in,
so every run stops at attach().

Upstream pins the driver default with A34 (optima-store-skills#2567,
scripts/test-attach-login-state.py), but that needs playwright to import the
driver. CI here has no playwright, so these checks read the source with ast.
They cover the .claude copy and its .codex mirror, since scripts/install.js
ships both.
"""
import ast
import os
import sys
import unittest
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SKILLS = [os.path.join(ROOT, d, "skills", "yzsgo-e2e") for d in (".claude", ".codex")]


def _parse(skill, name):
    with open(os.path.join(skill, name), encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=name)


def default_chat_url(skill):
    """The literal default in `CHAT_URL = os.environ.get("YZSGO_CHAT_URL", <default>)`."""
    for node in _parse(skill, "chat_driver.py").body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "CHAT_URL"):
            call = node.value
            assert isinstance(call, ast.Call) and len(call.args) == 2, ast.dump(call)
            assert isinstance(call.args[0], ast.Constant) and call.args[0].value == "YZSGO_CHAT_URL"
            assert isinstance(call.args[1], ast.Constant), "default must be a string literal"
            return call.args[1].value
    raise AssertionError("module-level CHAT_URL assignment not found in chat_driver.py")


def module_classes(skill, name):
    return {n.name for n in _parse(skill, name).body if isinstance(n, ast.ClassDef)}


def handlers_around_attach(skill):
    """Exception names caught by the try statement that wraps run_e2e.py's attach() call."""
    for node in ast.walk(_parse(skill, "run_e2e.py")):
        if not isinstance(node, ast.Try):
            continue
        calls = [c for s in node.body for c in ast.walk(s)
                 if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr == "attach"]
        if calls:
            names = set()
            for h in node.handlers:
                t = h.type
                for e in (t.elts if isinstance(t, ast.Tuple) else [t]):
                    if isinstance(e, ast.Attribute):
                        names.add(e.attr)
                    elif isinstance(e, ast.Name):
                        names.add(e.id)
            return names
    return set()


class TestCanonicalHost(unittest.TestCase):
    def test_default_chat_url_is_app_host(self):
        for skill in SKILLS:
            url = default_chat_url(skill)
            self.assertEqual(urlparse(url).hostname, "app.yzsgo.com", f"{skill}: CHAT_URL default {url!r}")

    def test_default_chat_url_keeps_zh_hk_prefix(self):
        # Upstream A34: a bare /chat also passes login_state, but lands on another locale
        # and the skill-market controls are matched by their Traditional Chinese labels.
        for skill in SKILLS:
            url = default_chat_url(skill)
            self.assertTrue(urlparse(url).path.startswith("/zh-HK/"), f"{skill}: CHAT_URL default {url!r}")

    def test_bootstrap_launches_chrome_on_app_host(self):
        for skill in SKILLS:
            sys.path.insert(0, skill)
            try:
                sys.modules.pop("bootstrap", None)
                import bootstrap
                plan = bootstrap.plan_actions(["chrome-9222"])
            finally:
                sys.path.remove(skill)
                sys.modules.pop("bootstrap", None)
            [(name, [cmd])] = plan
            self.assertEqual(name, "launch-chrome")
            self.assertEqual(urlparse(cmd[-1]).hostname, "app.yzsgo.com", f"{skill}: {cmd}")

    def test_run_e2e_catches_login_gate_exceptions(self):
        # Upstream #2557: attach() raises these two instead of hanging when the origin has
        # no login state or the tab disappears mid-claim. Neither subclasses
        # TabSessionUnavailable, so run_e2e.py has to catch them by name.
        for skill in SKILLS:
            wanted = {"NeedsHumanLogin", "TabGoneDuringClaim"}
            self.assertLessEqual(wanted, module_classes(skill, "chat_driver.py"), skill)
            self.assertLessEqual(wanted, handlers_around_attach(skill), skill)

    def test_claude_and_codex_copies_match(self):
        claude, codex = SKILLS
        for name in sorted(os.listdir(claude)):
            if not name.endswith((".py", ".md", ".js")):
                continue
            with open(os.path.join(claude, name), "rb") as a, open(os.path.join(codex, name), "rb") as b:
                self.assertEqual(a.read(), b.read(), f".codex/skills/yzsgo-e2e/{name} differs from .claude copy")


if __name__ == "__main__":
    unittest.main()
