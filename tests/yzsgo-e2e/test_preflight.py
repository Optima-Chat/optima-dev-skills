import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from preflight import summarize_preflight

class TestPreflight(unittest.TestCase):
    def test_all_ok(self):
        r = summarize_preflight([{"name": "x", "ok": True, "category": "auto", "fix": "f"}])
        self.assertTrue(r["ok"])
        self.assertEqual(r["missing"], [])
        self.assertIn("✅ x", r["report"])

    def test_missing_carries_category_and_fix(self):
        r = summarize_preflight([
            {"name": "venv+playwright", "ok": False, "category": "auto", "fix": "python3 bootstrap.py setup"},
            {"name": "buildbox-pw", "ok": False, "category": "manual", "fix": "放 ~/.buildbox_pw"},
        ])
        self.assertFalse(r["ok"])
        self.assertEqual({m["name"] for m in r["missing"]}, {"venv+playwright", "buildbox-pw"})
        cats = {m["name"]: m["category"] for m in r["missing"]}
        self.assertEqual(cats["venv+playwright"], "auto")   # 可自动装
        self.assertEqual(cats["buildbox-pw"], "manual")     # 只能引导
        self.assertIn("bootstrap.py setup", r["report"])    # 修法进报告

if __name__ == "__main__":
    unittest.main()
