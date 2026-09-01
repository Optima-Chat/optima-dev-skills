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

if __name__ == "__main__":
    unittest.main()
