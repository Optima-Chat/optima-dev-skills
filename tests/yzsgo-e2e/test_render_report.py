import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from run_e2e import render_report

class TestReport(unittest.TestCase):
    def test_confirmed_and_needs_review_rows(self):
        md = render_report({
            "env": "cn-prod", "started_ts": "2026-08-31T14:00:00Z", "first_message": "你好",
            "confirmed": [{"what": "前端丢了工具卡", "evidence": "wire 有 tool_result，前端未渲染"}],
            "needs_review": [{"what": "疑似截断", "evidence": "max_tokens=1"}],
            "blocked": None, "coverage": "单次对话；skeptic 读源码",
        })
        self.assertIn("前端丢了工具卡", md)
        self.assertIn("confirmed", md); self.assertIn("needs_review", md)
        self.assertIn("## 覆盖边界", md); self.assertIn("## 判断修正", md)
        self.assertNotIn("blocked:", md)

    def test_blocked_banner(self):
        md = render_report({"env": "cn-prod", "started_ts": "t", "first_message": "x",
                            "confirmed": [], "needs_review": [], "blocked": "积分不足", "coverage": "-"})
        self.assertIn("blocked: 积分不足", md)

if __name__ == "__main__":
    unittest.main()
