import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
import bootstrap

class TestBootstrap(unittest.TestCase):
    def test_venv_python_path(self):
        self.assertTrue(bootstrap.venv_python("/x").endswith(os.path.join("/x", "bin", "python")))

    def test_plan_actions_for_playwright(self):
        plan = bootstrap.plan_actions(["venv+playwright"], base="/tmp/v")
        self.assertEqual([n for n, _ in plan], ["setup"])
        flat = " ".join(" ".join(c) for _, cmds in plan for c in cmds)
        self.assertIn("venv /tmp/v", flat)                 # 建在指定 venv 路径
        self.assertIn("pip install", flat)
        self.assertIn("playwright install chromium", flat)

    def test_plan_actions_maps_each_auto_item(self):
        plan = bootstrap.plan_actions(["sshpass", "chrome-9222"])
        self.assertEqual([n for n, _ in plan], ["install-sshpass", "launch-chrome"])

    def test_plan_actions_ignores_manual_items(self):
        # manual 类（buildbox-pw / test-user-id）装不了，plan 里不该出现
        self.assertEqual(bootstrap.plan_actions(["buildbox-pw", "test-user-id"]), [])

if __name__ == "__main__":
    unittest.main()
