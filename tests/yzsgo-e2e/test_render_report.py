import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from run_e2e import render_report, select_conversation_in_session, _parse_answers, _read_user_from_token

class TestReport(unittest.TestCase):
    def test_read_user_from_token(self):
        import json, tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"user": {"userId": "u-123"}}, f)
            p = f.name
        try:
            self.assertEqual(_read_user_from_token(p), "u-123")
        finally:
            os.unlink(p)
        self.assertIsNone(_read_user_from_token("/no/such/token.json"))  # 读不到回 None，由 main 报错

    def test_parse_answers_drops_malformed_with_warning(self):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            got = _parse_answers(["k=v", "bad", "x=y=z"])
        self.assertEqual(got, [{"match": "k", "answer": "v"}, {"match": "x", "answer": "y=z"}])
        self.assertIn("bad", buf.getvalue())  # 缺 = 的项被丢弃且有告警

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

    def test_select_by_ts_prompt_not_position(self):
        deref = lambda v: v
        def mk(ts, text):
            return [{"ts": ts, "callId": "c", "seq": 1,
                     "body": {"messages": [{"role": "user", "content": text}]}}]
        # 正确对话在 index 0；hit.gidx=2 若按位置会选 convs[1]（错）。正确应按 ts+prompt 命中 index 0。
        convs = [mk("2026-08-31T14:03:10Z", "我想做电商帮我看看"),
                 mk("2026-08-31T15:00:00Z", "另一个对话")]
        hit = {"gidx": 2, "sid": "s", "ts": "2026-08-31T14:03:10Z", "prompt": "我想做电商帮我看看"}
        got = select_conversation_in_session(convs, deref, hit)
        self.assertEqual(got[0]["ts"], "2026-08-31T14:03:10Z")
        self.assertEqual(got[0]["body"]["messages"][0]["content"], "我想做电商帮我看看")

if __name__ == "__main__":
    unittest.main()
