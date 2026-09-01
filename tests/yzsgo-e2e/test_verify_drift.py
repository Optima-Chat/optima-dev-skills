import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from verify_drift import plan_drift_checks

class TestDrift(unittest.TestCase):
    def test_absent_repo_skipped(self):
        checks = plan_drift_checks({"store-skills": False, "gateway": False})
        self.assertTrue(all(not c["checkable"] for c in checks))

    def test_present_repo_checkable(self):
        checks = plan_drift_checks({"store-skills": True, "gateway": True})
        files = {c["file"] for c in checks if c["checkable"]}
        self.assertIn("chat_driver.py", files)   # 来自 store-skills
        self.assertIn("judge_workflow.js", files) # 来自 gateway

    def test_mixed_presence_maps_per_repo(self):
        checks = plan_drift_checks({"store-skills": True, "gateway": False})
        by_file = {c["file"]: c["checkable"] for c in checks}
        self.assertTrue(by_file["chat_driver.py"])       # store-skills present
        self.assertTrue(by_file["pull_wire.py"])          # store-skills present
        self.assertFalse(by_file["prep_conversation.py"]) # gateway absent
        self.assertFalse(by_file["judge_workflow.js"])    # gateway absent

    def test_adapted_flags(self):
        # 只有 chat_driver 是逐字 vendored；pull_wire 追加了函数、prep/judge 改编 → adapted，永久 ⚠️ 属预期
        by = {c["file"]: c.get("adapted") for c in plan_drift_checks({"store-skills": True, "gateway": True})}
        self.assertFalse(by["chat_driver.py"])
        self.assertTrue(by["pull_wire.py"])
        self.assertTrue(by["prep_conversation.py"])
        self.assertTrue(by["judge_workflow.js"])

if __name__ == "__main__":
    unittest.main()
