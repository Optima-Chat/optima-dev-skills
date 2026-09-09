"""末 response 渲染回归（从上游 optima-store-skills #102 移植，见 SYNC.md）。

背景：末 request 无 response 记录（生成中断/未落盘/末轮是 continuation）时，
transcript 会静默停在末条 user 消息——常是超长 tool_result 的截断处——审查者会误读成
「响应被截断吞了后续」。真根因不是截断，是根本没有末 response。所以缺失必须**显式标注**。

vendored 的 pull_wire.py 曾漏掉这个上游修复（2026-09-09 同步时补上），本文件防它再漏。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
import pull_wire as pw  # noqa: E402

_deref = lambda v: v  # noqa: E731

_REQ1 = {"kind": "request", "callId": "c1", "seq": 1, "ts": "2026-09-09T05:00:00Z",
         "body": {"messages": [{"role": "user", "content": [{"type": "text", "text": "算 ROI"}]}]}}
_REQ2 = {"kind": "request", "callId": "c2", "seq": 3, "ts": "2026-09-09T05:00:30Z",
         "body": {"messages": [
             {"role": "user", "content": [{"type": "text", "text": "算 ROI"}]},
             {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "bash", "input": {"cmd": "x"}}]},
             {"role": "user", "content": [{"type": "tool_result", "is_error": False, "tool_use_id": "t1",
                                           "content": "X" * 29582}]},
         ]}}


class TestLastResponse(unittest.TestCase):
    def test_missing_last_response_is_flagged_not_silent(self):
        """末 req 无 response → transcript 不能静默停在截断的 tool_result 上。"""
        resps = {"c1": {"kind": "response", "callId": "c1",
                        "finalMessage": {"stopReason": "max_tokens", "content": []}}}
        *_, resp_ok, md = pw.render_conversation([_REQ1, _REQ2], resps, _deref, 1)
        self.assertFalse(resp_ok)
        self.assertFalse(md.rstrip().endswith("字]"), "不能停在截断标记上（#102 症状）")
        self.assertIn("transcript 结束", md)
        self.assertIn("无 response 记录", md)
        self.assertIn("末 response:", md)

    def test_normal_last_response_renders_final_reply(self):
        resps = {"c1": {"kind": "response", "callId": "c1",
                        "finalMessage": {"stopReason": "tool_use",
                                         "content": [{"type": "tool_use", "id": "t1", "name": "bash", "input": {}}]}},
                 "c2": {"kind": "response", "callId": "c2",
                        "finalMessage": {"stopReason": "end_turn",
                                         "content": [{"type": "text", "text": "保本 ROI 是 2.4"}]}}}
        *_, resp_ok, md = pw.render_conversation([_REQ1, _REQ2], resps, _deref, 1)
        self.assertTrue(resp_ok)
        self.assertIn("保本 ROI 是 2.4", md)
        self.assertIn("末 response: 有（正常 response）", md)

    def test_error_last_response_flagged(self):
        resps = {"c2": {"kind": "error", "callId": "c2", "error": {"message": "boom"}}}
        *_, resp_ok, md = pw.render_conversation([_REQ1, _REQ2], resps, _deref, 1)
        self.assertFalse(resp_ok)
        self.assertIn("末 response 是 error", md)

    def test_bad_block_does_not_abort_message_loop(self):
        """单个块渲染抛异常不该吞掉同消息后续块（坏块 = input 不可 JSON 序列化，渲染时才炸）。"""
        bad = {"type": "tool_use", "name": "bash", "id": "t9", "input": {"x": {1, 2, 3}}}
        req = {"kind": "request", "callId": "c1", "seq": 1, "ts": "t",
               "body": {"messages": [{"role": "assistant",
                                      "content": [bad, {"type": "text", "text": "活着"}]}]}}
        *_, md = pw.render_conversation([req], {"c1": {"kind": "response", "finalMessage": {"content": []}}},
                                        _deref, 1)
        self.assertIn("渲染失败", md)
        self.assertIn("活着", md)

    def test_render_conversation_returns_six_values(self):
        """arity 锁死：run_e2e 按 6 元解包（`_,_,_,_,resp_ok,md`）。少一个就 ValueError 崩在
        report 前一步——正是那种「跑完一整轮才炸」的贵错。"""
        resps = {"c2": {"kind": "response", "callId": "c2",
                        "finalMessage": {"stopReason": "end_turn", "content": []}}}
        out = pw.render_conversation([_REQ1, _REQ2], resps, _deref, 1)
        self.assertEqual(len(out), 6, out)


if __name__ == "__main__":
    unittest.main()
