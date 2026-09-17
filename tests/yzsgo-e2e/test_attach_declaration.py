"""Every attach() call in this skill must satisfy the vendored driver's signature.

chat_driver.py is vendored verbatim from optima-store-skills, which turned
`ziniao` into a required keyword-only argument of ChatDriver.attach() (#611).
Re-syncing the driver without updating the callers breaks run_e2e.py with a
TypeError at the very first step -- and the only import test is skipped when
playwright is missing, so nothing else in tests/ would notice. This test reads
both sides with ast, so it needs no playwright and no browser. It checks the
.claude copy and its .codex mirror, since install.js ships both.
"""
import ast
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SKILLS = [os.path.join(ROOT, d, "skills", "yzsgo-e2e") for d in (".claude", ".codex")]


def _parse(skill, name):
    with open(os.path.join(skill, name), encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=name)


def _attach_args(skill):
    for node in ast.walk(_parse(skill, "chat_driver.py")):
        if isinstance(node, ast.ClassDef) and node.name == "ChatDriver":
            for fn in node.body:
                if isinstance(fn, ast.FunctionDef) and fn.name == "attach":
                    return fn.args
    raise AssertionError("ChatDriver.attach not found in chat_driver.py")


def required_attach_kwonly(skill):
    """Required keyword-only parameters of ChatDriver.attach in the vendored driver."""
    a = _attach_args(skill)
    return [p.arg for p, d in zip(a.kwonlyargs, a.kw_defaults) if d is None]


def accepted_attach_keywords(skill):
    """(names attach() accepts by keyword, whether it has **kwargs)."""
    a = _attach_args(skill)
    return {p.arg for p in a.args[1:] + a.kwonlyargs}, a.kwarg is not None


def attach_calls(skill):
    """(file, lineno, call) for every `<expr>.attach(...)` outside the driver itself."""
    out = []
    for name in sorted(os.listdir(skill)):
        if not name.endswith(".py") or name == "chat_driver.py":
            continue
        for node in ast.walk(_parse(skill, name)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "attach"):
                out.append((name, node.lineno, node))
    return out


class TestAttachDeclaration(unittest.TestCase):
    def test_run_e2e_calls_attach(self):
        # guard against this test silently checking nothing
        for skill in SKILLS:
            with self.subTest(skill=skill):
                self.assertIn("run_e2e.py", {f for f, _, _ in attach_calls(skill)})

    def test_every_call_passes_required_kwonly(self):
        for skill in SKILLS:
            required = required_attach_kwonly(skill)
            for name, line, call in attach_calls(skill):
                with self.subTest(skill=skill, call=f"{name}:{line}"):
                    passed = {k.arg for k in call.keywords}
                    missing = [r for r in required if r not in passed]
                    self.assertEqual(missing, [], f"{name}:{line} attach() is missing {missing}")

    def test_every_passed_keyword_is_accepted(self):
        # the other direction: if upstream drops or renames a parameter, the caller breaks too
        for skill in SKILLS:
            accepted, has_var_kw = accepted_attach_keywords(skill)
            for name, line, call in attach_calls(skill):
                with self.subTest(skill=skill, call=f"{name}:{line}"):
                    unknown = [] if has_var_kw else [k.arg for k in call.keywords
                                                     if k.arg is not None and k.arg not in accepted]
                    self.assertEqual(unknown, [], f"{name}:{line} attach() passes unknown keywords {unknown}")

    def test_ziniao_none_carries_a_reason(self):
        # the driver raises ValueError at runtime for ziniao=None without a reason
        for skill in SKILLS:
            for name, line, call in attach_calls(skill):
                kw = {k.arg: k.value for k in call.keywords}
                z = kw.get("ziniao")
                if isinstance(z, ast.Constant) and z.value is None:
                    r = kw.get("reason")
                    with self.subTest(skill=skill, call=f"{name}:{line}"):
                        self.assertTrue(
                            isinstance(r, ast.Constant) and isinstance(r.value, str) and r.value.strip(),
                            f"{name}:{line} attach(ziniao=None) needs a non-empty literal reason")


if __name__ == "__main__":
    unittest.main()
