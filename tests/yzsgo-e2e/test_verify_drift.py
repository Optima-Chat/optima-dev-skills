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

if __name__ == "__main__":
    unittest.main()
