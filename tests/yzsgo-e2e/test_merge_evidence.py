import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from prep_conversation import merge_browser_evidence

class TestMerge(unittest.TestCase):
    def test_appends_browser_section_with_turns(self):
        wire = "# 对话 #2\n## 事实卡\n- LLM 轮数 3\n"
        turns = [
            {"sent": "你好", "state": "done", "transcript": "你好！我是鸭嘴兽…", "tool_trace": [], "timed_out": False},
            {"sent": "看看行情", "state": "service_error", "transcript": "", "tool_trace": [], "timed_out": False},
        ]
        out = merge_browser_evidence(wire, turns)
        self.assertIn("# 对话 #2", out)                    # 保留 wire 原文
        self.assertIn("## 前端所见", out)                   # 追加浏览器节
        self.assertIn("你好！我是鸭嘴兽", out)              # 前端渲染内容进证据
        self.assertIn("service_error", out)                 # 前端异常态可见
        self.assertIn("对照", out)                          # 有前后端对照提示

if __name__ == "__main__":
    unittest.main()
