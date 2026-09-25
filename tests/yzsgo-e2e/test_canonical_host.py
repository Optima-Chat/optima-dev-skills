"""The skill must drive the canonical host app.yzsgo.com (dev-skills#111).

Since 2026-09-24 www.yzsgo.com and the apex 301 to app.yzsgo.com
(optima-terraform#467/#468), path kept, and the login state lives in
localStorage, which is per-origin. The old www default still ends up on app
through the redirect; what breaks runs is a debug Chrome that only ever logged
in on www. The override here keeps the target URL on the canonical host (no
redirect hop, one origin everywhere) and matches upstream #2567; the re-login
itself is documented in SKILL.md.

chat_driver.py stays verbatim at upstream 010c578a, whose built-in default is
still www, so run_e2e.py sets YZSGO_CHAT_URL before importing it. These tests run
run_e2e.main() against stand-in modules to capture the value the driver sees at
import time, then import the real vendored driver with playwright stubbed out
(the same trick upstream's scripts/test-attach-login-state.py uses) to confirm
it takes that value. No browser, no playwright install. Both the .claude copy
and its .codex mirror are checked, since scripts/install.js ships both.
"""
import contextlib
import importlib
import io
import os
import sys
import tempfile
import types
import unittest
from unittest import mock
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SKILLS = [os.path.abspath(os.path.join(ROOT, d, "skills", "yzsgo-e2e")) for d in (".claude", ".codex")]
APP_CHAT = "https://app.yzsgo.com/zh-HK/chat"
DRIVER_DEPS = ("preflight", "chat_driver", "pull_wire", "prep_conversation")

# Stand-ins for run_e2e's lazily imported modules. chat_driver records the env it
# was imported under; preflight reports "not ok" so main() exits right after the imports.
FAKES = {
    "chat_driver.py": "import os\nSEEN = os.environ.get('YZSGO_CHAT_URL')\n",
    "preflight.py": ("def probe(env):\n    return {}\n"
                     "def summarize_preflight(p):\n    return {'ok': False, 'report': 'stub'}\n"),
    "pull_wire.py": "",
    "prep_conversation.py": "",
}


def _fresh(names):
    for n in names:
        sys.modules.pop(n, None)


def url_seen_by_driver(skill, env_value=None):
    """Run run_e2e.main() from `skill`; return YZSGO_CHAT_URL as the driver saw it on import."""
    with tempfile.TemporaryDirectory() as fake_dir, tempfile.TemporaryDirectory() as out:
        for name, src in FAKES.items():
            with open(os.path.join(fake_dir, name), "w", encoding="utf-8") as fh:
                fh.write(src)
        env = {k: v for k, v in os.environ.items() if k != "YZSGO_CHAT_URL"}
        if env_value is not None:
            env["YZSGO_CHAT_URL"] = env_value
        argv = ["run_e2e.py", "--message", "hi", "--user", "u-test", "--out", out]
        _fresh(DRIVER_DEPS + ("run_e2e",))
        # Fakes first so they shadow the real preflight/chat_driver next to run_e2e.py.
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(sys, "argv", argv), \
                mock.patch.object(sys, "path", [fake_dir, skill] + sys.path), \
                contextlib.redirect_stdout(io.StringIO()):
            run_e2e = importlib.import_module("run_e2e")
            with CatchExit() as code:
                run_e2e.main()
            seen = sys.modules["chat_driver"].SEEN
        _fresh(DRIVER_DEPS + ("run_e2e",))
        assert code == [2], f"expected the stub preflight to stop main() with exit 2, got {code}"
        return seen


class CatchExit:
    """Context manager that swallows SystemExit and records its code."""
    def __enter__(self):
        self.code = []
        return self.code

    def __exit__(self, exc_type, exc, tb):
        if exc_type is SystemExit:
            self.code.append(exc.code)
            return True
        return False


def real_driver_chat_url(skill, env_value):
    """CHAT_URL computed by the real vendored chat_driver.py when imported under `env_value`."""
    pw = types.ModuleType("playwright")
    sync_api = types.ModuleType("playwright.sync_api")
    sync_api.sync_playwright = lambda: None
    pw.sync_api = sync_api
    _fresh(("chat_driver",))
    with mock.patch.dict(sys.modules, {"playwright": pw, "playwright.sync_api": sync_api}), \
            mock.patch.dict(os.environ, {"YZSGO_CHAT_URL": env_value}), \
            mock.patch.object(sys, "path", [skill] + sys.path):
        try:
            return importlib.import_module("chat_driver").CHAT_URL
        finally:
            _fresh(("chat_driver",))


class TestCanonicalHost(unittest.TestCase):
    def test_run_e2e_defaults_driver_to_app_host(self):
        for skill in SKILLS:
            url = url_seen_by_driver(skill)
            self.assertEqual(url, APP_CHAT, skill)
            # /zh-HK stays: the skill market is matched by its Traditional Chinese labels.
            self.assertEqual(urlparse(url).hostname, "app.yzsgo.com", skill)
            self.assertTrue(urlparse(url).path.startswith("/zh-HK/"), skill)

    def test_run_e2e_keeps_explicit_override(self):
        stage = "https://app.stage.optima.chat/zh-HK/chat"
        for skill in SKILLS:
            self.assertEqual(url_seen_by_driver(skill, stage), stage, skill)

    def test_vendored_driver_takes_the_env_value(self):
        for skill in SKILLS:
            self.assertEqual(real_driver_chat_url(skill, APP_CHAT), APP_CHAT, skill)

    def test_bootstrap_launches_chrome_on_app_host(self):
        for skill in SKILLS:
            _fresh(("bootstrap",))
            with mock.patch.object(sys, "path", [skill] + sys.path):
                plan = importlib.import_module("bootstrap").plan_actions(["chrome-9222"])
            _fresh(("bootstrap",))
            [(name, [cmd])] = plan
            self.assertEqual(name, "launch-chrome")
            self.assertEqual(urlparse(cmd[-1]).hostname, "app.yzsgo.com", f"{skill}: {cmd}")

    def test_claude_and_codex_copies_match(self):
        claude, codex = SKILLS
        for name in sorted(os.listdir(claude)):
            if not name.endswith((".py", ".md", ".js")):
                continue
            with open(os.path.join(claude, name), "rb") as a, open(os.path.join(codex, name), "rb") as b:
                self.assertEqual(a.read(), b.read(), f".codex/skills/yzsgo-e2e/{name} differs from .claude copy")


if __name__ == "__main__":
    unittest.main()
