import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))
from pull_wire import locate_conversation

IDX = [
    {"gidx": 1, "sid": "s1", "ts": "2026-08-31T10:00:00Z", "prompt": "我想做电商帮我看看"},
    {"gidx": 2, "sid": "s1", "ts": "2026-08-31T14:03:10Z", "prompt": "我想做电商帮我看看行情"},
    {"gidx": 3, "sid": "s1", "ts": "2026-08-31T14:05:00Z", "prompt": "换个话题聊聊物流"},
]

class TestLocate(unittest.TestCase):
    def test_picks_first_after_started_among_matches(self):
        r = locate_conversation(IDX, "2026-08-31T14:00:00Z", "我想做电商帮我看看")
        self.assertEqual(r["gidx"], 2)  # gidx1 在 started 之前，被排除

    def test_no_match_returns_none(self):
        self.assertIsNone(locate_conversation(IDX, "2026-08-31T14:00:00Z", "完全不相干的话"))

    def test_fallback_latest_when_none_after_started(self):
        r = locate_conversation(IDX, "2026-08-31T23:00:00Z", "我想做电商帮我看看")
        self.assertEqual(r["gidx"], 2)  # 无 ts>=started 的候选 → 候选里 ts 最大

    def test_empty_prompt_item_not_matched(self):
        idx = [{"gidx": 1, "sid": "s1", "ts": "2026-08-31T14:04:00Z", "prompt": ""}]
        self.assertIsNone(locate_conversation(idx, "2026-08-31T14:00:00Z", "我想做电商帮我看看"))

    def test_mixed_iso_format_and_subsecond(self):
        # started_ts 是 datetime.isoformat 风格(+00:00, 微秒)，wire 是 Z；归一后按数值序比较，不靠字典序
        idx = [
            {"gidx": 1, "sid": "s", "ts": "2026-09-01T02:19:47.900Z", "prompt": "你好"},
            {"gidx": 2, "sid": "s", "ts": "2026-09-01T02:19:48.100Z", "prompt": "你好"},
        ]
        r = locate_conversation(idx, "2026-09-01T02:19:48.000000+00:00", "你好")
        self.assertEqual(r["gidx"], 2)  # 47.9 在 started(48.0) 之前排除，命中 48.1

class TestLocateBySession(unittest.TestCase):
    """并发跑测（2026-09-09 起）：驱动侧知道自己跑在哪个 gateway session 上，
    按 sid 定位是**确定性**的；启发式在「同 prompt 重跑 / 并发会话时间戳交叠」时会挑错。"""

    # 同一句 prompt 在两个 session 里各跑了一次，时间戳交叠 —— 这正是并行跑的常态
    IDX2 = [
        {"gidx": 1, "sid": "sA", "ts": "2026-09-09T11:59:52Z", "prompt": "算一下保本 ROI"},
        {"gidx": 2, "sid": "sB", "ts": "2026-09-09T11:59:54Z", "prompt": "算一下保本 ROI"},
    ]

    def test_session_id_pins_the_right_one_when_timestamps_interleave(self):
        """不传 sid 只能按时间挑到 sA；传了 sB 就必须是 sB —— 这是并行归因的全部意义。"""
        heuristic = locate_conversation(self.IDX2, "2026-09-09T11:59:00Z", "算一下保本 ROI")
        self.assertEqual(heuristic["sid"], "sA")
        pinned = locate_conversation(self.IDX2, "2026-09-09T11:59:00Z", "算一下保本 ROI",
                                     session_id="sB")
        self.assertEqual(pinned["sid"], "sB")

    def test_unknown_session_returns_none_instead_of_silently_falling_back(self):
        """传了 sid 但索引里没有该 session（wire 未落盘/TTL 过期/拉错账号）→ 必须 None。
        回退到全局启发式会安静地定位到**别的 session** 的对话，比返回 None 危险得多。"""
        self.assertIsNone(locate_conversation(self.IDX2, "2026-09-09T11:59:00Z",
                                              "算一下保本 ROI", session_id="sZZZ"))

    def test_session_id_none_keeps_old_behaviour(self):
        """串行/降级路径（拿不到 sid）行为不变，老用例不受影响。"""
        r = locate_conversation(IDX, "2026-08-31T14:00:00Z", "我想做电商帮我看看", session_id=None)
        self.assertEqual(r["gidx"], 2)

    def test_prompt_still_has_to_match_within_the_session(self):
        """sid 只是缩小候选，不是无条件放行：同 session 里不相干的对话仍不该命中。"""
        self.assertIsNone(locate_conversation(self.IDX2, "2026-09-09T11:59:00Z",
                                              "完全不相干的话", session_id="sB"))


if __name__ == "__main__":
    unittest.main()
