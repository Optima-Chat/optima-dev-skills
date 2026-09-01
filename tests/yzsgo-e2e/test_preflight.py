import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from preflight import summarize_preflight

class TestPreflight(unittest.TestCase):
    def test_all_ok(self):
        r = summarize_preflight([{"name": "chrome-9222", "ok": True, "hint": "x"}])
        self.assertTrue(r["ok"]); self.assertEqual(r["missing"], [])
        self.assertIn("✅ chrome-9222", r["report"])

    def test_missing_lists_and_hints(self):
        r = summarize_preflight([
            {"name": "chrome-9222", "ok": True, "hint": "x"},
            {"name": "buildbox-pw", "ok": False, "hint": "创建 ~/.buildbox_pw"},
        ])
        self.assertFalse(r["ok"]); self.assertEqual(r["missing"], ["buildbox-pw"])
        self.assertIn("❌ buildbox-pw", r["report"]); self.assertIn("创建 ~/.buildbox_pw", r["report"])

if __name__ == "__main__":
    unittest.main()
