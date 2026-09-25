"""Every yzsgo-e2e module must import on Python 3.9 (dev-skills#114).

macOS ships /usr/bin/python3 as 3.9, and SKILL.md's first step runs
`python3 $S/preflight.py`. Python 3.9 evaluates annotations when it executes a
`def`, so a PEP 604 union such as `-> str | None` raises TypeError at import time
unless the module has `from __future__ import annotations`. CI runs a newer
python3, where the same code imports fine, so importing the module in CI proves
nothing; this test reads the source with ast instead. Both the .claude copy and
its .codex mirror are checked, since scripts/install.js ships both.
"""
import ast
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SKILLS = [os.path.join(ROOT, d, "skills", "yzsgo-e2e") for d in (".claude", ".codex")]


def _has_future_annotations(tree):
    return any(isinstance(n, ast.ImportFrom) and n.module == "__future__"
               and any(a.name == "annotations" for a in n.names) for n in tree.body)


def _annotations(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = node.args
            for arg in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg]:
                if arg is not None and arg.annotation is not None:
                    yield node.lineno, arg.annotation
            if node.returns is not None:
                yield node.lineno, node.returns
        elif isinstance(node, ast.AnnAssign):
            yield node.lineno, node.annotation


def pep604_unions(tree):
    """Line numbers of annotations that contain an `X | Y` union."""
    return sorted({line for line, ann in _annotations(tree)
                   for n in ast.walk(ann) if isinstance(n, ast.BinOp) and isinstance(n.op, ast.BitOr)})


class TestPy39Annotations(unittest.TestCase):
    def test_pep604_unions_need_future_import(self):
        for skill in SKILLS:
            for name in sorted(os.listdir(skill)):
                if not name.endswith(".py"):
                    continue
                with open(os.path.join(skill, name), encoding="utf-8") as fh:
                    tree = ast.parse(fh.read(), filename=name)
                lines = pep604_unions(tree)
                if lines:
                    self.assertTrue(_has_future_annotations(tree),
                                    f"{skill}/{name}: `X | Y` annotations at lines {lines} break import on "
                                    "Python 3.9 without `from __future__ import annotations`")


if __name__ == "__main__":
    unittest.main()
