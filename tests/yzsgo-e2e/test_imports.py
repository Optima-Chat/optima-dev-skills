import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".claude", "skills", "yzsgo-e2e"))

# Check if playwright is available
try:
    import playwright  # noqa
    _HAS_PW = True
except Exception:
    _HAS_PW = False


class TestImports(unittest.TestCase):
    def test_pull_wire_symbols(self):
        """Test that pull_wire module exports required symbols."""
        import pull_wire
        for fn in ("segment", "render_conversation", "first_user_text", "make_deref"):
            self.assertTrue(hasattr(pull_wire, fn), fn)

    @unittest.skipUnless(_HAS_PW, "playwright 未装")
    def test_chat_driver_class(self):
        """Test that chat_driver module exports ChatDriver class."""
        import chat_driver  # 需环境已装 playwright
        self.assertTrue(hasattr(chat_driver, "ChatDriver"))


if __name__ == "__main__":
    unittest.main()
