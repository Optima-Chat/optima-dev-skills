"""Every attach() call in this skill must bind against the vendored driver's signature.

chat_driver.py is vendored verbatim from optima-store-skills, which turned
`ziniao` into a required keyword-only argument of ChatDriver.attach() (#611).
Re-syncing the driver without updating the callers breaks run_e2e.py with a
TypeError at the very first step, and test_imports.py only checks that the
class exists (and only when playwright is installed), so it cannot catch that.

This test rebuilds attach()'s parameter list from the driver's AST as an empty
stub and binds every call site against it with inspect.Signature.bind, so a
missing required argument, an unknown keyword, or a wrong positional all fail.
It needs no playwright and no browser, and checks the .claude copy and its
.codex mirror, since scripts/install.js ships both.
"""
import ast
import copy
import inspect
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SKILLS = [os.path.join(ROOT, d, "skills", "yzsgo-e2e") for d in (".claude", ".codex")]


def _parse(skill, name):
    with open(os.path.join(skill, name), encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=name)


def attach_signature(skill):
    """inspect.Signature of ChatDriver.attach, built from the driver's AST."""
    for node in ast.walk(_parse(skill, "chat_driver.py")):
        if isinstance(node, ast.ClassDef) and node.name == "ChatDriver":
            for fn in node.body:
                if isinstance(fn, ast.FunctionDef) and fn.name == "attach":
                    args = copy.deepcopy(fn.args)
                    # Only whether a default exists matters for binding, not its value,
                    # so replace defaults and drop annotations: the stub then compiles
                    # without any of the driver's module-level names.
                    args.defaults = [ast.Constant(None) for _ in args.defaults]
                    args.kw_defaults = [None if d is None else ast.Constant(None) for d in args.kw_defaults]
                    for a in args.posonlyargs + args.args + args.kwonlyargs + [args.vararg, args.kwarg]:
                        if a is not None:
                            a.annotation = None
                    stub = ast.FunctionDef(name="attach", args=args, body=[ast.Pass()],
                                           decorator_list=[], returns=None, type_params=[])
                    mod = ast.fix_missing_locations(ast.Module(body=[stub], type_ignores=[]))
                    ns = {}
                    exec(compile(mod, "<attach stub>", "exec"), ns)
                    return inspect.signature(ns["attach"])
    raise AssertionError("ChatDriver.attach not found in chat_driver.py")


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

    def test_every_call_binds_to_driver_signature(self):
        for skill in SKILLS:
            sig = attach_signature(skill)
            for name, line, call in attach_calls(skill):
                with self.subTest(skill=skill, call=f"{name}:{line}"):
                    dynamic = [a for a in call.args if isinstance(a, ast.Starred)] + \
                              [k for k in call.keywords if k.arg is None]
                    self.assertEqual(dynamic, [], f"{name}:{line} attach() uses *args/**kwargs; "
                                                  "write the arguments out so this test can check them")
                    try:
                        sig.bind(None, *[None] * len(call.args), **{k.arg: None for k in call.keywords})
                    except TypeError as e:
                        self.fail(f"{name}:{line} attach() does not match the driver signature: {e}")

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
