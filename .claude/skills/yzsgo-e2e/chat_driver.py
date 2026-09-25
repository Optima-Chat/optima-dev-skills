#!/usr/bin/env python3
"""yzsgo Agentic Chat 网页操作固化库 —— 所有对 app.yzsgo.com/zh-HK/chat 的动作的**唯一入口**。

任何人任何时候操作这个网页都走这里，不再现写 Playwright。封装了 pilot(2026-08-27)实测的三个坑：
  ① 侧栏图标文字是 hover tooltip、被 svg 遮挡 → 用 DOM `.click()`（不用坐标/Playwright click）；
  ② 搜索框/输入是 React 受控输入 → 用原生 value setter + dispatchEvent('input')；
  ③ 流式回复 → 轮询 body 文本尾部稳定判完成。

前置：用户已用带远程调试端口的 Chrome 登录好 Agentic Chat：
  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/yzsgo-chrome https://app.yzsgo.com
  （⚠️ 登录态存在 localStorage、按 origin 隔离：以前在 www.yzsgo.com 上登过的 /tmp/yzsgo-chrome，
   要在 app.yzsgo.com 上**重新登录一次**，见下面 `CHAT_URL` 那条注释。）

用法：
  from chat_driver import ChatDriver
  d = ChatDriver().attach(ziniao="27884995544032")        # **声明**这一轮驱动哪个 profile（#611；锁已撤，见下）
  d = ChatDriver().attach(ziniao=None, reason="不碰任何店")  # 显式声明；**理由必填**
  d = ChatDriver().attach(own_tab=True, ziniao=None, reason="profile 在逐条用例那层声明")  # 并行：自己开 tab
  d.ensure_installed(["briefing-store-status"])
  d.new_conversation()
  r = d.send_and_wait("跑一下老赵店的运营简报", timeout=300)
  print(r["text"], r["elapsed"], r["tool_trace"])
  d.close()

🔴 并发形态（2026-09-09 真机坐实，别再按「同一时间只能一个对话」写代码）：
  鸭嘴兽已支持并发任务 —— **一个浏览器 tab = 一个独立 gateway session**（agentic-chat ac#957，
  sessionId 存 sessionStorage `optima:gw:sid`，天然 per-tab；F5 靠 sessionAttachProvider attach 回同一个）。
  · 跨 tab  = 可并行：实测两 tab 的 LLM 调用在服务端 wire 上真重叠约 3.0s。
  · 同 tab 内 = 仍串行：一个 session 里另一个对话在跑会被 CONCURRENT_CONVERSATION_BLOCKED 拒。
  · 并发上限按 plan 分档（free 1 / starter 2 / pro 4 / enterprise 20），超了 CONCURRENCY_LIMIT_EXCEEDED。
  ⇒ 想并行跑 N 个用例，就开 N 个 tab、每 tab 一个 ChatDriver，**不是**在一个 tab 里开 N 个对话。

⚠️ 两个 driver 落到**同一个 tab** 会静默串台（2026-09-09 负向对照实证）：两个线程往同一个
  textarea 写字，后写的覆盖先写的，**只有一条消息真到服务端**（wire 里那个 session 只有 1 个对话），
  但两边 send() 都返回 True、无 toast、无 console 报错，双方都抓到同一份回复 ——
  A 用例被判在 B 的回复上，harness 任何信号都拦不住。所以并行时必须 `attach(own_tab=True)`。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

# cn-stage 前端是 app.stage.optima.chat（同一套页面），用 YZSGO_CHAT_URL 覆盖；缺省 cn-prod。
# 🔴 缺省 host 必须是 cn-prod 的**规范域名 app.yzsgo.com**（#2223）：2026-09-24 起 www / 裸域
#    一律 301 到 app（optima-terraform#467/#468，path + query 保留）。
#    · `login_state()` 按 **hostname 相等**比 ⇒ 缺省写 www 时落地是 app，永远判 `unknown`，
#      `attach()` 每次都抛 `NeedsHumanLogin`；
#    · 登录态存在 localStorage、按 origin 隔离 ⇒ 在 www 上登过的 profile 到 app 上**是未登录**，要重登一次。
#    `/zh-HK` 前缀保留（⛔ 别照 #2223 正文的字面建议写成裸 `/chat`）：技能市场按繁体文案认控件（`SEARCH_PH` 等），
#    落到 `/en/` 时 `ensure_installed` 假报 `notfound`（2026-09-20 实撞，`e2e/registry-2030-2035-cn-prod-baseline.yaml:29-30`）。
CHAT_URL = os.environ.get("YZSGO_CHAT_URL", "https://app.yzsgo.com/zh-HK/chat")
SEARCH_PH = "搜尋技能..."
# 本 tab 认领的 gateway sessionId 存这里（agentic-chat src/lib/session/tabSessionClaim.ts）。
# sessionStorage 天然 per-tab —— 这是「一 tab 一 session」的物理依据，也是并行隔离的校验口。
TAB_SID_KEY = "optima:gw:sid"

# ── 「这一轮加载了哪些 skill」的**文本形态**判读（#2091）──────────────────────
# 🔴 平台面板在 2026-09-18 晚～09-19 之间改版：`load_skill` 原来渲染成**聚合面板里的一行工具**
#    （`load_skill` + `已完成` + `參數`/`結果` 两个按钮，slug 藏在參數的 `<pre>` JSON 里），
#    改版后变成**两行纯文本**：`使用技能：<slug>` + `已完成`，**没有參數面板**，
#    而且排在聚合头「已完成 N 個工具」**之前**（即在那个面板之外）。
#    于是 `loaded_skills()`（认死 `<pre>` 里的 `{"name":"<slug>"}`）和
#    `_scrape_tool_trace()`（认死「有兩個按鈕 + 參數 + 結果」的行）**同时读空**，
#    而且读空的样子跟「Agent 真的没加载」一模一样 —— 一次真成功被判成 `uncertain`。
#
# ⚠️ **这里只认形状，不放松 slug 判别**：`使用技能：` 必须**独占一行**、后面必须是
#    slug 形状（小写字母数字 + 连字符）。2026-09-09 收紧 `<pre>` 判别是为了挡「商品名被
#    当成 skill」的假通过（2026-09-09 实测把 `meta.json` 的商品标题记成了 skill），**这里同样别放宽**。
#
# 🔴 **两个形态都要认**：改版不是替换 —— 历史日志还要能重判，而下一次改版会以完全一样的
#    方式再瞎一次。所以真正要紧的不是这两条正则，而是 `nodes`：
#    **「一个加载节点都没找到」必须能跟「找到了、期望那个不在里面」分开报。**
# 🔴 **判据钉在面板节点的「形状」上，不是钉在文本里出现过这个词**（#2091 复核时纠的一刀）。
#    实证：同一份 09-19 日志里，`load_skill` 这个字符串出现 2 次 —— **两次都在 Agent 自己写的
#    总结表里**（`:359 load_skill strategizing-store-ops（档案读写规矩的归属者）<TAB>它明示了…`），
#    它在**谈论** load_skill，不是一次加载事件。真事件在 `:76/:78` 的「使用技能：<slug>」。
#    ⇒ 只认**整组**渲染形状：
#      新形态（09-19 起）  `使用技能：<slug>` + 状态行              两行一组，**无參數面板**
#      旧形态（09-18 及前）`load_skill` + 状态行 + `參數` + `結果`  四行一组，在聚合面板内
#    认单行 = 打中散文 = 把「我没读到」谎报成「抓取是通的」，这正是这条 issue 的形状本身。
_STATUS_LINE = r"(?:已完成|完成|失敗|失败|進行中|进行中|錯誤|错误)"
_SKILL_USE_LINE_RE = re.compile(
    r"^[ \t]*使用技能[：:][ \t]*([a-z0-9][a-z0-9-]*)[ \t]*\r?\n[ \t]*" + _STATUS_LINE + r"[ \t]*$",
    re.M)
_LOAD_SKILL_ROW_RE = re.compile(
    r"^[ \t]*load_skill[ \t]*\r?\n[ \t]*" + _STATUS_LINE + r"[ \t]*\r?\n"
    r"[ \t]*(?:參數|参数)[ \t]*\r?\n[ \t]*(?:結果|结果)[ \t]*$",
    re.M)


def parse_skill_loads(text: str) -> dict:
    """从页面 / 面板的 `innerText` 里读「这一轮有没有加载 skill 的节点、加载的是谁」。

    返回 `{"slugs": [...], "nodes": int, "shapes": [...]}`：

    - `slugs`  —— **只有新形态（`使用技能：<slug>`）给得出 slug**。旧形态的 slug 在參數
                  `<pre>` 里，不在文本里 ⇒ 旧形态这里恒为 `[]`，slug 仍由 `loaded_skills()`
                  的 `<pre>` 那条路给。
    - `nodes`  —— **两种形态加起来，页面上一共有几个「加载 skill」的节点。**
                  🔴 这一格才是这次修的重点：`nodes == 0` 才是「我们没读到」，
                  `nodes > 0` 而期望的 slug 不在 `slugs` 里，才是「真的没加载它」。
    - `shapes` —— 读到的是哪一种渲染（`labelled` 新 / `row` 旧），出问题时给人看。

    **纯函数、不碰浏览器** —— 这样历史日志（`e2e/logs/*.txt` 里落盘的整页文本）可以当夹具重判。
    """
    text = text or ""
    slugs, seen = [], set()
    for m in _SKILL_USE_LINE_RE.finditer(text):
        slug = m.group(1)
        if slug not in seen:
            seen.add(slug)
            slugs.append(slug)
    n_labelled = len(_SKILL_USE_LINE_RE.findall(text))
    n_rows = len(_LOAD_SKILL_ROW_RE.findall(text))
    shapes = (['labelled'] if n_labelled else []) + (['row'] if n_rows else [])
    return {"slugs": slugs, "nodes": n_labelled + n_rows, "shapes": shapes}


def build_must_call(expected, pre_slugs, marks) -> dict:
    """由**两条信号源**合成 `must_call` 那一维的读数。**纯函数**（#2091）。

    - `pre_slugs`   —— 旧形态：參數面板 `<pre>` 里那个 `{"name": "<slug>"}`（DOM 才读得到）
    - `marks`       —— `parse_skill_loads()` 的结果：新形态的 slug + **两种形态的节点计数**

    ⚠️ **`load_nodes` 只由 `parse_skill_loads` 的整组形状给**，不吃 `loaded_skills` 里那个
    `n_calls`（「文本恰好等于 `load_skill` 的 span/div」）—— 后者同样会打中 Agent 散文里的
    行内代码，而一旦打中，`load_nodes` 就从 0 变成正数，
    **把「我没读到」谎报成「抓取是通的、是它没调」** —— 正好是这条 issue 要分开的那两件事。
    那个 `n_calls` 留在原处，**只用来判要不要去 toggle 參數面板**。

    返回的 `load_nodes` 是这次修的全部重点：
      · `> 0` ⇒ **抓取是通的**。期望的 slug 不在 `loaded` 里 ⇒ 它**真的没调** ⇒ `not_detected`
      · `== 0` ⇒ **我们一个加载节点都没读到** ⇒ `unknown`（没读到），**不许报成「没调」**

    抽成纯函数是为了让**历史日志能重判**：判据不许只活在浏览器里，
    否则下一次面板改版时，我们连「改版前后这一维读出来一不一样」都没法离线量。
    """
    merged = list(pre_slugs or [])
    for slug in (marks or {}).get("slugs") or []:
        if slug not in merged:
            merged.append(slug)
    exp = expected if isinstance(expected, list) else [expected]
    return {
        "expected": expected,
        "loaded": merged,
        "ok": any(e in merged for e in exp),
        "load_nodes": int((marks or {}).get("nodes") or 0),
        "load_shapes": list((marks or {}).get("shapes") or []),
    }


class TabSessionUnavailable(RuntimeError):
    """新开的 tab 没能拿到**独立**的 gateway session —— 并行不安全，调用方必须退回串行。

    两种触发（都实证过）：
      ① claim 超时：页面没在 timeout 内写 sessionStorage（没登录 / 连不上 gateway）；
      ② sid 与已有 tab 撞车：该环境 `NEXT_PUBLIC_MULTI_TAB_SESSION` 没开（build-time flag，
         默认关，见 agentic-chat src/lib/feature-flags.ts），新 tab 会被 gateway 的
         createOrResolveSession 并回同一个 session。cn-prod 已开、cn-stage 未验。
    绝不能降级成「那就共用一个 tab 吧」——那正是静默串台的成因。"""


class NeedsHumanLogin(RuntimeError):
    """这个源上没有登录态（或判不出）—— **要人来登录**，本轮停手。

    🔴 **⛔ 不得继承 `TabSessionUnavailable`**。那个的语义是「并行不安全，退回串行」，
       跟「要人登录」完全不是一回事；而且 `run.py` 里 `except TabSessionUnavailable`
       排在前面 ⇒ 一旦继承，**新分支永不执行、`todo` 一个字印不出来**，
       而判据（只断言「抛的是 NeedsHumanLogin」）**照样全绿**。

    🔴 **`login_state` 是必填位置参数** —— 「确实判不出」和「忘了说」不许共用取值。
    🔴 **`str(e)` 恰好是 `todo`**：仓里 16 处 `.attach(` 调用点只有 `run.py` 那 2 处会接这个
       异常，**其余全靠 `str(e)`**。四个参数都塞进 `args` 的话打印出来是个 tuple repr，
       那句精心写的人话就变成 tuple 里的第 4 个元素。
    🔴 **`driver` 必带**：两个生产调用点都是链式 `d = ChatDriver().attach(...)`，
       抛异常时 `d` **根本没被赋值** ⇒ 没有它，调用方既续不了跑、也收不了那个 tab。
    """

    def __init__(self, login_state, login_why, url, todo, driver):
        if login_state not in ("logged_out", "unknown"):
            raise ValueError(f"login_state 只能是 logged_out / unknown，收到 {login_state!r}")
        super().__init__(todo)
        self.login_state, self.login_why = login_state, login_why
        self.url, self.todo, self.driver = url, todo, driver


class TabGoneDuringClaim(RuntimeError):
    """认领等待期间**那个 tab 没了**（人手动关 / 别的 driver 的 `browser.close()` 波及）。

    🔴 **独立收场，⛔ 不并进 `logged_out` / `unknown`** —— 那个 tab 已经不存在了，
       说「去那个标签页登录」是错的。
    ⚠️ 为什么非要单独看一眼 `is_closed()`：真 Playwright 的 `Page.url` 是**本地缓存字符串**，
       页面关掉之后**不抛、照样返回最后那个值** ⇒ 一直判 `logged_in` ⇒ 连续计数永远清零
       ⇒ **整道闸静默失效**，而 `_read_sid` 的 `except Exception` 正好把 TargetClosedError 吞掉。
    🔴 同样 ⛔ 不继承 `TabSessionUnavailable`、同样必带 `driver`（否则没人能收拾这个 driver）。
    """

    def __init__(self, why, driver):
        super().__init__(why)
        self.why, self.driver = why, driver


# preflight 只问一件事、只认一种答案：让 agent 原样贴 `browser-cli ziniao doctor` 的输出。
# **别再让它用自然语言回答「连没连上」** —— 2026-09-12 两种翻车都出在解析自由文本上：
#   · 假阴性：服务端回复完整（11 个 profile 都在），driver 侧解析到 0 个 → 整轮 0s blocked；
#   · 假阳性：抓到 5 万字页面噪声，从里面正则捞出 4 个「27 开头的数字」就判连着，
#     而同一时刻 doctor 明写 `✗ 桌面应用: 鸭嘴兽助手桌面应用未连接`。
_PREFLIGHT_PROMPT = (
    "只跑这两条命令，别加载任何 skill、别开浏览器、别做任何店铺操作，把**原始输出原样贴出来**"
    "（不要解读、不要改写、不要转成表格）：\n"
    "1) `browser-cli ziniao doctor`\n"
    "2) `browser-cli ziniao profiles`")



def parse_preflight(text: str) -> dict:
    """从 preflight 回复里判桌面端连没连上。**纯函数，单测覆盖。**

    返回 {ok, stores, shop_count}，其中 `ok` 是**三态**：
      · True  —— 看到 `✓ 桌面应用`（权威肯定）
      · False —— 看到 `✗ 桌面应用`（权威否定）
      · None  —— 两个都没看到 = **没抓到**，不是「没连上」

    三态是关键：旧实现把「没抓到」和「没连上」压成同一个 False，于是一次抓取抖动就让整轮
    e2e 一个用例都不驱动（2026-09-12 实测：服务端回复里 11 个 profile 齐全，driver 判「桌面未连」）。
    现在只有**权威否定**才拦；抓不到交给调用方决定（run.py 选择照跑并打警告）。

    店铺清单只从 `ziniao profiles` 的行首格式取（`<id>  <名字>`），**不再全文捞 27 开头的数字**
    ——页面噪声里遍地是这种数字，那正是假阳性的来源。
    """
    t = text or ""
    ok = True if "✓ 桌面应用" in t else (False if "✗ 桌面应用" in t else None)
    # `  27884995544032  跨境-马来西亚-鸭嘴兽  [TikTok Shop-...]`：id 后至少两个空白再跟店名
    stores = re.findall(r"(\d{14,15})\s{2,}([^\s\[][^\[\n]{1,38})", t)
    m = re.search(r"店铺列表[:：]\s*(\d+)\s*个", t)
    return {"ok": ok, "stores": [(i, n.strip()) for i, n in stores],
            "shop_count": int(m.group(1)) if m else None}


# ── 平台侧风控证据（#331）────────────────────────────────────────────────
# 判「撞到风控」**只能**拿平台/脚本自己产出的东西当证据。面板文本不行：它含着被回显的
# 用户 prompt，而按**停手纪律**写的 prompt 几乎一定带「遇到风控/验证码就停下」这句话
# ⇒ 越守纪律的用例越容易被判成假 blocked（#331 实证：同一条用例一天内误导两次，
# 真相是脚本级 hard failure `✗ Script failed: 变体名 Warna 未设上`，一次风控都没撞到）。
#
# 这里扫的是**工具结果体**（脚本 stdout），不是面板文本。
#
# 🔴 为什么必须挨着 `✗ Script failed` 才算：下面这些串**在 skill 源码里也是字面量**
#    （`listing-product-on-tiktok/script.py` 的 `_CAPTCHA_PRESENT` 探针正则、
#    `managing-affiliate-program/script.py` 的 `gate_err` 文案）。Agent 中途 `read` 一下
#    脚本源码，结果体里就带上了这些词 —— 那是**源码**不是**回执**。只认「脚本失败回执里
#    紧跟着说自己撞了风控」这一种形态，宁可漏也不误报（漏 → unknown → uncertain，仍要人核）。
#
# ⚠️ **本信号未经真机验证**：272 份历史日志里一次真风控停手都没记到（两次判成风控的都是假的）。
#    它在真机上到底会不会亮，要等下一次真撞到风控才知道。所以判定方**不许**把
#    「risk_hits==0」当成「没撞风控」—— 见 run.py `classify_risk_control` 的三态。
_RISK_RECEIPT_MARKS = (
    "平台风控拼图验证", "风控铁律", "探到风控/验证码",
    "请完成下列验证后继续", "請完成下列驗證後繼續", "拖动完成上方拼图", "拖動完成上方拼圖",
    "完成安全验证", "滑动验证", "点选验证", "Slide to verify", "Verify to continue",
)
_RISK_RECEIPT_WINDOW = 300   # 拍的，无实测支撑：`✗ Script failed: <msg>` 的 msg 长度量级


def count_platform_risk_receipts(res_text: str) -> int:
    """工具结果体里有几处**平台侧**风控停手回执（`✗ Script failed:` 后紧跟风控措辞）。

    只回整数，不回原文 —— 结果体可能含 env 明文密钥/JWT（gw#2350），同 `_scrape_tool_trace`。
    """
    t = res_text or ""
    n = 0
    for m in re.finditer(r"✗ Script failed", t):
        seg = t[m.end():m.end() + _RISK_RECEIPT_WINDOW]
        if any(k in seg for k in _RISK_RECEIPT_MARKS):
            n += 1
    return n



# ── 平台侧「每账号一个活动会话」回执（#449 第四档）──────────────────────
# 那条绊线（`session_limit_regressed`）原来扫**整轮面板文本**，而面板里含被回显的 prompt、
# agent 的否定句和推测。它已经做了 strip_echo（#390，挡回显），**但挡不住否定句和推测**。
#
# 🔴 这一档比风控那档更该严 —— 代价不对称：
#   · 风控误报 = 白叫店主看一眼；
#   · **这一档误报 = 让人把已经拆掉的按店互斥改回去**，
#     等于拿一次误判去撤销一个有 wire 实证的修复（`optima-browser-use#345` / #383）。
#
# ⚠️ **而这两个标记本身没有任何真实样本**：2026-09-13 自己数过 **277 份** e2e 日志，
#    两个标记**各 0 命中**（标记是照旧文档字符串抄的）。⇒ 即使只认工具结果体，
#    它**仍然是在等一个没人见过的字符串**。判定方必须把这句写进判词，
#    别让下一个人把「没响」读成「没回归」。
_SESSION_LIMIT_MARKS = (
    "already has an active session",           # 英文（含带 "User " 前缀的服务端原文）
    "已有一个活动会话",                          # 中文回执
)

# ── #671：上面那条「只认工具结果体」的收窄**不够**，它误吃了两轮 ──────────────
#
# 🔴 **隔壁 30 行处的风控计数早就写清了为什么必须挨着失败回执**（见 `count_platform_risk_receipts`
#    上方注释）：「这些串**在 skill 源码里也是字面量** …… Agent 中途 `read` 一下脚本源码，
#    结果体里就带上了这些词 —— 那是**源码**不是**回执**。」
#    **而这一档当时只写了 `sum(t.count(m))`，那道收窄一个字都没抄过来。**
#
# 本仓自己就是那个反例（2026-09-13 数）：
#   `tiktok/skills/publishing-shoppable-video/SKILL.md` **3 处**
#   `tiktok/skills/exporting-ad-reports/script.py` **1 处**
#   —— 都是**文档在引用这句报错**，没有一处是回执。
#
# ⇒ 两轮误判的现场（#671，`e2e/logs/2026-09-13-1709-*` 与 `-1732-*`）：
#
# | | 第一轮 | 第二轮 |
# |---|---|---|
# | 真实原因 | 登录墙 / 账号停用（#670） | 风控滑块拼图 |
# | 判成 | 单会话约束回归 | 单会话约束回归 |
# | `session_limit_hits` | **2** | **2** |
# | **同一份日志里的工具轨迹** | **34 个工具，失败 0** | **21 个工具，失败 0** |
#
# 🔴 **一个「平台侧回执」，出现在一轮里每个工具都成功的会话中。**
#    平台因为会话上限**拒绝**了你，这件事不可能不表现为某个调用失败。
#    **这个矛盾就印在判词下面两行**，两轮都是，没人看。
#    而两轮的计数**同为 2** —— 恒定值，最像文档里的固定出现次数，最不像随机发生的故障。
#
# ⇒ 收窄成和风控同一种形状：**只认挨着失败回执的那一种**。
#
# ⚠️ **锚点本身未经真机验证**（这两个标记在 277 份日志 / 1485 份 wire 里从没以回执形态出现过，
#    唯一一次是一句否定句）。所以**收窄之后不许直接落到「没有」**：
#    数到了、但没挨着任何失败回执 → 判定方必须回 `unknown`，让人去 Wire 取原文。
#    **宁可让它一直停在 unknown，也不许它再自信地指向一个不存在的方向。**
#
# 🔴 **锚点必须是机器吐出来的那种串，不能是普通词。**
#    第一版我把 `失败` / `报错` / `错误` / 裸 `Error` 也列成锚点 —— **当场被真实文档打红**：
#    `publishing-shoppable-video/SKILL.md` 那段写的是「门控**失败**时浏览器会话故意留着…
#    紧接着重跑可能撞 `User already has an active session`」
#    ⇒ **散文里的「失败」离标记只有几十个字**，锚点照样点着。
#    **这就是拿一份已知为真的样本先校准判据的价值**（L11）：它在我写下的那一刻就是错的。
_SESSION_LIMIT_ANCHORS = (
    "✗ Script failed",                  # 脚本任务级失败回执（机器吐的）
    "Error:", "error:", "ERROR:",       # 带冒号 —— 命令/gateway 的错误串，散文里不会这么写
    "Traceback (most recent call last)",
)
_SESSION_LIMIT_WINDOW = 300     # 同 `_RISK_RECEIPT_WINDOW`：拍的，无实测支撑


def count_session_limit_mentions(res_text: str) -> int:
    """结果体里这两个标记**总共**出现几处 —— 含文档、源码、复述、否定句。

    🔴 **这不是证据**，它是「有没有必要去 Wire 看一眼」的线索。
    判定方只许拿它走 `unknown`，**不许拿它判 `hit`**（那是 `count_session_limit_receipts`）。
    """
    t = res_text or ""
    return sum(t.count(m) for m in _SESSION_LIMIT_MARKS)


def count_session_limit_receipts(res_text: str) -> int:
    """工具结果体里有几处**挨着失败回执**的「每账号一个活动会话」标记。

    收窄形状与 `count_platform_risk_receipts` 一致：标记必须落在某个失败回执**之后**
    `_SESSION_LIMIT_WINDOW` 个字符内，才算一次平台侧回执。**源码/文档里的字面量不算。**

    只回整数、不回原文 —— 结果体可能含 env 明文密钥/JWT（gw#2350），同 `_scrape_tool_trace`。
    """
    t = res_text or ""
    n = 0
    for mark in _SESSION_LIMIT_MARKS:
        start = 0
        while True:
            i = t.find(mark, start)
            if i < 0:
                break
            start = i + 1
            seg = t[max(0, i - _SESSION_LIMIT_WINDOW):i]
            if any(a in seg for a in _SESSION_LIMIT_ANCHORS):
                n += 1
    return n


# ── 平台侧登录态（#449）─────────────────────────────────────────────────
# 登录那一档的判据原来是**扫整轮面板文本里 agent 说的一句话**（「登录态过期」「尚未登录」…），
# 而 agent 那句话本身是它看一张截图推出来的，**零机读证据**。
# 2026-09-13 01:55 那轮的后果很具体：一个跳到本土域的杂散标签被报成「店掉线」，
# 判词写「非 skill 缺陷，登录后重跑」，**差点让店主白做一次登录 + 二步验证**。
#
# 平台侧的东西**已经有了**：`briefing-store-status` 的 `login_stop_output()` 吐结构化的
# `login_state` ∈ {logged_in, logged_out, unknown} + 带落地 URL 的 `login_why`。
# 而且那个字段自己就守着两条（#51）：**落地 host 与预期不符 → unknown；读不到 URL → unknown**，
# 都**绝不**落到 `logged_out`。所以判定方只要认这个字段，就自动继承了那两条纪律。
#
# ⚠️ **目前只有 `briefing-store-status` 吐它**（#51 的 fast-fail 只做了 1/19，见 #435）。
#    所以绝大多数用例这里会是「没有平台侧证据」→ 判定方必须回 unknown，**不许回 blocked**。
_LOGIN_STATE_RE = re.compile(r"login_state[\"'\s:=]+([a-z_]+)")


def scrape_login_states(res_text: str) -> list:
    """工具结果体里**脚本自报**的 login_state 取值（按出现顺序）。

    只回取值列表，不回原文 —— 结果体可能含 env 明文密钥/JWT（gw#2350），同 `_scrape_tool_trace`。
    取值不在白名单里的一概丢掉：宁可漏（→ unknown → uncertain，仍要人核），不误报。
    """
    ok = ("logged_in", "logged_out", "unknown")
    return [m.group(1) for m in _LOGIN_STATE_RE.finditer(res_text or "") if m.group(1) in ok]


# ── driver 自己看 URL 判的登录态（#2557）───────────────────────────────
#
# 🔴 **和上面那份 `scrape_login_states` 同名同值域，但不是一回事，⛔ 不许合并**：
#    那份是「从 agent 的**工具结果体**里刮 skill 自报的值」，喂的是用例判定管线；
#    这份是「driver **自己看落地 URL** 判」，喂的是 `attach()` 的收场。
#    ⛔ 本函数的判定**不喂给** `scrape_login_states` 那条管线。
#
# 🔴 **和 `briefing-store-status` 的同名函数也不一样**（那是随包发给云端 agent 的
#    marketplace skill，harness 不该依赖它的发布节奏）。三行差异：
#      | | briefing 那份 | 这份 |
#      | host 比较 | `expected_host not in url` **子串比** | **hostname 相等比** |
#      | logged_out 判法 | 命中已知**登录页路径** | 命中已知**站点根**（本应用登录入口就是站点根） |
#      | 极性 | 白名单 logged_out、兜底 logged_in | 白名单 logged_in + 白名单 logged_out，**其余 unknown** |
#
# **平台侧事实**（agentic-chat@603945a2 实读，⛔ 不是推断）：
#   · 未登录访问 `/chat` ⇒ middleware 307 到**同源站点根 `/`**（⚠️ 不是 `/login`）；
#   · 那道闸只在 `stripLocalePrefix(pathname) === '/chat'` 时生效，而它只剥**非默认** locale；
#   · next-intl@4.6.1 的 `as-needed` 会把 `/zh/chat` 先重定向成 `/chat` ⇒ 浏览器落不到带默认前缀的路径。
#
# ⚠️ 本文件里已有 **5 处** `"/chat" in p.url` 之类的字面量（选 tab / goto_chat / __main__）。
#    **本单知情地不统一它们**（超范围）；新判定一律从 `CHAT_URL` 派生。
_LOGIN_STATES = ("logged_in", "logged_out", "unknown")

# 连续多少轮判出「不在聊天页」才停手（≈秒）。🔴 **拍的，无实测支撑。**
# 它换来的是**不误判自愈瞬态**：已登录的人落在站点根时，落地页会自己 router.push("/chat")
# （agentic-chat LandingYzsgo 的 effect，注释原话「LoginModal does NOT navigate on success」）
# ⇒ 「落地站点根」可能是 1–3 秒自愈的瞬态，没有 settle 就会把它判成掉线、**白喊人一趟**。
# ⚠️ 已知盲区：若 `/chat ↔ /` 振荡周期 ≤ 本值，连续计数被反复清零 ⇒ 闸不响，退回今天的行为。
#    ⛔ **不许改成累计计数** —— 那会把自愈瞬态又判回 logged_out。
SETTLE_ROUNDS = 5

# `wait_for_login` 的三个数。🔴 **全是拍的，无实测支撑。**
# FIRST_PROBE_S：第一次主动探测之前等多久。⛔ 不许调小到十几秒 —— 没人能在那么短的时间里
#   收完短信验证码，那次探测几乎必然落在**人正在填表**的中途，把他跳走（= 换个形式复刻
#   用户那句「等我登录完它又关掉了」）。
# PROBE_EVERY_S：之后每隔多久再探一次。🔴 **必须可重复** —— 只探一次的话，人在第 2 分钟
#   才登完并落在 /workspace-select 这类页上时，唯一那次探测早用掉了 ⇒ **人登了，我们说他没登**。
FIRST_PROBE_S = 90
PROBE_EVERY_S = 60

# 形如 `/xx` 或 `/xx-YY` 的首段。真相在 agentic-chat `src/i18n/routing.ts` 的 `routing.locales`。
_LOCALE_SEG = re.compile(r"^/[A-Za-z]{2}(?:-[A-Za-z]{2})?(?=/|$)")


def _strip_locale(path: str) -> str:
    """剥掉**任何**形如 `/xx` / `/xx-YY` 的首段（含默认 locale `zh`）。"""
    path = path or "/"
    m = _LOCALE_SEG.match(path)
    return (path[m.end():] or "/") if m else path


# 🔴 **已知的** locale 根。真相在 agentic-chat `src/i18n/routing.ts` 的 `routing.locales`
#    （今天是 `['zh','zh-HK','en']`）。**跨仓耦合，前端加语种这里没跟 ⇒ 新语种的裸根落
#    `unknown`（安全方向：停手问人），⛔ 不会落 logged_out。**
_KNOWN_LOCALE_ROOTS = ("/zh", "/zh-HK", "/en")


def _is_site_root(path: str) -> bool:
    """站点根 —— 🔴 看**原始 path**，且只认**已知** locale 根。

    🔴 **这里的严格度和 `_strip_locale` 故意不一样**，依据是代价不对称：
      · `_strip_locale` 喂的是 `logged_in`，**宽一点没关系** —— 判错最坏回到今天的超时路径；
      · 本函数喂的是 `logged_out`，**必须严** —— 判错会叫人**白登一次**（#770 ② 付过代价，
        `scripts/test-login-todo-host-source.py` 记着那次）。
    ⇒ ⛔ **不许改用 `_LOCALE_SEG`**：`/ai` 结构上和 `/zh` 一模一样（都是两字母首段），
      那样 `/ai` 会被判成站点根 ⇒ `logged_out` ⇒ 叫人去登一个根本不用登的东西。
      判据 A33 钉这一条（写它的时候就是这么红的）。
    """
    path = (path or "/").rstrip("/") or "/"
    return path == "/" or path in _KNOWN_LOCALE_ROOTS


def validate_chat_url(chat_url: str) -> str:
    """→ 期望路径（`/chat`）。不合格**当场 `ValueError`**。

    🔴 **必须在打开浏览器之前调**（`chat_driver` L17：闸的位置不对等于没有）。
    放进轮询里 ⇒ tab 和 CDP 连接都开好了才抛 ⇒ 每次配错漏一个 tab（CEO「24 个 tab」那条）。
    """
    expected = _strip_locale(urlparse(chat_url or "").path)
    if expected in ("", "/"):
        raise ValueError(
            f"CHAT_URL={chat_url!r} 的路径是站点根 —— 那样「受登录闸保护的路径」和"
            "「未登录被踢到的落点」就是同一个，这道闸会静默失效。请指到聊天页。")
    return expected


def landed_url(page) -> str:
    """读落地 URL；读不到回 `""`（⛔ 不抛）。

    ⚠️ 真 Playwright 的 `Page.url` 是**本地缓存字符串**，页面关掉也不抛、照样返回旧值
    ——所以「读不到」这条分支挡的主要是夹具与异常态，**tab 死活要另外看 `is_closed()`**。
    """
    try:
        return page.url or ""
    except Exception:  # noqa: BLE001
        return ""


def login_todo(state: str, why: str, landed: str) -> str:
    """停手时交到**人**手上的那句话。🔴 这是本单唯一直接送到人手上的东西。

    本仓为它付过代价：2026-09-13 因为域名是**兜底猜的**，店主照着去登了一次、**白登**
    （`scripts/test-login-todo-host-source.py` 记着）。所以五条硬规矩：

    1. 🔴 **优先指「那个留着的标签页」** —— 无歧义，不用猜域；
    2. 点名 URL 时点的是**实际落地的那个**（观测来的），⛔ **不是 `CHAT_URL`**（可能是缺省猜的）；
    3. `YZSGO_CHAT_URL` **没被显式设过**时要说一声那是内置缺省地址；设过了就**不说**；
    4. 两态话术**不同**：`unknown` ⛔ **不许出现「去登录」这类祈使**（人可能根本不用登）；
    5. 两态都要带**回收话术** —— 留着的 tab 占一个并发名额。

    ⛔ **不许对具体路径分支**（不枚举 `/app` / `/workspace-select` …）——
       通用话术里带上 `why` 原样回显的那段就够。
    """
    if state not in _LOGIN_STATES:
        raise ValueError(f"未知登录态 {state!r}")
    head = ("浏览器里**那个还开着的标签页**（停在 " + (landed or "（读不到地址）") + "）"
            if state == "logged_out" else
            "**先去看一眼**浏览器里那个还开着的标签页（停在 " + (landed or "（读不到地址）") + "）")
    body = ("上去登录一下，登好了回来说一声，这一轮会接着往下跑。"
            if state == "logged_out" else
            "——" + (why or "判不出登录态") + "。⛔ 别急着登录，它未必是掉登录态。")
    default_note = ("" if os.environ.get("YZSGO_CHAT_URL") else
                    f"\n（顺带一说：这个地址是**内置缺省值**（{urlparse(CHAT_URL).hostname}，cn-prod）；"
                    "要跑的不是 cn-prod 就先设 `YZSGO_CHAT_URL`，别在这儿登。）")
    recycle = "\n如果这一轮不打算继续跑了，**请把这个标签页关掉**，它占着一个并发名额。"
    return head + body + default_note + recycle


def login_state(landed: str, chat_url: str, *, navigated: bool) -> tuple:
    """→ (`_LOGIN_STATES` 之一, 人话)。🔴 **只有已知签名才给确定判定，其余一律 `unknown`**。

    `navigated` **必填**：只有「我们自己 goto 过 `chat_url`」时，「落地站点根」才是
    「被那道闸踢出来」的签名；别人选的页面停在首页可能只是用户开着首页。
    """
    expected = validate_chat_url(chat_url)
    if not landed:
        return "unknown", "读不到落地 URL —— 判不出登录态，**别当成还登着**"
    want_host = (urlparse(chat_url).hostname or "").lower()
    got_host = (urlparse(landed).hostname or "").lower()
    if not got_host or got_host != want_host:
        return "unknown", (f"落在了别的域（{landed[:80]}），预期 {want_host} —— "
                           "**不判掉登录**：换个域上的登录态是另一回事")
    path = urlparse(landed).path
    if _strip_locale(path) == expected:
        return "logged_in", ""
    if navigated and _is_site_root(path):
        return "logged_out", f"被登录闸踢回站点根（{landed[:80]}）—— 这个源上没有登录态"
    # 🔴 其余一律 unknown，⛔ 不枚举同 host 路径（枚举是维护陷阱）。
    return "unknown", (
        f"页面落在 {path or '/'}，不是聊天页；**这既可能是没登录，也可能是登着但被导到了别处、"
        "或者还差一步没走完**（比如要选一个工作区）—— 先去那个标签页看一眼")


# ── 紫鸟 profile 的**声明**闸（#611；锁那一半已撤）────────────────────
#
# 🔴 **`ziniao-<profile_id>` 这把锁撤销了**（`working-as-worker` 的锁那一节 / 禁令 `ziniao-lock-withdrawn`）。
# 撤销理由三条：① 它防的不是并发而是「同店操作互相打断」，**而那个判断从来没有真机验证过**；
# ② 覆盖面只有本机调用方（云端 Agent 走 `browser-cli --ziniao-profile`，够不着 `~/.optima-locks/`）；
# ③ 它在 `status` 里和 `skill-*` 并排显示，**而两者强度完全不同**（L43）。
#
# ## 🔴 撤条文和撤执法是两个动作 —— 2026-09-13 只做了第一个
#
# 23:xx 宣布撤销时，这里只把「取不到 ⇒ 抛」改成「取不到 ⇒ 印一行照常走」，
# **`skill-lock acquire` 那一句留着了**。后果是**它继续往共享锁目录落 `skill-ziniao-*.lock`**，
# 于是同一把锁**两条路给出相反的答案**：
#   · harness 这条路：取不到也不拦你（`lock_busy_not_blocking` 24 次）
#   · **CLI 那条路：直接拒**（`-4` 2026-09-13 17:19Z 实测被拒；`-6` 17:17、`-10` 17:22 取到）
# 🔴 **而条文说这把锁根本不存在。** —— L43：混在一起的状态比没有状态更坏。
#
# ⇒ 2026-09-14：**这里一句 `skill-lock` 都不再调**，`skill-lock` 自己也在 `acquire ziniao-*`
#   上直接回 `RESULT=WITHDRAWN`（不落文件）。**两条路这才说同一句话。**
#
# ## ⚠️ 撤的是锁，**留下来的是这三样**
#
#   1. **`ziniao=` 这个必填关键字参数** —— 漏传 **直接 `TypeError`**（L111：坏了就拼不出来）。
#      它答的是「这一轮要动哪个 profile」，`send()` 要拿它和正文对账。
#   2. **`ziniao=None` 必须写理由** —— 「我确实不需要」和「我忘了」不许共用取值（L42）。
#   3. **各开各的 tab（`own_tab=True`），不要接管别人正在用的那个** ——
#      🔴 **这条纪律没有随锁一起撤**，而它现在只能靠文档和参数说明活着（#662）。
#
# ⚠️ **别把「有这个参数」读成「profile 不会被同时开」**：它从来就管不着云端那条路，
#    而现在连本机这条路也不再互斥 —— **它只是一份声明**。
#
# ## ⚠️ 它保证什么 —— **一句都别多说**
#
# 🔴 **它连「不同时开」都不保证了**（锁撤之前保证的正是这一条）。
# 它更**不保证**「一次只读导航对相邻轮次零影响」—— **那条至今没有证据**。
# 出处是 `-6` 的 #315 轮次账本（2026-09-13），原话：
# > **我现在没法证明「导航走开又回来」对下一轮零影响** ——
# > 我只能说这两轮之间没有我的观测被你覆盖。
#
# 🔴 **判词里不许出现「只读所以安全」。**

# ── 这道闸的流水账（#611，`-4` 2026-09-13 08:50Z 提的那个缺口）────────
#
# 🔴 **一道闸只报「我拦了」，不报「它至今拦了多少次」，那么
#    「它是不是误伤太多」这个问题在结构上就答不了** ——
#    而那正是「**误伤会让人把守卫关掉**」（L13）发生之前，唯一能救它的那个数。
#
# 本闸 2026-09-13 一天之内**误伤三次**（#645 两次 · #666 一次），三次都被人实打实地咬到；
# 而**它正确拦下过几次，没有任何地方记着**（`skill-lock` 自己也不写任何日志——查过了，
# `scripts/skill-lock.sh` 135 行里没有一处写日志）。⇒ **分子有人记，分母没有。**
#
# ## 🔴 放行也要记（L139）
#
# 「我用了哪条判据」是**记账**，不是诊断 —— **成功的时候也要记**。
# 只记拦下的话，算出来的永远是 100%：**没有分母的比例不是比例。**
#
# ## ⚠️ 本账**不答**「拦对了几次」
#
# 那要人来判 —— 记录只提供**分母**和**每次拦下的现场**。别把它读成准确率。
#
# ## ⚠️ 它绝不许把闸本身弄坏
#
# 记账失败一律咽掉：**一条记账用的 I/O 不许成为这道闸的新失败模式**。
# 代价是「从来没记过」和「记坏了」共用同一种表现（L65）——
# ⇒ **消费端（`scripts/ziniao-gate-report.py`）对「文件不在」回 `unknown`，不回 `0`**。
ZINIAO_GATE_LEDGER = os.path.expanduser("~/.optima-locks/ziniao-gate.jsonl")
ZINIAO_GATE_REPORT_HINT = (
    "（这一次已记进流水账；要看这道闸至今拦了多少次、放行多少次，"
    "跑 `python3 scripts/ziniao-gate-report.py`）")


def _gate_record(event, verdict, **fields):
    """往流水账追加一行。**永不抛** —— 见上面那段。

    `verdict` 只有两个取值：`"block"`（这一次拦下了）· `"pass"`（这一次放行了）。
    🔴 **两个取值分开写死**，不从 `event` 现推 —— 推导会让「新加了一种 event
    但忘了归类」悄悄落进某一格（L32：表里要有出口）。
    """
    assert verdict in ("block", "pass"), verdict
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "event": event, "verdict": verdict,
           "clone": os.path.basename(os.getcwd()), "pid": os.getpid()}
    row.update({k: v for k, v in fields.items() if v is not None})
    try:
        os.makedirs(os.path.dirname(ZINIAO_GATE_LEDGER), exist_ok=True)
        with open(ZINIAO_GATE_LEDGER, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:                                          # noqa: BLE001
        pass


def ziniao_lock_key(profile_id) -> str:
    """→ `ziniao-<profile_id>`：**这一轮的声明键**。

    ⚠️ 名字里的 `lock` 是历史遗留 —— **锁已经撤了**，这个串现在只有两个用途：
    ① `send()` 拿它和正文点名的 profile 对账；② 流水账里标明这一轮在哪个 profile 上。

    🔴 **必须用 profile id，不能用店名**：别名和 id 对不上账，
    `send()` 的对账会把「声明了 A、正文点了 A」判成「声明了别的」。
    """
    pid = str(profile_id).strip()
    if not pid:
        raise ValueError("ziniao profile id 是空的")
    if not re.fullmatch(r"[0-9]{6,}", pid):
        raise ValueError(
            f"ziniao={pid!r} 看起来不是 profile id（应是纯数字，≥6 位）。"
            "**别用店名** —— 别名和 id 对不上账，`send()` 的对账会判错。")
    return f"ziniao-{pid}"


def acquire_ziniao(ziniao, reason=None, what="e2e", _run=None):
    """进 `attach()` 之前的**声明**闸。**→ 两个值，不是一个。**

    → **`(key, owned)`**：`key` 是「我这一轮在哪个 profile 上」（`send()` 对账用），
    `owned` **恒为 `False`** —— 锁撤了，没有任何东西可以被「持有」，
    因此也没有任何东西需要在 `close()` 里放。

    🔴 **`owned` 为什么不干脆删掉**：它是调用方 `close()` 那条分支的开关，
    删了要同时改三处调用点；留成恒 `False` 反而让「谁都不许去 release」这件事
    **在返回值上写死**。⚠️ 但它**不许**再长回「有时为真」—— 那意味着锁回来了。

    · `ziniao="278…"`      ⇒ 声明这一轮要驱动哪个 profile。
      🔴 **它只是声明，不再取任何锁**（2026-09-14 撤执法）。
      **各开各的 tab（`own_tab=True`），不要接管别人正在用的那个** —— 这条纪律没撤。
    · `ziniao=None` + 理由 ⇒ 放行，并把理由打出来（**它会进流水账，供事后核**）
    · `ziniao=None` 无理由 ⇒ **抛 `ValueError`**：「明确不需要」必须写出来，
      否则它和「忘了传」又共用一个取值。

    ⚠️ `_run` 参数留着只为兼容既有调用/测试签名 —— **本函数不再调用任何外部命令**。
    """
    if ziniao is None:
        if not (isinstance(reason, str) and reason.strip()):
            raise ValueError(
                "ziniao=None 必须同时写明理由（reason=\"这一轮不碰任何紫鸟 profile，因为…\"）。"
                "**「我确实不需要」和「我忘了」不许共用一个取值。**")
        print(f"[ziniao] 显式声明不碰任何 profile：{reason.strip()}", flush=True)
        _gate_record("declared_none", "pass", reason=reason.strip(), what=what)
        return None, False
    key = ziniao_lock_key(ziniao)
    # 🔴 **这里以前有一句 `skill-lock acquire`。它是「撤了条文没撤执法」的那一半。**
    #    它落下的 `skill-ziniao-*.lock` 会让**别人**在 CLI 那条路上被拒
    #    —— 本进程自己看不见那个后果，所以它躲了一整天。
    print(f"[ziniao] 本轮声明的 profile：{key}（**这把锁已撤销，不取锁、不拦人**）\n"
          f"    ⚠️ **各开各的 tab，别接管别人正在用的那个**（own_tab=True）——"
          f"这条纪律没有随锁一起撤。", flush=True)
    _gate_record("declared", "pass", key=key, what=what)
    return key, False


# 🔴 **「没传」要有自己的取值**（#666 / L42）。
#    拿 `None` 当默认 ⇒ **「忘了传」会被读成「我明确不碰任何 profile」**，
#    而那正好是这道闸要抓的那种假声明 —— **默认值不许长得像一个合法声明。**
_INHERIT = object()


class ZiniaoDeclarationConflict(RuntimeError):
    """**声明说不碰 profile，发出去的正文里却点名了一个** —— 那个声明是假的。"""


# 🔴 **位数是判据的关键**（`-4` 2026-09-13 review 时点出来的）：
#    紫鸟 profile id = **14 位**；货盘 `product_id` = **19 位**。
#    ⇒ 用 `\d{14,}` 会**把商品 ID 全打成 profile** —— 误伤，而**误伤会让人把守卫关掉**。
#    这里用**前后都不能再有数字**的 14 位，19 位串整个不匹配。
_PROFILE_IN_TEXT = re.compile(r"(?<!\d)(\d{14})(?!\d)")
_PROFILE_FLAG = "--ziniao-profile"


def known_profile_ids() -> set:
    """这台机器/这个仓**认识**的紫鸟 profile id。

    唯一来源：`e2e/registry*.yaml` 里的 `store:` —— 本仓写下来的真实 profile。

    ## ⚠️ 2026-09-14：**第二个来源没了，而且是结构性地没了**

    原来还从 `skill-lock status` 里捞 `ziniao-*` 已被占的 key。
    **锁撤销之后 `skill-lock acquire ziniao-*` 不再落任何文件** ⇒
    那条来源**永远返回空**。留着它就是留一个「0 命中」和「方法坏了」
    长得一模一样的东西（L11），所以删掉，**并把窄下来的覆盖写在这里**。

    🔴 **为什么必须有这张表**（`-4` 2026-09-13 真机上被拦住才发现）：
    只按「14 位数字」判会**把时间戳当成 profile** ——
    `Tadaparty_20260912180918` 里的 `YYYYMMDDHHMMSS` **正好 14 位**，
    而它在本仓到处都是（计划名、导出文件名、日志名）。
    ⚠️ 那次误伤挡住的是一次**操作正确 profile 的真机**。
    **而下一个撞上的人，最省事的办法是把参数改短绕过去 —— 那才是真的绕过了闸。**

    ⚠️ **它的盲区要写出来**：**两张表都没收录的真 profile，这道闸看不见它**
    （比如新开一家店、还没进 registry）。**不声称没验过的覆盖。**
    ⚠️ 盲区比 2026-09-13 那版**更宽了一格** —— 以前「有人锁着」也算认识，现在不算。
    兜底只剩 `--ziniao-profile <id>` 那条无歧义写法。
    """
    ids = set()
    try:
        e2e = os.path.join(_repo_root(), "e2e")
        for fn in os.listdir(e2e):
            if fn.startswith("registry") and fn.endswith(".yaml"):
                txt = open(os.path.join(e2e, fn), encoding="utf-8", errors="replace").read()
                ids.update(re.findall(r"store:\s*[\"']?(\d{6,})", txt))
    except OSError:
        pass
    return ids


def _repo_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(os.path.dirname(here)))


def profiles_named_in(msg, known=None) -> list:
    """一段要发给 Agent 的文本里，点名了哪些紫鸟 profile。

    **判据故意窄**（只两种形态），因为**误伤会让人把守卫关掉**：
      · 字面 `--ziniao-profile`（云端 `runscript` 那条路的写法）—— **无条件认**
      · **独立的 14 位数字，且它是一个已知的 profile id**（见 `known_profile_ids`）

    ⚠️ **它抓不到**：用店名指代（「小海店」）· 把 id 拆开写 ·
       让 Agent 自己去 `ziniao profiles` 里挑 · **两张表都没收录的真 profile**。
       **写下来，别声称没验过的覆盖。**
    """
    text = str(msg or "")
    known = known_profile_ids() if known is None else set(known)
    ids = sorted({x for x in _PROFILE_IN_TEXT.findall(text) if x in known})
    # `--ziniao-profile <id>` 是**无歧义**的写法：它后面跟的数字一律认，不看表。
    for m in re.finditer(re.escape(_PROFILE_FLAG) + r"[=\s]+(\d{6,})", text):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    if _PROFILE_FLAG in text and not ids:
        return ["<--ziniao-profile 但没写出 id>"]
    return sorted(ids)


def check_declaration(declared_key, msg, known=None):
    """**声明与事实对账**：发出去的正文点名的 profile，和 `attach()` 时声明的对得上吗？

    🔴 这道闸补的是前两道的固有上限：**显式出口一定允许一个错误的显式声明** ——
    `ziniao=None, reason="只读 dump"` 写得出来，而那一轮真的动了 profile
    （`-4` 2026-09-13 06:14Z 自陈的那次就是这个形态）。
    **声明是 `None`、而正文里带着 profile —— 那一刻它就变成假的了，这时候抓得住。**

    ⚠️ 它**不是**「保证没动别的 profile」：见 `profiles_named_in` 的盲区。

    ## 🔴 为什么这一格是**拦**，而 `must_call` 那一格是**留痕**（#666 要求先定的那条）

    `-5` 问得对：**「声明 ≠ 实际」这一格该留痕还是该拦？**
    **两者不是同一类事，判据是「错了之后谁付代价」：**

    | | `must_call` 不符 | **本闸**不符 |
    |---|---|---|
    | 发生了什么 | 用例声明不加载 skill，实际加载了 | **正文点名 B，而我们手上是 A 的锁** |
    | 代价 | **测试质量**打折 —— 一条观测不准 | 🔴 **一条消息发给云端 Agent，去动一家不属于本轮的店** |
    | 可撤销吗 | 是（重跑一次） | **否 ——「发出去就收不回来了」** |

    ⇒ **留痕适用于「结论可能不准」；拦适用于「动作不可撤销」。** 本闸是后者。

    ⚠️ **而三次误伤都不是这条政策造成的**，逐条核过：
    ① 14 位时间戳被当成 profile id ⇒ **判据错**（#645 已修）；
    ② `close()` 放了别人的锁 ⇒ **所有权判据**（#645 已修）；
    ③ 点名 profile 的用例全被拦死 ⇒ **那个值有两个家**（#666，本次）。
    **没有一次是「它本该只记一笔却抛了异常」。** ⇒ **政策不动。**
    """
    named = profiles_named_in(msg, known)
    if not named:
        # 🔴 **正文没点名任何 profile ⇒ 不记账。**（分母的定义，L116）
        #    这一格不是「放行」，是**这道闸这一次没有可判的东西** ——
        #    把它记进去，分母就被每一条普通消息灌满，**算出来的比例不再是这道闸的比例**。
        #    ⇒ 记账的一次 = **它真的做了一次判断**。
        return
    if declared_key is None:
        _gate_record("false_declaration", "block", named=named)
        raise ZiniaoDeclarationConflict(
            f"attach() 时声明了 `ziniao=None`（这一轮不碰任何 profile），"
            f"但要发的正文里点名了 {named} —— **那个声明是假的**。\n"
            f"⇒ 要么改成 `ziniao=<那个 id>` 真去取锁，要么别在正文里点名 profile。\n"
            f"{ZINIAO_GATE_REPORT_HINT}")
    want = declared_key.split("ziniao-", 1)[-1]
    other = [n for n in named if n != want]
    if other:
        _gate_record("wrong_profile", "block", key=declared_key, named=named)
        raise ZiniaoDeclarationConflict(
            f"锁取的是 {declared_key}，正文里却点名了 {other} —— **拿着 A 的锁去开 B**。\n"
            f"{ZINIAO_GATE_REPORT_HINT}")
    # 🔴 **放行也要记**（L139）—— 只记拦下的话，算出来的永远是 100%。
    _gate_record("consistent", "pass", key=declared_key, named=named)


class ChatDriver:
    def __init__(self, port: int = 9222):
        self.port = port
        self._pw = None
        self.browser = None
        self.page = None
        self.session_id = None    # 本 tab 认领的 gateway sessionId（wire 归因/并行隔离校验都靠它）
        self._own_tab = False
        self._keep_for_human = None      # 非 None ⇒ 这一轮停手交人，tab 留着（CEO 那一格）
        self._ziniao_key = None   # 这一轮声明在哪个 profile 上（send() 的对账用；**不是锁**）
        self.tab_isolated = False # 是否真独占了一个 gateway session（并行的前提，降级后为 False）
        self._tool_baseline = 0   # 发送前的「個工具」面板数；本轮只抓之后新增的（防超时用例污染下一轮）
        self._console_errs = []   # 前端 console 报错缓冲——区分「傳送失敗」的真实根因（weekly_limit vs credits）

    # ── 连接生命周期 ──
    @staticmethod
    def _read_sid(page):
        """读某个 page 认领的 gateway sessionId（读不到返回 None）。"""
        try:
            return page.evaluate("(k)=>sessionStorage.getItem(k)", TAB_SID_KEY)
        except Exception:
            return None

    def _await_sid(self, timeout: int = 60):
        """等本 tab 把 sessionId 认领上（session_ready 才写）。超时返回 None。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            sid = self._read_sid(self.page)
            if sid:
                return sid
            self.page.wait_for_timeout(1000)
        return None

    def _await_sid_or_login_stop(self, timeout: int):
        """等认领；**同一个循环里**顺带判登录态。拿到 sid 回 sid；到点没拿到回 `None`。

        🔴 **只给 `want_own`（自己开 tab）那一档用。**
        ⛔ **绝对不许改 `_await_sid` 方法本身** —— `attach()` 里还有第二处调用（auto 降级**之后**
           那次 `_await_sid(10)`），那时 `self.page` 已经换成**用户自己的 tab**、`_own_tab` 已置 False。
           三处一起上闸 ⇒ 用户的 tab 不在 `/chat` ⇒ 判 unknown ⇒ 停手 ⇒ **把用户自己的 tab 关掉**
           = 本单要修的那件事被原样造回来。判据 A24 / A29 钉这两条，变异 M21 必须打红。

        🔴 **停手路径上 ⛔ 不调 `close()` / `browser.close()` / `_pw.stop()`**（判据 A12）：
          · `close()` 底下是 `browser.close()` + `_pw.stop()` ⇒ CDP 断连 ⇒ `wait_for_login` 必死；
          · 并发共用一台 Chrome 时 `browser.close()` **会把别人刚开的 tab 一并关掉**
            （2026-09-18 实测，见 `docs/.1918-coupon-e2e/.../send1.py` 的注释）。
          ⚠️ 紧挨着的 `strict` 分支就是 `self.close()` 然后 raise —— **⛔ 别抄那个邻居。**
        """
        deadline = time.time() + timeout
        off = 0
        while time.time() < deadline:
            # 🔴 先看 tab 还在不在：真 Playwright 的 `Page.url` 是**本地缓存字符串**，
            #    页面关掉也不抛、照样返回旧值 ⇒ 不看的话会一直判 logged_in、计数永远清零。
            try:
                gone = self.page.is_closed()
            except Exception:  # noqa: BLE001
                gone = True
            if gone:
                raise TabGoneDuringClaim(
                    "认领等待期间那个标签页没了（被手动关掉？被别的会话的 browser.close() 波及？）"
                    "—— 这一轮没法继续，也**没有现场可以留给人**。重开一轮即可。", self)
            sid = self._read_sid(self.page)
            if sid:
                return sid
            state, why = login_state(landed_url(self.page), CHAT_URL, navigated=True)
            off = 0 if state == "logged_in" else off + 1
            if off >= SETTLE_ROUNDS:
                self._login_stop(state, why)          # 必 raise
            self.page.wait_for_timeout(1000)
        return None

    def wait_for_login(self, timeout: int = 600) -> "ChatDriver":
        """人登录完之后**接着往下认领、继续干**（CTO 第 4 条）。

        用法（🔴 **注意是 `e.driver`**：两个生产调用点都是链式 `d = ChatDriver().attach(...)`，
        抛异常时 `d` 根本没被赋值）::

            try:
                d = ChatDriver().attach(ziniao=..., own_tab=True)
            except NeedsHumanLogin as e:
                print(e.todo)                    # 调用方喊人
                d = e.driver.wait_for_login()    # 人登完，接着认领

        🔴 **默认只读 URL，⛔ 不 goto**；只有隔了 `FIRST_PROBE_S` / 之后每 `PROBE_EVERY_S`
           才主动探测一次（探测 = `goto(CHAT_URL)`）。理由见那两个常数上面那段。
        🔴 **判 `logged_in` 也要连续 `SETTLE_ROUNDS` 轮**：人正过二步验证时 `/chat` 可能
           **闪现一帧**（cookie 在但失效 ⇒ 中间件放行落 /chat ⇒ 前端再 push('/')），
           见一次就去认领的话，人还在输验证码，这一轮已经结束了。
        🔴 **timeout=600 是拍的，无实测支撑。**
        """
        r = getattr(self, "_resume", None)
        if not r:
            raise RuntimeError("wait_for_login() 只能在 attach() 抛 NeedsHumanLogin 之后调")
        start = time.time()
        last_probe = None
        on = 0
        while time.time() - start < timeout:
            try:
                gone = self.page.is_closed()
            except Exception:  # noqa: BLE001
                gone = True
            if gone:
                raise TabGoneDuringClaim(
                    "等人登录的过程中那个标签页没了 —— 现场没了，重开一轮。", self)
            state, why = login_state(landed_url(self.page), CHAT_URL, navigated=True)
            on = on + 1 if state == "logged_in" else 0
            if on >= SETTLE_ROUNDS:
                return self._resume_claim()
            now = time.time()
            due = ((now - start) >= FIRST_PROBE_S if last_probe is None
                   else (now - last_probe) >= PROBE_EVERY_S)
            if due:
                last_probe = now
                # 登录成功后**大多数**会被落地页送回 /chat，但有例外（pendingSubscription /
                # pendingSkillPackCheckout / pendingCnPurchase 分支不跳、多身份先去 /workspace-select）
                # ⇒ 光等 URL 会等不到，得主动探一次。
                self.page.goto(CHAT_URL, wait_until="domcontentloaded")
            self.page.wait_for_timeout(2000)
        # 到点还没登上 —— 🔴 tab **仍然留着**、`_keep_for_human` **仍然非空**、⛔ 不宣称成功
        state, why = login_state(landed_url(self.page), CHAT_URL, navigated=True)
        if state not in ("logged_out", "unknown"):
            state, why = "unknown", "等到超时都没认领上，而页面看着像在聊天页 —— 判不出"
        url = landed_url(self.page)
        raise NeedsHumanLogin(state, why, url, login_todo(state, why, url), self)

    def _resume_claim(self) -> "ChatDriver":
        """接上 `attach()` 里认领那一段。🔴 `taken` **重拍并排除 self.page**。

        ⛔ 复用 `attach()` 当时那份快照 = 十分钟前的，期间别人认领的 session 不在里面
           ⇒ 撞车漏判 ⇒ **并行静默串台**（`own_tab=True` 存在的唯一理由）。
        ⛔ 天真重拍 = 自己的 tab 登录后已经有 sid ⇒ **自己撞自己** ⇒ strict 抛 + 关 tab
           ⇒ **人刚登的那次白登，tab 还被关了**。
        """
        r = self._resume
        ctx, strict, want_own = r["ctx"], r["strict"], r["want_own"]
        taken = {sid for sid in (self._read_sid(p) for p in ctx.pages
                                 if p is not self.page and "/chat" in p.url) if sid}
        sid = self._await_sid(r["claim_timeout"])
        why = None
        if not sid:
            why = "人登上了，但这个新 tab 仍然没认领到 gateway session"
        elif sid in taken:
            why = (f"新 tab 与已有 tab 撞同一个 session（{sid}）—— 该环境 multi-tab 没开"
                   f"（NEXT_PUBLIC_MULTI_TAB_SESSION 是 build-time flag、默认关）")
        if why:
            if strict:
                # 🔴 ⛔ 不 close：现场还要留给人（`_keep_for_human` 仍非空）
                raise TabSessionUnavailable(why + "，并行会静默串台。退回串行跑。")
            # auto ⇒ 降级复用已有 tab（**与今天同**，D4 说了这一档一个字不改）
            self.release_tab_for_human()
            print(f"[chat_driver] ⚠️ 续跑仍未独占 tab（{why}）—— 降级复用已有 tab")
            self._close_own_tab()
            self._own_tab = False
            chat = [p for p in ctx.pages if "/chat" in p.url]
            self.page = chat[0] if chat else (ctx.pages[-1] if ctx.pages else ctx.new_page())
            self._hook_console()
            self.session_id = self._await_sid(10)
            self.tab_isolated = False
            return self
        self.session_id = sid
        self.tab_isolated = bool(want_own)
        # 🔴 **只能在这里清** —— 挪到函数入口会让判据全绿而 tab 被关掉（A16 + M8b）
        self.release_tab_for_human()
        return self

    def _login_stop(self, state: str, why: str):
        """停手交人：留现场 + 抛。⛔ 这条路上不关 tab、不降级、不等满超时。"""
        url = landed_url(self.page)
        todo = login_todo(state, why, url)
        self.keep_tab_for_human(f"{state}：{why or '判不出登录态'}")
        raise NeedsHumanLogin(state, why, url, todo, self)

    def attach(self, *, ziniao, reason=None, own_tab="auto",
               claim_timeout: int = 60) -> "ChatDriver":
        """连上调试端口 Chrome 并选定本 driver 要驱动的 tab。

        🔴 `ziniao` 是**必填关键字参数**（#611）——漏传直接 `TypeError`，
        **不是警告、不是默认值**。它答的是「这一轮要动哪个紫鸟 profile」：

        - `ziniao="27884995544032"` ⇒ **声明**这一轮要驱动哪个 profile
          （🔴 **不取任何锁** —— `ziniao-<id>` 这把锁 2026-09-14 撤了执法，见模块上方那段）
        - `ziniao=None, reason="…"` ⇒ **显式**声明这一轮不碰任何 profile（理由必填）

        **「我确实不需要」和「我忘了」不共用取值** —— 后者是 `TypeError`。
        🔴 **没有锁要放** ⇒ `close()` 里那半也一起没了。

        ## 🔴 这个声明**管谁、不管谁**（写在这里，别只写在 PR 里）

        穷举过所有能驱动一个紫鸟 profile 的入口（#611）：

        | 入口 | 在哪跑 | 本闸拦不拦 |
        |---|---|---|
        | e2e 逐条用例（`case["store"]`） | 本机 | ✅ 在 `run.run_case` 那一层声明 |
        | **直接 `ChatDriver().attach()`**（人/脚本） | 本机 | ✅ **就是这个参数** |
        | 🔴 云端 Agent 跑 marketplace skill：`browser-cli … --ziniao-profile` | **云端 pod** | ❌ **看不见** |
        | 人在终端直接敲 `browser-cli --ziniao-profile` | 本机 | ❌ 看不见 |

        🔴 **量**：20/34 份 SKILL.md 教 Agent 传 `--ziniao-profile` ——
        **绝大多数真正驱动 profile 的流量走的是云端那条路，而 pod 上没有
        `~/.optima-locks/`，这把锁在那条路上结构性够不着。**

        ⚠️ **所以别把「有这道闸」读成「profile 不会被同时开」。**
        它盖住的是**本机调用方**；云端那条要互斥，得在服务端有东西执法，**不在本仓**。

        ⚠️ 另：e2e 主路径上 `attach()` 收到的**恒是 `ziniao=None`**
        （worker 的 tab 不绑定 profile，profile 在逐条用例那层声明）——
        **也就是说这个必填参数在主路径上永远不被真正行使**。
        它挡的是**别的调用方**。**知道这一点再决定要不要依赖它。**

        `own_tab` 三态 —— **默认自己开 tab**（平台既然支持多 tab，独占就是常态，共用才是例外）：

        - `"auto"`（默认）：先试着自己开 tab 独占一个 gateway session；该环境不支持多 tab
          （`NEXT_PUBLIC_MULTI_TAB_SESSION` 没开，新 tab 会被并回同一个 session）或认领超时时，
          **降级复用已有 tab** 并把 `self.tab_isolated` 置 False、打一行 warn。
          单 driver 场景下复用是安全的（那就是改并发之前的老行为），所以降级不是问题。
        - `True`（**并行必用**）：严格独占，拿不到独立 session 直接抛 `TabSessionUnavailable`。
          🔴 并行时绝不能用 "auto" —— 多个 worker 各自降级到同一个已有 tab = 静默串台
          （见模块 docstring 的实证）。要并行就必须 fail-fast 让调用方退回串行。
        - `False`：显式复用已有 tab（旧行为；只在你确实想操作用户当前那个 tab 时用）。

        `self.session_id` 记认领到的 gateway sessionId（Wire 归因锚点）；
        `self.tab_isolated` 说明这个 driver 是不是真独占了一个 session。
        """
        # 🔴 闸在**开浏览器之前**（L17：位置不对等于没有）——
        #    声明没写全（漏传 / `None` 无理由）就不该有任何动作发生。
        # ⚠️ 第二个返回值**恒为 `False`**（锁撤了，没有可持有的东西）⇒ 直接丢掉，
        #    **不要再落一个 `self._ziniao_owned`** —— 那个字段是 `close()` 放锁的开关，
        #    留着它等于把锁的接口留在那儿等人接回去。
        # 🔴 配置闸也在**开浏览器之前**（L17：位置不对等于没有）。放进轮询里的话，
        #    tab 和 CDP 连接都已经开好了才抛 ⇒ 每次配错漏一个 tab（CEO「24 个 tab」那条）。
        #    ⚠️ 排在 `acquire_ziniao` **之前**：它没有副作用，而 `acquire_ziniao` 会写 ledger。
        validate_chat_url(CHAT_URL)
        if own_tab is not False and claim_timeout < SETTLE_ROUNDS:
            raise ValueError(
                f"claim_timeout={claim_timeout} 比 SETTLE_ROUNDS={SETTLE_ROUNDS} 还小 —— "
                "连续计数到不了阈值，**登录态这道闸一次都不会响**，会静默退回老行为。")
        self._ziniao_key, _ = acquire_ziniao(
            ziniao, reason, what=f"e2e attach own_tab={own_tab}")
        strict = (own_tab is True)
        want_own = (own_tab is True or own_tab == "auto")
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.connect_over_cdp(f"http://localhost:{self.port}")
        ctx = self.browser.contexts[0]
        if want_own:
            # 先快照**别的 tab 已认领的 sid**，再开自己的 —— 顺序反了就分不清撞没撞车。
            # ⚠️ 多 worker 并行 attach 时调用方要串行化这一段（各自认领完再放下一个），
            #    否则两个新 tab 可能都在对方写 sessionStorage 之前完成快照，撞车检测漏判。
            taken = {sid for sid in (self._read_sid(p) for p in ctx.pages if "/chat" in p.url) if sid}
            self.page = ctx.new_page()
            self._own_tab = True
            self.page.goto(CHAT_URL, wait_until="domcontentloaded")
        else:
            # 明确选 chat page（url 含 /chat），别抓到残留 tab（如 device 授权页）——它可能中途关闭致 TargetClosedError
            chat = [p for p in ctx.pages if "/chat" in p.url]
            self.page = chat[0] if chat else (ctx.pages[-1] if ctx.pages else ctx.new_page())
            taken = None
        # 清掉可能残留的视口仿真：driver 进程被杀时 Playwright 的 1440x900 override 会孤儿化留在
        # 标签页上（用户看到页面右侧大块空白）。别的会话 clear 不掉它——必须先 set 接管再 clear。
        try:
            cdp = self.page.context.new_cdp_session(self.page)
            cdp.send("Emulation.setDeviceMetricsOverride",
                     {"width": 0, "height": 0, "deviceScaleFactor": 0, "mobile": False})
            cdp.send("Emulation.clearDeviceMetricsOverride")
        except Exception:
            pass   # 清不掉不影响驱动，只影响观感
        # 捕获前端 console：发送被拒时「傳送失敗」toast 是通用的，真实原因（weekly_limit=本周额度用完 / 积分不足 …）
        # 只在 console 里（[Chat Error] weekly_limit…）。留最近 20 条供 send() 分流，别再把 weekly_limit 误报成 credits。
        self._hook_console()
        # 续跑要用的现场（spec D5.2）。🔴 `taken` **不存** —— 续跑时必须重拍并排除 self.page。
        self._resume = {"ctx": ctx, "claim_timeout": claim_timeout,
                        "strict": strict, "want_own": want_own}
        # 🔴 **只有 `want_own` 这一档走新循环**；`own_tab=False` 与下面降级之后那次
        #    一律照旧走 `_await_sid`（spec D2.1，判据 A24 / A29）。
        self.session_id = (self._await_sid_or_login_stop(claim_timeout) if want_own
                           else self._await_sid(10))
        if want_own:
            why = None
            if not self.session_id:
                why = f"新 tab {claim_timeout}s 内没认领到 gateway session（没登录？连不上 gateway？）"
            elif self.session_id in taken:
                why = (f"新 tab 与已有 tab 撞同一个 session（{self.session_id}）—— 该环境 multi-tab 没开"
                       f"（NEXT_PUBLIC_MULTI_TAB_SESSION 是 build-time flag、默认关）")
            if why:
                if strict:
                    self.close()          # 失败路径也要把刚开的 tab 关掉，别留垃圾
                    raise TabSessionUnavailable(why + "，并行会静默串台。退回串行跑。")
                # auto：降级复用已有 tab。单 driver 复用是安全的（= 改并发之前的老行为）。
                print(f"[chat_driver] ⚠️ 独占 tab 失败（{why}）—— 降级复用已有 tab；"
                      f"**此 driver 不可用于并行**")
                self._close_own_tab()
                self._own_tab = False
                chat = [p for p in ctx.pages if "/chat" in p.url]
                self.page = chat[0] if chat else (ctx.pages[-1] if ctx.pages else ctx.new_page())
                self._hook_console()
                self.session_id = self._await_sid(10)
                self.tab_isolated = False
                return self
        self.tab_isolated = bool(want_own)
        return self

    def _hook_console(self) -> None:
        """捕获前端 console：发送被拒时「傳送失敗」toast 是通用的，真实原因（weekly_limit / 积分…）只在 console 里。"""
        self.page.on("console", lambda m: self._console_errs.append((m.text or "")[:200])
                     if m.type in ("error", "warning") else None)

    # ── 收尾：这一轮开的 tab，这一轮关掉 ────────────────────────────────
    #
    # 🔴 **CEO 2026-09-13 夜发来紫鸟截图：24 个 tab。** 原话：
    #    「所有的 skills、所有的任务都只会新建 tab 而不关闭 tab，紫鸟就是越开 tab 越多」
    #
    # ⚠️ **`close()` 本来就会关自己那个 tab，问题从来不在这里** ——
    #    在于**调用方**：临时脚本写 `d.close()` 在函数末尾，**一抛异常就漏**，
    #    🔴 **而失败轮次恰恰最多。**（本文件作者自己今晚漏过两个。）
    # ⇒ 所以加的不是「再关一次」，是**让漏掉变难**：`with` 一定关。
    #
    # 🔴 **CEO 亲自留的那一格**：
    #    「任务完成后就应该把它关掉；**除非需要用户手动介入去点击，才应该保留**。」
    #    ⇒ 判据：**这一轮是不是给店主留了一句「你去点一下」？是 ⇒ 留；否 ⇒ 关。**
    #    用 `keep_tab_for_human("为什么")` 声明，**理由必填** ——
    #    「确实要留给人」和「忘了关」不许共用一个取值。

    def keep_tab_for_human(self, reason: str) -> None:
        """声明这一轮**停手交人**，tab 留着不关（CEO 定的那一格）。

        🔴 **理由必填**：留一个 tab 是要占并发名额的，
        「确实要留给人」和「忘了关」**不许共用一个取值**。
        """
        if not (isinstance(reason, str) and reason.strip()):
            raise ValueError(
                "keep_tab_for_human(reason=...) 的理由必填 —— "
                "**「要留给店主点」和「忘了关」不许共用一个取值**。"
                "例：keep_tab_for_human('停在验证码，要店主本人过')")
        self._keep_for_human = reason.strip()
        print(f"[tab] 这一轮**留着不关**（停手交人）：{reason.strip()}", flush=True)

    def release_tab_for_human(self) -> None:
        """撤销「停手交人」——人已经介入完了，那一格例外不再成立。

        🔴 **这是补缺口，⛔ 不是改判定**：`keep_tab_for_human` / `_close_own_tab` 的判定
           一个字没动。那个闸原来**只有 set 没有 unset**（全仓只有 `__init__` 与 setter
           两处赋值），于是「人登录完、接着跑完」的那条路上 tab **永远关不掉** ——
           正是 CEO 那张「紫鸟 24 个 tab」截图的成因。
        🔴 CEO 原话自己支持这一步：「除非需要用户**手动介入去点击**，才应该保留」。

        ⚠️ **只许在「认领成功 / 已降级」之后调**。挪到 `wait_for_login` 入口会让判据全绿
           而 tab 被关掉：超时抛出后 `_keep_for_human` 已是 None ⇒ 调用方的
           `finally: d.close()` 走到 `_close_own_tab()` 时早退判定不成立
           ⇒ **把人正在登录的那个 tab 关掉**（判据 A16 + 变异 M8b 钉这一条）。
        """
        self._keep_for_human = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        # 🔴 **异常退出也要关** —— 只在成功路径上关，等于「失败轮次的 tab 永远留着」。
        self.close()
        return False        # 不吞异常

    def _close_own_tab(self) -> None:
        """只关本 driver 自己开的 tab（降级/收尾共用）。

        ⚠️ **只关自己这一轮开的那个**（`self._own_tab`）——
        🔴 **绝不去关别人正在用的**：十个 session 并发，
        「顺手清理陈旧 tab」会关掉别人的那一个，而那种误伤没有任何东西拦得住。
        """
        if getattr(self, "_keep_for_human", None):
            print(f"[tab] 保留（停手交人）：{self._keep_for_human}", flush=True)
            return
        if self._own_tab and self.page:
            try:
                self.page.close()
            except Exception:
                pass

    def close(self) -> None:
        # 只断开 attach，不关用户的 Chrome。**自己开的 tab 要自己关**（关掉即释放该 gateway
        # session 的并发名额）；不是自己开的（默认 attach 复用的用户 tab）一律不动。
        try:
            self._close_own_tab()
        finally:
            try:
                if self.browser:
                    self.browser.close()
            finally:
                try:
                    if self._pw:
                        self._pw.stop()
                finally:
                    # ⚠️ 这里以前放锁。**锁撤了（2026-09-14）⇒ 没有任何东西要放。**
                    #    只把声明清掉，免得下一次 attach 之前 `send()` 读到上一轮的 key。
                    self._ziniao_key = None

    def _eval(self, js: str, arg=None):
        return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)

    # ── 单对话隔离（**本 tab 内**同一时间只能有一个对话在进行；跨 tab 可并行，见模块 docstring）──
    def is_generating(self) -> bool:
        """当前是否有对话正在流式生成。派生自 chat_state（单一真相）。"""
        return self.chat_state() == "generating"

    # #1635：#1197 B1 真机——两问 AskUserQuestion 卡片，chat_state 判到 waiting_input，read_question 却回 ''，
    #    预设 answers 永不触发、5 分钟后 gateway 判超时。那次没留 DOM dump，**真实形态没探到**；候选形态有三种，
    #    这里一并盖住：(a) 已渲染的活卡 innerText 为 ''（祖先 visibility:hidden 之类，rect>0 但 innerText 空）；
    #    (b) 两次 _eval 之间 DOM 被换掉/重挂；(c) 页面上有**多张** question-card（消息流里内联的历史只读卡 #161B3 T6 无提交按钮
    #    + 当前活卡）而老代码四处各取「第一张可见的卡」。
    #    ⇒ 活卡的定义只有一个：**卡内有 確認/下一題/補充回答 按钮**（多张取最后一张——DOM 序历史在前、当前在后）；
    #    找不到活卡再退到最后一张可见卡。所有读/答/关都用同一条判据。
    _CARD_PICK_JS = r"""
            const cards=[...document.querySelectorAll('[data-testid="question-card"]')];
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            const isLive=c=>[...c.querySelectorAll('button')].some(b=>/確認|确认|下一題|下一题|補充回答|补充回答/.test((b.textContent||'').trim()));
            const liveCards=cards.filter(isLive);
            const card=liveCards[liveCards.length-1] || cards.filter(vis).pop() || null;
    """

    def has_pending_question(self) -> bool:
        """Agent 是否停在「需要你的輸入」(AskUserQuestion 弹问)。派生自 chat_state。
        这个状态既非「生成中」也非「结束」，若不处理，下一个用例会串进这个卡住的对话。"""
        return self.chat_state() == "waiting_input"

    def dismiss_pending_question(self) -> bool:
        """关掉待输入问题框（点卡内 取消/關閉），让对话回到可开新对话的状态。返回是否点到。"""
        clicked = bool(self._eval("()=>{" + self._CARD_PICK_JS + r"""
            if(!card) return false;
            const btn=[...card.querySelectorAll('button')].find(e=>/^(取消|關閉|关闭)$/.test((e.textContent||'').trim()) && vis(e) && !e.disabled);
            if(btn){btn.click(); return true;}
            return false;
        }"""))
        if clicked:
            self.page.wait_for_timeout(1200)
        return clicked

    def read_question(self) -> str:
        """读当前 AskUserQuestion 卡片全文（问题+选项标题+按钮）——供 _pick_answer 匹配。

        #1635：**不按可见性过滤**（可见性留给 answer_question 点按钮那步）——活卡先 `scrollIntoView` 再读，
        `innerText` 空就退到 `textContent`（祖先 visibility:hidden 时 innerText 为空、textContent 仍在）；
        没有活卡就把**所有** question-card 的文本合并（历史只读卡也算，宁可多匹配也别空串）。
        读到的来源记在 `self.last_question`（`source ∈ live|all_cards|none`、`n_cards`、`text`），
        wait_reply 会把它带进返回值 —— **「读不到」和「没问」不许长得一样**。"""
        got = self._eval("()=>{" + self._CARD_PICK_JS + r"""
            const text=e=>(e.innerText||e.textContent||'').trim();
            if(card && isLive(card)){                       // 只有真活卡才单读；退回来的「最后一张可见卡」走合并
                try{ card.scrollIntoView({block:'nearest'}); }catch(e){}   // nearest：别把 react-window 的自动跟随关掉
                const t=text(card);
                if(t) return {source:'live', n_cards:cards.length, text:t.slice(0,1200)};
            }
            const all=cards.map(text).filter(Boolean).join('\n---\n');
            if(all) return {source:'all_cards', n_cards:cards.length, text:all.slice(-1200)};
            return {source:'none', n_cards:cards.length, text:''};
        }""") or {"source": "none", "n_cards": 0, "text": ""}
        if not isinstance(got, dict):
            got = {"source": "none", "n_cards": 0, "text": str(got or "")}
        self.last_question = got
        return got.get("text") or ""

    def answer_question(self, text: str) -> bool:
        """给当前 AskUserQuestion **回答并提交** —— 真跟鸭嘴兽对话往下走（不是关掉）。
        两种题型（照 agentic-chat QuestionCard 结构）：
          ① 选项题：`text` 与某选项标题互含 → 点该选项行；否则点「其它」展开 textarea 填 text；
          ② 开放题（0 选项）：直接有 textarea → 填 text。
        再点「下一題」(非末题) 或「確認/補充回答」(末题) 提交。返回提交动作是否真的点了。"""
        acted = self._eval("(t)=>{" + self._CARD_PICK_JS + r"""
            const norm=s=>(s||'').replace(/\s+/g,'').toLowerCase();
            if(!card) return 'no-card';
            try{ card.scrollIntoView({block:'nearest'}); }catch(e){}
            const nt=norm(t);
            // 选项行 = 卡内 cursor:pointer 的 div（OptionRow），标题在 .font-medium
            const rows=[...card.querySelectorAll('div')].filter(e=>{
                const st=getComputedStyle(e); const tx=(e.textContent||'').trim();
                return st.cursor==='pointer' && tx && tx.length<200;
            });
            const titleOf=r=>((r.querySelector('.font-medium')||r).textContent||'').trim();
            // ① 先试固定选项（排除「其它」）：标题与 t 互含即点它
            for(const r of rows){
                const ti=titleOf(r); if(!ti || /^其它$|^其他$/.test(ti)) continue;
                const nti=norm(ti);
                if(nti && (nti.includes(nt) || nt.includes(nti))){ r.click(); return 'option'; }
            }
            // ② 开放题：卡内已有 textarea → 直接填
            let ta=[...card.querySelectorAll('textarea')].find(vis);
            if(ta){
                const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
                ta.focus(); set.call(ta,t); ta.dispatchEvent(new Event('input',{bubbles:true}));
                return 'textarea';
            }
            // ③ 选项题但无匹配 → 点「其它」展开 textarea
            const other=rows.find(r=>/^其它$|^其他$/.test(titleOf(r)));
            if(other){ other.click(); return 'other-opened'; }
            return 'no-input';
        }""", text)
        if acted == "no-card":
            return False
        self.page.wait_for_timeout(700)
        # 若刚点开「其它」，textarea 才出现 → 再填一次
        if acted == "other-opened":
            self._eval("(t)=>{" + self._CARD_PICK_JS + r"""
                const ta=card && [...card.querySelectorAll('textarea')].find(vis);
                if(ta){const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
                    ta.focus(); set.call(ta,t); ta.dispatchEvent(new Event('input',{bubbles:true}));}
            }""", text)
            self.page.wait_for_timeout(500)
        # 提交：末题点 確認/補充回答，非末题点 下一題（都在卡内、非取消/關閉、未 disabled）
        submitted = bool(self._eval("()=>{" + self._CARD_PICK_JS + r"""
            if(!card) return false;
            const btns=[...card.querySelectorAll('button')].filter(e=>vis(e) && !e.disabled);
            const b=btns.find(e=>/^(確認|确认|補充回答|补充回答)$/.test((e.textContent||'').replace(/[✓\s]/g,'')))
                  || btns.find(e=>/^(下一題|下一题)/.test((e.textContent||'').trim()));
            if(b){ b.click(); return true; }
            return false;
        }"""))
        self.page.wait_for_timeout(2500)
        return submitted

    @staticmethod
    def _pick_answer(question: str, answers) -> str | None:
        """按问题文本匹配预设答案。answers=[{match:正则关键词, answer:文本}, ...]；无匹配返回 None。"""
        if not answers:
            return None
        import re as _re
        for a in answers:
            if _re.search(a.get("match", ""), question):
                return a.get("answer")
        return None

    def read_toasts(self) -> list:
        """读**全局 ToastContainer**（providers.tsx 挂载的 div[aria-live="assertive"]，
        ui/Toast.tsx 渲染）里当前可见的 toast。返回 [{type,title,description}]，
        type 由配色类反推（bg-red-50=error / bg-yellow-50=warning / bg-green-50=success / 其余 info）。
        错误 toast 的 description 常带「錯誤代碼：XXX」（useFriendlyError 的 diagnosticCode 副行，
        如 SESSION_NOT_FOUND）——判 blocked 根因全靠它，别只看标题。带 action 的 toast persist
        不自动消失（关不掉就一直在），残留时 ensure_idle 靠 reload 清。"""
        return self._eval(r"""()=>{
            const tc=document.querySelector('div[aria-live="assertive"]'); if(!tc) return [];
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            return [...tc.querySelectorAll('div.rounded-lg')].filter(vis).map(e=>{
                const cls=e.className||'';
                const type=/bg-red-50/.test(cls)?'error':/bg-yellow-50/.test(cls)?'warning':/bg-green-50/.test(cls)?'success':'info';
                const ps=e.querySelectorAll('p');
                return {type, title:(ps[0]?.textContent||'').trim(), description:(ps[1]?.textContent||'').trim()};
            });
        }""") or []

    def is_service_error(self) -> bool:
        """yzsgo 侧 LLM 服务报错（「AI 服務出錯」/llm_error toast）—— 非 skill 缺陷。"""
        return self.chat_state() == "service_error"

    def chat_state(self) -> str:
        """**统一感知对话 UI 状态**（单一真相），优先级：待输入 > 生成中 > 报错 > 空闲。
        所有 send/answer/wait 都据此判断，不靠「填了字就以为发出去了」。返回：
          'service_error' —— AI 服務出錯/llm_error toast 在
          'waiting_input' —— AskUserQuestion「需要你的輸入」框在（要么回答、要么关掉）
          'generating'    —— 「停止生成」在，Agent 正在流式跑
          'idle'          —— 都不在，空闲可发消息
        """
        # 用 agentic-chat 前端的**稳定 testid**（stop-button/question-card）+ 短文本 aiError toast。
        # ⚠️ 优先级：待输入 > **生成中** > 报错 > 空闲。stop-button = 权威「正在生成」信号，
        #    必须**高于**残留错误 toast——实测 llm_error toast 会残留 DOM(opacity1、不销毁)，若把
        #    service_error 排前面，正在跑的对话会被残留 toast 盖成 service_error(用户实测:对话在跑我却报错)。
        return self._eval(r"""()=>{
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            // ① 待输入：question-card 且**可答**（卡内有 確認/下一題/補充回答 按钮；readOnly 历史卡无按钮=不算）
            // #1635：多张卡时看**任何一张**可见活卡，不是「第一张可见卡恰好有按钮」（第一张可能是历史只读卡）
            const cards=[...document.querySelectorAll('[data-testid="question-card"]')];
            const isLive=c=>[...c.querySelectorAll('button')].some(b=>/確認|确认|下一題|下一题|補充回答|补充回答/.test((b.textContent||'').trim()));
            if(cards.some(c=>vis(c) && isLive(c))) return 'waiting_input';
            // ② 生成中：stop-button 在（权威信号，优先于残留错误 toast）
            if([...document.querySelectorAll('[data-testid="stop-button"]')].some(vis)) return 'generating';
            // ③ 报错 toast：仅在**既不待输入也不生成**时才当真（自身文本短=真 toast）
            if([...document.querySelectorAll('*')].some(e=>{const t=(e.textContent||'').trim();return t.length<40 && /服務出錯，請重試|服务出错，请重试|AI 服務出錯|AI 服务出错/.test(t) && vis(e);})) return 'service_error';
            // ④ 输入框 disabled = 忙（生成中/上一轮 finalizing，但没显示 stop-button）→ 不算 idle，
            //    否则 send 会往禁用框打字+回车、无声失败(send_failed)。
            const ta=document.querySelector('textarea');
            if(ta && ta.disabled) return 'generating';
            return 'idle';
        }""") or "idle"

    def ensure_idle(self, timeout: int = 90) -> bool:
        """让**本 tab** 回到 idle 好开新的。**本 tab 的对话都是本 driver 发起、我控制它——正在生成
        就直接 stop（abort），不被动等它自然结束**（用户点醒：我发起的我停，不用干等）。
        待输入→关问题框；报错→reload 清 toast。返回是否 idle。
        ⚠️ 作用域**只有本 tab**：并行跑时别指望它能清别的 tab，也绝不会误停别的 tab 的 turn
        （chat_state/stop_generating 都只看 self.page 的 DOM）。"""
        start = time.time()
        while time.time() - start < timeout:
            st = self.chat_state()
            if st == "idle":
                return True
            if st == "generating":
                self.stop_generating()          # 主动 abort，不等它自己跑完 → 释放 activeConversationId 锁
            elif st == "waiting_input":
                self.dismiss_pending_question()
            elif st == "service_error":
                self.page.goto(CHAT_URL, wait_until="domcontentloaded")
                self.page.wait_for_timeout(5000)
                self.goto_tab("AI 助手")
            time.sleep(2)
        return self.chat_state() == "idle"

    def _expand_all_tools(self) -> None:
        """展开当轮**所有**工具面板（非 data-old），让面板内的分步叙述/工具行进入可见文本，
        供 _main_panel_text 一并抓走。只展开（aria-expanded false→click），不碰已展开的。"""
        self._eval(r"""()=>{for(const b of document.querySelectorAll('button[aria-expanded]')){if(/個工具|个工具/.test(b.textContent||'') && !b.hasAttribute('data-old') && b.getAttribute('aria-expanded')==='false') b.click();}}""")
        self.page.wait_for_timeout(1200)

    def _main_panel_text(self) -> str:
        """抓**主对话区**（排除左侧历史栏）的完整 innerText —— 含 Agent 全部推理叙述 + 最终回复。
        new_conversation 后主区只有本轮，故这就是整轮完整输出（不再只抓 body 尾巴/截断）。"""
        return self._eval(r"""()=>{
            const cand=[...document.querySelectorAll('div')].filter(e=>{
                const r=e.getBoundingClientRect();
                return r.width>500 && r.left>250 && r.height>200;
            });
            // 取 innerText 最长的那个容器 = 主对话流
            let best='', blen=0;
            for(const e of cand){ const t=e.innerText||''; if(t.length>blen){blen=t.length; best=t;} }
            return best;
        }""") or ""

    # ── 页面导航 ──
    def goto_chat(self) -> None:
        if "/chat" not in self.page.url:
            self.page.goto(CHAT_URL, wait_until="domcontentloaded")
            self.page.wait_for_timeout(3000)

    def goto_tab(self, name: str) -> None:
        """点侧栏 tab（AI 助手 / 技能 / 瀏覽器 / 工作空間 等）。DOM click 绕 tooltip 遮挡。"""
        self._eval(r"""(name)=>{
            const tip=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()===name && /group-hover|opacity-0|tooltip/.test(e.className||''));
            let g=tip?(tip.closest('.group')||tip.parentElement?.parentElement||tip.parentElement):null;
            const btn=g?(g.querySelector('a[href],button,[role=button]')||g.querySelector('svg')?.closest('a,button,div')):null;
            if(btn){btn.click();return;}
            const alt=[...document.querySelectorAll('a,button,[role=button]')].find(e=>e.textContent.trim()===name && e.getBoundingClientRect().width>0);
            if(alt)alt.click();
        }""", name)
        self.page.wait_for_timeout(2000)

    def concurrency_status(self) -> dict | None:
        """读 gateway 的并发名额 `GET /api/sessions/concurrency` → {active, limit}。
        并行跑测**定标并行度**用：limit 是按 plan 的会话数上限（free 1 / starter 2 / pro 4 /
        enterprise 20 / custom 不限）；`limit=None` = 不执法（无权益/billing 不可达），
        **不等于无限**，此时别贪，按保守值走。借页面自己的 token 发请求，不额外要凭据。
        读不到返回 None（网络/未登录/端点变更），调用方按「未知」处理、别当 0。"""
        return self._eval(r"""async ()=>{
            try{
                const t=localStorage.getItem('unified_access_token'); if(!t) return null;
                const base=[...new Set(performance.getEntriesByType('resource')
                    .map(e=>{try{return new URL(e.name).origin}catch(_){return ''}}))]
                    .find(o=>/(^|\/\/)(gw|gateway)\./.test(o));
                if(!base) return null;
                const r=await fetch(base+'/api/sessions/concurrency',{headers:{Authorization:'Bearer '+t}});
                if(!r.ok) return null;
                const j=await r.json();
                return (typeof j.active==='number') ? {active:j.active, limit:j.limit} : null;
            }catch(_){ return null; }
        }""")

    def preflight(self, timeout: int = 150) -> dict:
        """测试前置预检（每轮必做）：确认桌面客户端连着**正确账号**、能列出可操作的紫鸟店。

        判据取 `browser-cli ziniao doctor` 的权威输出，不解析自由文本（见 _PREFLIGHT_PROMPT 的注释）。
        返回 {ok(三态), stores, shop_count, reply, scan_chars}。"""
        self.goto_tab("AI 助手")
        self.new_conversation()
        r = self.send_and_wait(_PREFLIGHT_PROMPT, timeout)
        txt = r["text"]
        res = parse_preflight(txt)
        if res["ok"] is None:                      # 没抓到 → 再抓一次页面文本（不重发消息）
            self.page.wait_for_timeout(3000)
            txt2 = self._main_panel_text() or ""
            if len(txt2) > len(txt):
                txt = txt2
                res = parse_preflight(txt)
        res.update({"reply": txt[:600], "scan_chars": len(txt)})
        return res

    def new_conversation(self) -> bool:
        """开新对话，隔离每个测试用例。开新对话是**图标按钮**（文本空、靠 aria-label「新建對話」），
        不能用文本匹配。找不到则留在当前对话，返回 False。
        ⚠️ **同一个 tab（=同一个 gateway session）里**同一时间只能一个对话在跑 —— 上一个还在生成时
        开新对话会失败/串数据，先 ensure_idle。想真并行请开多个 tab（attach(own_tab=True)），
        不是在这一个 tab 里连开对话。"""
        self.ensure_idle()
        click_new = r"""()=>{
            const el=[...document.querySelectorAll('button,a,[role=button]')].find(e=>{
                const t=(e.textContent||'').trim();
                const al=(e.getAttribute('aria-label')||e.getAttribute('title')||'');
                return /新建對話|新建对话|新對話|新对话|開始新對話|开始新对话|新會話|新会话/.test(t+al) && e.getBoundingClientRect().width>0;
            });
            if(!el) return false; el.click(); return true;
        }"""
        ok = self._eval(click_new)
        if not ok:
            # 「新建對話」按钮找不到 ≠ 按钮没了——技能市场等视图与聊天页**共用 /chat URL**，
            # goto_chat() 会 no-op 停在别的视图（按钮 width=0）。切回「AI 助手」tab 再试一次。
            self.goto_tab("AI 助手")
            self.ensure_idle()
            ok = self._eval(click_new)
        if ok:
            self.page.wait_for_timeout(1500)
        # 校验真空白：新对话既不该残留「已完成 N 個工具」面板，**也不该残留 AskUserQuestion 问答卡**。
        # ⚠️ 漏了问答卡这条，就是 gmvmax 用例抓到上一条 promotions 残留问答卡（「建一场秒杀活动…」待输入）
        #    的根因——工具面板碰巧空了就被当「真空白」放行，旧问答卡却还盖在页上。两样都空才算真新建成功。
        #    （鸭嘴兽 chat 页只有这两类残留会串下一条；这里的“框”指 question-card，不是卖家后台的风控验证码。）
        fresh = self._eval(r"""()=>{
            const hasTool=[...document.querySelectorAll('button[aria-expanded]')].some(e=>/個工具|个工具/.test(e.textContent||''));
            const hasCard=[...document.querySelectorAll('[data-testid="question-card"]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
            return !hasTool && !hasCard;
        }""")
        if not fresh:
            self.page.goto(CHAT_URL, wait_until="domcontentloaded")
            self.page.wait_for_timeout(5000)
            self.goto_tab("AI 助手")
            self.ensure_idle()
            ok = self._eval(click_new)
            self.page.wait_for_timeout(1500)
        return bool(ok)

    # ── 发消息 + 等回复 ──
    # 🔴 `panel_found` 独立一格（#676）：**「面板不在」和「面板里 0 个工具」不许共用 `count: 0`。**
    #    `False` ⇒ 这一轮的**工具维度整个作废**（不 pass 不 fail —— 它没观测到任何东西，
    #    而 pass 和 fail 都是断言），**其余维度照常判**。
    _EMPTY_TRACE = {"tools": [], "count": 0, "names": [], "failures": 0, "failed_tools": [], "repeats": {},
                    "panel_found": False,
                    "script_failed": 0, "script_ok": 0,
                    "script_last": None, "script_scan_chars": 0, "risk_hits": 0,
                    "login_states": [], "session_limit_hits": 0,
                    "session_limit_mentions": 0}

    # ---- 店主把货盘交给我们的那一步（#1095）--------------------------------
    # 🔴 **这是店主真正走的那条路**：他在鸭嘴兽聊天界面里点那个「＋」挑一个文件。
    #    命令行那一路（`browser-cli recv-file`，optima-browser-use#382）是另一件事，
    #    **店主不会去跑它**。所以这条必须在网页这一层固化下来。
    #
    # 2026-09-19 真机实测（cn-prod www.yzsgo.com/zh-HK/chat）把这条路拆开了，四件事：
    #   ① 控件：`input[type=file]`，**全页唯一一个**（整页 input 的 type 直方图就是 `{'file': 1}`），
    #      `multiple` · `accept=""`（不限类型）· `class="hidden"` 且 `display:none`
    #      ⇒ **它是隐藏的，只能 `set_input_files`**；那个「＋」按钮
    #      （`button[aria-label="上傳檔案"]`）点下去开的是系统文件选择器，Playwright 管不着。
    #   ② 放进去之后前端**立刻**发 `POST https://gw.yzsgo.com/api/user/files`（multipart + Authorization），
    #      201 的响应体长这样：
    #        {"uploaded":[{"name":"probe_pool-1789824908371-1.xlsx",
    #                      "path":"/home/aiuser/attachments/probe_pool-1789824908371-1.xlsx",
    #                      "size":1742}]}
    #      🔴 **落点是服务端自己说的，不是我们拼的**；而且**文件名被改过**
    #      （`<原名>-<毫秒时间戳>-<序号><扩展名>`，客户端生成、序号不可预测）
    #      ⇒ **拿原文件名去 pod 上 `ls` 是找不到的。**
    #   ③ 🔴 **附件 chip 是纯客户端状态**：`set_input_files` 之后 UI 立刻长出一张附件卡片
    #      （`button[aria-label="移除附件"]` 那一块），**它在上传请求回来之前就已经在了**
    #      ⇒ **chip 只证明「浏览器收下了」，一个字都不说「对方收到了」。**
    #      ⚠️ `input.files` 同样不能用：React 组件读完就清空，**传成功之后它仍然是 `[]`**。
    #   ④ 🔴 **附件会累积，`new_conversation()` 不清**（实测：连传两次之后同一个 composer 上
    #      挂着两张 chip，中间还开过一次新对话）⇒ **下一次 `send()` 会把两份都带过去。**
    #      所以传之前一般要先 `clear_attachments()`。
    _UPLOAD_API = "/api/user/files"

    def _attachment_chips(self) -> list:
        """composer 上现在挂着的**每一张**附件卡片的文字（改名后的文件名 + 人读的大小）。
        🔴 **只做诊断**——它是客户端状态，不构成「对方收到了」（见 `upload_file` 第 2 对取值）。
        ⚠️ **返回整张列表，不返回第一张**：附件会累积，只取第一张会在第二次上传之后
        **原样报出上一次那个文件名** —— 「我刚传的那个」和「上一轮剩下的那个」共用一个输出。"""
        return self._eval(r"""()=>[...document.querySelectorAll('button[aria-label="移除附件"]')]
            .map(b=>(((b.parentElement||{}).innerText)||'').trim())""") or []

    def clear_attachments(self) -> int:
        """把 composer 上挂着的附件全部摘掉，返回摘掉几张。
        🔴 **传文件之前一般要先调它**：附件会累积而且跨对话存活，不摘的话下一条消息会**多带几份**。"""
        before = len(self._attachment_chips())
        for _ in range(before):
            n = self._eval(r"""()=>{const b=document.querySelector('button[aria-label="移除附件"]');
                                    if(!b) return 0; b.click(); return 1;}""")
            if not n:
                break
            self.page.wait_for_timeout(300)
        return before - len(self._attachment_chips())

    def upload_file(self, local_path: str, *, timeout: int = 120, clear_first: bool = True) -> dict:
        """把**本机一个文件**送进当前对话的输入框（店主点「＋」的那一步）。

        **只做这一件事**：放一个文件进去。不发消息、不管多文件、不断点续传、不同步目录。
        放完之后照常 `send()` / `send_and_wait()`，附件跟着那条消息一起过去。

        `clear_first=True`（默认）先把 composer 上残留的附件摘干净 —— 见上面第 ④ 条。

        ## 返回：`state` 一个取值扛一件事，**不许合并**

        | `state` | 它说的是 | 它**不**说的是 |
        |---|---|---|
        | `local_missing` | 本机这个路径上没有文件 | — |
        | `no_control` | **界面上没有上传控件**（`input[type=file]` 一个都没有） | — |
        | `control_dead` | **控件在，但推不动**：`set_input_files` 抛了，而且 chip 也没出现 | — |
        | `rejected` | **送失败**：上传请求回来了，但不是 2xx（`status` / `error` 里有原话） | — |
        | `no_receipt` | 🔴 **送出去了，但没拿到回执**（chip 上屏了，等不到那个 POST 的响应，或响应体里没有落点）⇒ **`unknown`** | 🔴 不说它没到 |
        | `size_mismatch` | 落地了，但**服务端报的字节数和本机对不上** | — |
        | `landed_not_attached` | 🔴 **字节落地了，但 composer 上没有它那张 chip** ⇒ 文件在 pod 上，**而下一条消息不会带上它** | — |
        | `landed` | **对方收到了**，落在 `remote_path`，`remote_size` 字节，且 chip 在 | 🔴 **一个字都不说对方读不读得懂它** |

        🔴 **点名要分开的三对取值，逐对说明**（#1095）：

        1. **`no_control`（找不到） vs `control_dead`（找到了但点不动）**
           前者是「这条路在这个界面上不存在」，**要去找人**；后者是「路在、车没动」，**要去查为什么**。
           合成一个 `False`，两种会共用同一个输出，而它们指向完全相反的下一步。

        2. **`no_receipt`（文件送出去了） vs `landed`（对方收到了）**
           chip 上屏、`input.files` 被清空、请求已发出，**全都只证明前者**。
           🔴 **后者只有服务端那句 2xx + 它自己给的 `path` 才算数。**
           等不到回执 ⇒ `no_receipt`，**这是 `unknown`，不许当成成功、也不许当成失败**。
           ⚠️ 还有第三态 `landed_not_attached`：**字节到了，但这条消息带不上它** ——
           「文件在对面」和「Agent 这一轮看得见它」是两件事。

        3. **`landed`（送到了） vs 「送到了但对方说它读不了」**
           🔴 **后者本方法答不了，也不许假装答得了。** `landed` 只说「这些字节落在了那个路径上」。
           「它读不读得出来」要等把消息发出去、让 Agent 去读那份文件之后才知道
           （`reading-pool-from-upload` 的 `read_pool.py inspect <path>`）。**两件事隔着一次 send。**

        ## 🔴 「它落在哪」

        `landed` / `landed_not_attached` / `size_mismatch` 时 `remote_path` 就是答案，
        **取自服务端自己的响应体，不是我们拼的**。
        ⚠️ **文件名会被改**（`<原名>-<毫秒时间戳>-<序号><扩展名>`，序号不可预测）
        ⇒ 拿原文件名去 pod 上找是找不到的，**要把 `remote_path` 原样交给下游**。

        ## `remote_size` 只到长度这一级

        `remote_size` 是服务端报的字节数，和本机 `os.path.getsize` 对不上就 `size_mismatch`。
        ⚠️ **字节数相同不等于内容相同** —— 真要逐字节，得在对面把文件读回来算 sha256。
        **别把本方法说成「逐字节比对过了」。**
        """
        out = {"state": None, "local_path": local_path, "local_size": None,
               "remote_path": None, "remote_size": None,
               "chips_before": None, "chips_after": None, "chip": None,
               "status": None, "error": None}

        if not os.path.isfile(local_path):
            out["state"] = "local_missing"
            out["error"] = f"本机没有这个文件：{local_path}"
            return out
        out["local_size"] = os.path.getsize(local_path)

        # ① 控件在不在 —— 这一问必须在碰它之前答完，否则「没有控件」会被下面的异常吞成 control_dead
        n = self._eval(r"""()=>document.querySelectorAll('input[type="file"]').length""")
        if not n:
            out["state"] = "no_control"
            out["error"] = ("这个页面上没有 input[type=file]。"
                            "⚠️ 先确认 driver 停在对话页（chat）上。")
            return out

        if clear_first:
            self.clear_attachments()
        out["chips_before"] = self._attachment_chips()

        def _is_upload_resp(r):
            return self._UPLOAD_API in r.url and r.request.method == "POST"

        # ② 推它 —— expect_response 必须**先架好再放文件**：上传请求是 set_input_files 当场发的，
        #    架晚了就错过，而「我架晚了」和「它压根没发」输出一样。
        resp = None
        try:
            with self.page.expect_response(_is_upload_resp, timeout=timeout * 1000) as ev:
                self.page.locator('input[type="file"]').first.set_input_files(local_path)
            resp = ev.value
        except Exception as e:
            out["chips_after"] = self._attachment_chips()
            if len(out["chips_after"]) > len(out["chips_before"]):
                out["state"] = "no_receipt"   # 🔴 unknown：上屏了，回执没等到
                out["error"] = f"附件已上屏但 {timeout}s 内没等到 {self._UPLOAD_API} 的响应：{e}"
            else:
                out["state"] = "control_dead"
                out["error"] = f"控件在，但文件没进去（chip 也没多出来）：{e}"
            return out

        out["chips_after"] = self._attachment_chips()
        out["status"] = resp.status
        if resp.status < 200 or resp.status >= 300:
            body = ""
            try:
                body = resp.text()[:500]
            except Exception:
                pass
            out["state"] = "rejected"
            out["error"] = f"{self._UPLOAD_API} 回 {resp.status}：{body}"
            return out

        try:
            data = resp.json()
        except Exception as e:
            # 2xx 但拿不到落点 —— 不许当成 landed（`landed` 的定义里含「落在哪」）
            out["state"] = "no_receipt"
            out["error"] = f"上传回了 {resp.status}，但响应体解析不了、拿不到落点：{e}"
            return out

        up = (data or {}).get("uploaded") or []
        if not up or not up[0].get("path"):
            out["state"] = "no_receipt"
            out["error"] = (f"上传回了 {resp.status}，但响应体里没有 uploaded[0].path："
                            f"{str(data)[:300]}")
            return out

        out["remote_path"] = up[0]["path"]
        out["remote_size"] = up[0].get("size")
        base = os.path.basename(out["remote_path"])
        out["chip"] = next((c for c in out["chips_after"] if base in c), None)

        if out["remote_size"] is not None and out["remote_size"] != out["local_size"]:
            out["state"] = "size_mismatch"
            out["error"] = (f"服务端报 {out['remote_size']} 字节，本机是 {out['local_size']} 字节"
                            f"（{out['remote_path']}）")
            return out
        if out["chip"] is None:
            # 字节到了 pod，但 composer 不认它 ⇒ 这条消息带不上它。**和 landed 不是一回事。**
            out["state"] = "landed_not_attached"
            out["error"] = (f"字节已落在 {out['remote_path']}，但 composer 上没有它那张 chip"
                            f"（现有 chip：{out['chips_after']}）⇒ 下一条消息不会带上它。")
            return out
        out["state"] = "landed"
        return out

    def send(self, msg: str, *, ziniao=_INHERIT) -> bool:
        """发消息，并**验证真的发出去了**（状态离开 idle → generating/waiting，或输入框清空+消息上屏）。
        发不出去（仍 idle 且没上屏）返回 False —— 不再「填了字就以为发出去了」。
        ⚠️ **发之前强制 ensure_idle**：本 tab 的对话都是本 driver 发起的，上一个 turn 没结束就发下一个 =
        往忙着的对话里塞消息 → concurrent/傳送中卡死。从代码上根绝——绝不往非 idle 的对话发。

        ## `ziniao=` —— **这一条消息**要动哪个 profile（#666）

        🔴 **`-3` 给的判据**：**「需要备份还原，就说明那个值待在了不属于它的地方。」**

        改之前：`run_case` 把本用例的 key **挂到 driver 上**，`send()` 去 `self._ziniao_key` 取，
        用完**还原**。⇒ **那个事实有两个家**，两家之间靠手工同步连着，**每次同步都是一条新缝**：
        一天之内那道闸误伤三次，**三次是同一个层级错位的三个出口**。

        改之后：**谁决定谁传，读的人不去别处取。**

        | 传什么 | 意思 |
        |---|---|
        | `ziniao="ziniao-<id>"` / `"<id>"` | **这一条**消息动的是这个 profile |
        | `ziniao=None` | **这一条**消息明确不碰任何 profile |
        | **不传** | 用 `attach()` 时那个声明当**默认值** |

        ⚠️ **「不传」和 `None` 不共用取值**：`None` 是一个**声明**，不传是**沿用默认**。
        这就是为什么默认值是 `_INHERIT` 这个哨兵，而**不是 `None`**
        （`None` 当默认 ⇒ 「忘了传」会被读成「我明确不碰」——**最危险的那种默认**）。
        """
        # 🔴 第三道闸（#611，`-4` review 提的）：**声明与事实对账**。
        #    前两道挡的是「忘了传」；这一道挡的是「**传了一个假的**」——
        #    而那正是三次真实越锁里两次的形态。**排在最前面：发出去就收不回来了。**
        key = getattr(self, "_ziniao_key", None) if ziniao is _INHERIT else ziniao
        check_declaration(key, msg)
        if not self.ensure_idle(180):
            self._last_send_fail = "concurrent"   # 上一个 turn 迟迟不结束 → 别硬发
            return False
        # 隔离：旧工具面板打 data-old，本轮 tool_trace/must_call 只抓未标记的（新增的）
        self._eval(r"""()=>{for(const e of document.querySelectorAll('button[aria-expanded]')){if(/個工具|个工具/.test(e.textContent||''))e.setAttribute('data-old','1');}}""")
        self._eval(r"""(m)=>{
            const ta=document.querySelector('textarea');
            const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
            ta.focus(); set.call(ta,m); ta.dispatchEvent(new Event('input',{bubbles:true}));
        }""", msg)
        self.page.wait_for_timeout(400)
        self._console_errs.clear()   # 只看本次发送后新产生的 console 报错
        self.page.locator("textarea").first.press("Enter")
        self._last_send_fail = None
        # 验证发送：轮询状态离开 idle（开始生成/进入问答），或输入框清空且消息已上屏
        for _ in range(16):   # ~24s
            self.page.wait_for_timeout(1500)
            st = self.chat_state()
            if st in ("generating", "waiting_input"):
                return True
            if st == "service_error":
                self._last_send_fail = "service_error"
                return False
            # 消息被拒的**五种**根因，UI 都不进生成但含义天差地别，必须区分（否则 judge 报错方向全反）：
            #   ① 'concurrency_limit'：会话数撞 plan 上限（ConcurrencyLimitNotice，testid
            #      concurrency-limit-notice）。并行跑测的头号 blocked —— 降并行度或升 plan，
            #      跟积分/额度都无关。plan 分档：free 1 / starter 2 / pro 4 / enterprise 20。
            #   ② 'busy_elsewhere'：**这个对话**正被别的 session（另一个 tab）处理
            #      （ConversationBusyNotice，testid conversation-busy-notice；文案「傳送失敗（另一會話處理中）」）。
            #      🔴 它的文案里**也含「傳送失敗」**——必须排在 ④ 前面判，否则会被误报成积分不足。
            #   ③ 'concurrent'：**同一个 session 内**前一个对话还没跑完（另一對話正在處理/會話正忙）。
            #      注意 ② 和 ③ 不是一回事：② 跨 session，③ 同 session。
            #   ④ 「傳送失敗/传送失败」：通用发送被拒，真实根因看 console（toast 本身分不出）：
            #        [Chat Error] weekly_limit（本周额度用完）→ 'weekly_limit'（要升级 plan/等重置，充积分没用！）
            #        否则按积分耗尽（余额不足发不出）→ 'credits'
            # 收集 text='' 的失败也能被 judge 分流（降并行 vs 换 tab vs 等锁 vs 升级 plan vs 充值）。
            # ①② 用前端**稳定 testid**认（agentic-chat ConcurrencyLimitNotice.tsx:46 /
            # ConversationBusyNotice.tsx:32），比文案可靠；③④ 才退回短文本匹配。
            rej = self._eval(r"""()=>{
                const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
                const seen=id=>[...document.querySelectorAll('[data-testid="'+id+'"]')].some(vis);
                if(seen('concurrency-limit-notice')) return 'concurrency_limit';
                if(seen('conversation-busy-notice')) return 'busy_elsewhere';
                const hit=[...document.querySelectorAll('*')].find(e=>{const t=(e.textContent||'').trim();
                    return t.length<30 && /另一對話正在處理|另一对话正在处理|會話正忙|会话正忙|請稍後重試|请稍后重试|傳送失敗|传送失败/.test(t) && vis(e);});
                if(!hit) return '';
                const t=(hit.textContent||'').trim();
                // 「傳送失敗（另一會話處理中）」= 跨 session 忙，别当积分不足
                if(/另一會話處理中|另一会话处理中|另一個分頁|另一个标签页/.test(t)) return 'busy_elsewhere';
                return /傳送失敗|传送失败/.test(t) ? 'credits' : 'concurrent';
            }""")
            if rej == "credits" and any(("weekly_limit" in e or "本周额度" in e or "本週額度" in e)
                                        for e in self._console_errs):
                rej = "weekly_limit"   # console 坐实：不是积分，是本周额度墙（升级 plan/等重置）
            if rej:
                # concurrency_limit / busy_elsewhere / weekly_limit / credits / concurrent
                self._last_send_fail = rej
                return False
            # 「傳送中」= 消息在途（还没被后端接受进生成），继续等，别当已发
            if self._eval(r"""()=>{const b=document.body.innerText||'';return b.includes('傳送中')||b.includes('传送中');}"""):
                continue
            # 极快回复：输入框清空 + 消息上屏 + 无「傳送中」
            cleared = self._eval(r"""()=>{const ta=document.querySelector('textarea');return !!(ta && !(ta.value||'').trim());}""")
            if cleared and self._eval(r"""(m)=>((document.body.innerText||'').includes(m.slice(0,24)))""", msg):
                return True
        self._last_send_fail = "send_failed"
        return False

    def wait_reply(self, timeout: int = 180, answers=None) -> dict:
        """**状态驱动**等回复：随时感知 生成中/待输入/报错/空闲，不靠猜。
        - service_error → 立刻收尾返回（blocked，非 skill 缺陷）；
        - waiting_input → 有预设答案就回答再继续，没有就停在此（待人工/答案）；
        - generating → 继续等；idle + 文本连续稳定 → done。
        answers=[{match,answer}]（见 _pick_answer）。返回含 state: done/timeout/service_error/waiting_input。"""
        start = time.time()
        blen = len(self._eval("()=>document.body.innerText||''"))
        prev = ""
        stable = 0
        tail = ""
        end_state = "timeout"
        question_seen = None
        while time.time() - start < timeout:
            time.sleep(3)
            st = self.chat_state()
            if st == "service_error":
                end_state = "service_error"
                break
            if st == "waiting_input":
                q = self.read_question()
                question_seen = dict(getattr(self, "last_question", None) or {"source": "none", "n_cards": 0, "text": ""})
                if not q:
                    # #1635：卡片文本读不到（虚拟列表把它卸了 / 结构变了）⇒ 至少拿页面尾部去匹配，别让预设答案永不触发；
                    #    同时把 source 记成 body_tail —— 「读不到」和「没问」不许长得一样
                    q = (self._eval("()=>document.body.innerText||''") or "")[-1500:]
                    question_seen = {"source": "body_tail" if q else "none", "n_cards": question_seen.get("n_cards", 0), "text": q[-1200:]}
                ans = self._pick_answer(q, answers)
                question_seen["matched"] = ans          # 预设答案里匹配到了哪条（None = 没匹配到）
                question_seen["answered"] = None        # 只有 answer_question 真的提交了才记 —— 「匹配到但没答上」≠「答了」
                if ans is not None and self.answer_question(ans):
                    question_seen["answered"] = ans
                    stable = 0
                    prev = ""       # 回答后 Agent 继续，重置稳定判定
                    continue
                end_state = "waiting_input"   # 没预设答案 → 停在此，交人工/补答案
                break
            body = self._eval("()=>document.body.innerText||''")
            tail = body[blen:] if len(body) > blen else body[-1500:]
            if st == "generating":
                stable = 0
                prev = tail
                continue
            # idle：文本稳定确认完成（连续 2 次 ~6s 不变）
            if tail == prev:
                stable += 1
                if stable >= 2:
                    end_state = "done"
                    break
            else:
                stable = 0
                prev = tail
        # 收尾：展开当轮所有工具面板，再抓**完整主面板**（推理叙述+工具行+回复），全量不截断。
        self._expand_all_tools()
        full = self._main_panel_text().strip()
        return {
            "text": full or tail.strip(),
            "transcript": full,
            "tail": tail.strip(),
            "elapsed": round(time.time() - start, 1),
            "timed_out": end_state == "timeout",
            "state": end_state,
            "question": question_seen,          # #1635：停在 waiting_input 时这里是卡片原文 + 来源，None = 这一轮没问过
            "tool_trace": self._scrape_tool_trace(),
        }

    def send_and_wait(self, msg: str, timeout: int = 180, answers=None, *, ziniao=_INHERIT) -> dict:
        # ⚠️ **原样透传**，不在这儿做任何判断 —— 多一层解释就多一个家（#666）。
        if not self.send(msg, ziniao=ziniao):
            # 消息没真发出去（对话忙/并发锁未释放/积分耗尽/报错）—— 别再 wait 一堆残留内容。
            # state 区分 credits（积分不足）/ concurrent（前一 turn 未释放）/ service_error / send_failed，judge 据此报清楚。
            return {"text": "", "transcript": "", "tail": "", "elapsed": 0,
                    "timed_out": False, "state": getattr(self, "_last_send_fail", None) or "send_failed",
                    "question": None, "tool_trace": dict(self._EMPTY_TRACE)}
        return self.wait_reply(timeout, answers)

    def stop_generating(self) -> None:
        """点停止按钮停掉 Agent 并**确认真停了**（turn abort → 释放 activeConversationId 锁）。
        ⚠️ 停止键是 `data-testid="stop-button"`（图标、**无文本**）——旧版用文本匹配「停止」永远点不到，
        turn 没 abort、锁没释放 → 下一个用例撞 concurrent（测试环境全是本 driver 发起，本不该有并发）。
        点 testid + 轮询确认 chat_state 离开 generating；停不掉最多点 6 次。"""
        for _ in range(6):
            if self.chat_state() != "generating":
                return
            self._eval(r"""()=>{
                const el=[...document.querySelectorAll('[data-testid="stop-button"]')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
                if(el){ (el.closest('button')||el).click(); }
            }""")
            self.page.wait_for_timeout(2500)

    def _scrape_tool_trace(self) -> dict:
        """抓 Agent tool call **完整轨迹**——展开所有「已完成 N 個工具」面板，返回每个 tool 的 {name,status}。
        用来看『调了哪些工具 / 成没成功 / 有没有反复』：光看回复文本会漏掉「工具反复重试最后才成功」这类隐患。
        网页结构（实测）：每次 Agent 回复带一个可展开 button「已完成 N 個工具」，展开后每个 tool 一行
        = <name> <status> [參數][結果]（name 如 bash/write/read；status 已完成/失敗/進行中）。"""
        # 只看**最后一条回复**的工具面板（当前测试用例；用例间应 new_conversation 隔离）
        # 🔴 **先回答「面板在不在」，再回答「里面有几个工具」**（#676）。
        #    原来 `if(!last) return []` —— **「页面上找不到那个聚合面板」和「面板里一行工具都没有」
        #    回的是同一个值**，于是都变成 `count: 0`。**而「工具 0 次」正是「编了一个答案」的签名。**
        #    2026-09-13 量过：299 份 per-case 日志里 26 份是「跑了但报 0」，**而这两种分不开。**
        self._panel_found = bool(self._eval(r"""()=>{const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));return bs.length>0;}"""))
        self._eval(r"""()=>{const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));const last=bs[bs.length-1];if(last&&last.getAttribute('aria-expanded')==='false')last.click();}""")
        self.page.wait_for_timeout(800)
        tools = self._eval(r"""()=>{
            const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
            const last=bs[bs.length-1]; if(!last) return [];
            const panel=last.parentElement;   // 限定到当轮面板
            // ⚠️ **这道筛选把短名工具每行数了两遍**（#2104，2026-09-19 核实：447 份日志里
            //    441 份符合「`名字长度+7 < 12` ⇒ 数两遍，否则一遍」这条公式）。
            //    **本次（#2091）一个字没改它** —— 改它会动到所有历史日志的工具计数，单独一笔做。
            const ops=[...panel.querySelectorAll('div')].filter(e=>e.querySelectorAll('button').length===2 && /參數|参数/.test(e.textContent) && /結果|结果/.test(e.textContent) && e.textContent.trim().length<12);
            const out=[];
            for(const op of ops){
                const t=(op.parentElement?.innerText||'').replace(/\n/g,' ').trim();
                if((t.match(/參數|参数/g)||[]).length!==1) continue;  // 跳过嵌套整面板行
                const m=t.match(/^(\S+)\s+(已完成|失敗|失败|進行中|进行中|錯誤|错误|error|失敗了)/i);
                if(m) out.push({name:m[1], status:m[2]});
            }
            return out;
        }""") or []
        # 🔴 **新形态的 `load_skill` 不在这个面板里**（#2091）：09-19 改版后它渲染成
        #    `使用技能：<slug>` + `已完成` 两行纯文本，排在聚合头之前、**没有兩個按钮、
        #    也没有「參數/結果」两个词** ⇒ 上面那个 `ops` 筛选把整行滤掉了，
        #    于是 09-19 起所有轨迹里**一个 `load_skill` 都没有**（实证：09-19 三轮全是纯 `bash`）。
        #    ⇒ 单独扫整页文本补回来。**只补新形态**：旧形态本来就在 `ops` 里读到了，
        #    再补一次会把同一次加载数成两遍。
        # ⚠️ **作用域说清楚**：`ops` 只读**最后一个**聚合面板（当轮），而新形态**不在面板里**
        #    ⇒ 这一段只能扫整页 = **整段对话**（每个用例都 `new_conversation` 隔离，
        #    但一个用例里若有多轮 AskUserQuestion 往返，早先那几轮的「使用技能」也会被算进来）。
        #    🔴 **这是个作用域不一致，如实写在这儿**：它只影响 `count` / `names` / `repeats`
        #    这三个**印出来给人看**的数，**不进任何判定**（`failures` 只数非「已完成」状态）。
        #    `must_call` 那一维本来就是整页口径（`loaded_skills` 的 `<pre>` 扫描从第一天就是全页），
        #    所以这一改**没有动它的语义**。工具计数本身另有一笔（#2104），到那时一起收口。
        page_text = self._eval(r"""()=>document.body.innerText||''""") or ""
        _marks = parse_skill_loads(page_text)
        if _marks["slugs"]:
            tools = [{"name": "load_skill", "status": "已完成", "skill": s_}
                     for s_ in _marks["slugs"]] + tools
        names = [t["name"] for t in tools]
        failures = [t for t in tools if t.get("status") not in ("已完成", "进行中", "進行中")]
        # 反复：同名工具出现次数（>1 提示可能有重试/多步）
        repeats = {n: names.count(n) for n in set(names) if names.count(n) > 1}

        # ── 任务级成败（#30 假 pass 根因）──
        # runscript/脚本类工具的 bash **退 0 也可能是任务失败**：stdout 里是 `✗ Script failed: ...`，
        # 但工具面板 status 仍显示「已完成」→ 上面的 status/failures 维度**漏判**（#052 就这么被判 pass）。
        # 展开当轮所有「結果」读 stdout，只数成败标记：
        #   ✗ Script failed  = 脚本任务失败；  ✓ Script <...> = 脚本完成（completed 及各 skill 名变体）。
        # ⚠️ 只在这里就地读、**只回整数计数、不回结果原文**——结果体里可能含 env 明文密钥/JWT（gw#2350），
        #    绝不落进 transcript/日志（transcript 已在本方法调用前抓定，此处展开不会回灌它）。
        script_failed = script_ok = script_check_failed = risk_hits = 0
        login_states = []
        session_limit_hits = 0
        session_limit_mentions = 0
        try:  # 结果体扫描出任何岔子都只降为 0，绝不让整个 tool_trace 崩掉（它喂所有用例判定）
            self._eval(r"""()=>{
                const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
                // 🔴 **面板不在就什么都不做** —— 原来回退到 `document`（整页），
                //    于是 `risk_hits`/`login_states`/`session_limit_hits` 会从**Agent 自己那段回复**里数出来。
                //    **「没读到」被变成了「读了别的东西」，而后者给出一个自信的错答案。**
                const last=bs[bs.length-1]; if(!last) return; const panel=last.parentElement;
                for(const b of panel.querySelectorAll('button')){ if(/^(結果|结果)$/.test((b.textContent||'').trim())) b.click(); }
            }""")
            self.page.wait_for_timeout(700)
            res_text = self._eval(r"""()=>{
                const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
                // 🔴 **面板不在 ⇒ 回空串，不回整页**（同上）。空串会让下面每个计数都是 0，
                //    而 `panel_found=False` 会把它们一起标成 `unknown` —— **0 不再冒充观测值**。
                const last=bs[bs.length-1]; return last? (last.parentElement.innerText||'') : '';
            }""") or ""
            # 🔴 `✓ Script` 会命中 **submit-script 的上传回执**（`✓ Script <name> created/updated`），
            #    那不是任务完成 —— 而浏览器类 skill 的标准流程第一步就是 submit-script，
            #    于是 script_ok 恒 >0，「failed>0 且 ok==0」这条降级条件**几乎永不成立**（#241）。
            #    任务完成的真实回执只有一种：`✓ Script completed`。
            # 脚本**自报的校验不过**：`✓ Script completed` 但结果里写着「校验=不过」或 ABORT。
            # #295 实证：add_to_discount 填完回读对不上（填 15%、读回别的商品的 30），
            # 结果字符串里明明白白写着「校验=不过」，而三维判定只看 ✓/✗ 和关键词 → 判了 pass。
            script_check_failed = res_text.count("校验=不过") + res_text.count("ABORT ")
            script_failed = res_text.count("✗ Script failed")
            script_ok = res_text.count("✓ Script completed")
            # 只数次数还不够：失败后重试成功要算成功，成功后重试失败要算失败 ——
            # 看的是**最后一次**的结局，不是谁多谁少。
            i_ok = res_text.rfind("✓ Script completed")
            i_bad = res_text.rfind("✗ Script failed")
            script_last = ("ok" if i_ok > i_bad else "failed") if (i_ok >= 0 or i_bad >= 0) else None
            # 抓取失效守卫（#26）：结果体一个字都没读到时，上面三个数全是「没发现问题」的样子，
            # 与「真的没问题」不可区分。把扫描长度带出去，让判定方自己决定信不信。
            script_scan_chars = len(res_text)
            # 平台侧风控证据（#331）：只认脚本失败回执里自己说撞了风控的那种，只回计数。
            risk_hits = count_platform_risk_receipts(res_text)
            login_states += scrape_login_states(res_text)
            session_limit_hits += count_session_limit_receipts(res_text)
            session_limit_mentions += count_session_limit_mentions(res_text)
        except Exception:  # noqa: BLE001
            pass
        skill_src = self._scrape_skill_source_edits()
        return {
            "tools": tools,           # [{name,status}] 完整顺序
            "count": len(tools),
            "names": names,
            "failures": len(failures),
            "failed_tools": [t["name"] for t in failures],
            "repeats": repeats,       # {工具名: 次数}，看有没有反复
            # 🔴 **这一轮到底有没有那个面板**（#676）。`False` ⇒ 上面每个计数都是
            #    「没读到」，**不是「读到了 0」** —— 消费者要据此把工具维度作废。
            "panel_found": self._panel_found,
            "script_failed": script_failed,  # stdout 里 `✗ Script failed` 次数（任务级失败）
            "script_ok": script_ok,          # stdout 里 `✓ Script completed` 次数（**任务级**完成）
            "script_last": script_last,      # 最后一次脚本任务的结局："ok" / "failed" / None
            "script_scan_chars": script_scan_chars,  # 结果体扫到的字符数；0 = 没抓到，别信上面三个数
            "script_check_failed": script_check_failed,  # 脚本自报「校验=不过」/ABORT 的次数
            # 平台侧风控停手回执数（#331）。**0 不代表没撞风控**，只代表没拿到平台侧证据——
            # 判定方须按三态处理（run.py `classify_risk_control`），不许默认落到 blocked。
            "risk_hits": risk_hits,
            "login_states": login_states,
            # #671：**挨着失败回执**的计数（唯一允许判 hit 的取数）
            "session_limit_hits": session_limit_hits,
            # #671：**总出现数**（含文档/源码/复述）。🔴 不是证据，只许走 unknown。
            # 两者都留着，是为了让「收窄之后一次都不响」和「本来就没出现过」分得开。
            "session_limit_mentions": session_limit_mentions,
            # Agent 中途改了自己加载的 skill 源码（#277 实证）——这轮跑通的不是发布版
            "skill_src_edits": skill_src["count"],
            "skill_src_slugs": skill_src["slugs"],
        }

    _SKILL_SRC_RE = re.compile(r"\.claude/skills/([a-z0-9][a-z0-9-]*)/")
    _FILE_PATH_RE = re.compile(r'"file_path"\s*:\s*"([^"]+)"')

    def _scrape_skill_source_edits(self) -> dict:
        """当轮 Agent 有没有**改自己加载的 skill 源码**（`~/.claude/skills/<slug>/…`）。

        #277 实证：跨境店跑 managing-promotions，Agent 连撞三个本土专有假设，
        在 pod 里 `edit` 了 `/home/aiuser/.claude/skills/managing-promotions/script.py` 三次
        才把 dry-run 跑通 —— 工具零失败、脚本 `✓ Script completed`、关键词全中，
        三个维度**一个都没察觉**，直接判 pass。可 pod 是一次性的：下次会话拿到的还是发布版，
        照样跑不通。**这种轮次的「pass」是拿改过的代码跑出来的，必须降级人工核。**

        判据取 edit/write 类工具**參數里的 `file_path`**（不扫结果体、不扫全文）——
        Agent 经常写一次性诊断脚本、内容里引用 `~/.claude/skills/…`，扫全文会满屏误报。
        代价是：參數不暴露 `file_path` 的工具形态会漏检（宁漏勿误报，漏了还有 Wire 兜底）。
        只回**计数 + skill slug**，不回參數原文（同结果体：可能含 env 明文密钥/JWT，gw#2350）。
        """
        try:
            blobs = self._eval(r"""()=>{
                const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
                // 🔴 **同 #676**：面板不在就回空，**不回退到整页** ——
                //    否则 Agent 回复里任何带 `參數/結果` 字样的东西都会被当成工具行。
                const last=bs[bs.length-1]; if(!last) return []; const panel=last.parentElement;
                const ops=[...panel.querySelectorAll('div')].filter(e=>e.querySelectorAll('button').length===2 && /參數|参数/.test(e.textContent) && /結果|结果/.test(e.textContent) && e.textContent.trim().length<12);
                const out=[];
                for(const op of ops){
                    const row=op.parentElement;
                    const t=(row?.innerText||'').replace(/\n/g,' ').trim();
                    if((t.match(/參數|参数/g)||[]).length!==1) continue;
                    const m=t.match(/^(\S+)\s+/);
                    if(!m||!/^(edit|write|multi_edit|multiedit|notebook_edit|str_replace_editor)$/i.test(m[1])) continue;
                    for(const b of op.querySelectorAll('button')){ if(/^(參數|参数)$/.test((b.textContent||'').trim())) b.click(); }
                    out.push((row?.parentElement?.innerText)||'');
                }
                return out;
            }""") or []
        except Exception:  # noqa: BLE001
            return {"count": 0, "slugs": []}
        self.page.wait_for_timeout(400)
        count, slugs = 0, set()
        for blob in blobs:
            for path in self._FILE_PATH_RE.findall(blob or ""):
                m = self._SKILL_SRC_RE.search(path)
                if m:
                    count += 1
                    slugs.add(m.group(1))
        return {"count": count, "slugs": sorted(slugs)}

    def read_tool_io(self, index: int) -> dict:
        """深挖第 index 个 tool 的參數/結果内容（点开对应「參數」「結果」button 读文本）。判定存疑时用。"""
        return self._eval(r"""(idx)=>{
            const ops=[...document.querySelectorAll('div')].filter(e=>e.querySelectorAll('button').length===2 && /參數|参数/.test(e.textContent) && /結果|结果/.test(e.textContent) && e.textContent.trim().length<12);
            const clean=ops.filter(op=>((op.parentElement?.innerText||'').match(/參數|参数/g)||[]).length===1);
            const op=clean[idx]; if(!op) return {err:'no-tool'};
            const btns=[...op.querySelectorAll('button')];
            btns.forEach(b=>b.click());
            const box=op.parentElement?.parentElement;
            return {text:(box?.innerText||'').slice(0,1200)};
        }""", index)

    def loaded_skills(self) -> list[str]:
        """当轮 Agent 通过 `load_skill` 加载了哪些 skill —— 用于精确验证 must_call（「到底调没调对 skill」）。
        实测：load_skill 的參數展开是 `<pre>` JSON `{"name": "<slug>"}`。
        **结构无关**：不管有没有「N 個工具」聚合头——**单工具轮次**（只 load_skill、无 bash）不生成聚合头，
        load_skill 是个 `<span>` + 就近 `參數/結果` 按钮。直接找所有 `load_skill` 条目、点它的「參數」，读 pre。

        ⚠️ **两个都踩过的坑（2026-09-09 实测）**：

        1. **不能扫全页 `<pre>` 只匹配 `"name"`** —— Agent 最终回复里任何带 `name` 字段的 JSON 代码块
           （markdown ```json``` 渲染成 `<pre>`）都会被当成加载过的 skill，实测把 meta.json 的商品名
           `"Lampu Suluh LED Super Terang TJ-G089…"` 记成 skill ⇒ `verify_must_call` **假通过**。
        2. **「點開參數」是 toggle，不是 open** —— `wait_reply` 里的 `_expand_all_tools()` 已经把面板
           展开过了，这里再点一次就**把它关掉**，参数 `<pre>` 消失 ⇒ 返回 `[]` **假不通过**。
           （实测：点击前全页 3 个 `<pre>`，点击后 2 个。）

        修法：**靠形状判别，不靠容器/位置**。load_skill 的參數面板形状是固定的、**只有一个 key**：
        `{"name": "<slug>"}`；而误报源（listing.json / meta.json 代码块）必然还带别的 key。
        并且先读一遍再决定要不要点——已经展开就别去 toggle 它。"""
        # 只认「整段恰好是 {"name": "<slug>"}」的 pre —— 商品/档案 JSON 必然还有 product_id 等其它键，天然排除
        READ = r"""()=>{
            const out=[];
            for(const pre of document.querySelectorAll('pre')){
                const m=(pre.textContent||'').trim().match(/^\{\s*"name"\s*:\s*"([^"]+)"\s*\}$/);
                if(m) out.push(m[1]);
            }
            return [...new Set(out)];
        }"""
        # 🔴 **新形态（#2091）**：09-19 改版后 `load_skill` 渲染成两行纯文本
        #    `使用技能：<slug>` + `已完成`，**没有參數面板**、也**不在聚合面板里**。
        #    先把整页文本读一遍，两种形态一起判 —— `page` 里读到的 slug 和 `<pre>` 里读到的
        #    **合并**，不是二选一（一轮里两种形态可能同时出现：旧的工具行 + 新的技能行）。
        page_text = self._eval(r"""()=>document.body.innerText||''""") or ""
        marks = parse_skill_loads(page_text)
        n_calls = self._eval(r"""()=>[...document.querySelectorAll('span,div')]
            .filter(e=>(e.textContent||'').trim()==='load_skill' && e.getBoundingClientRect().width>0).length""") or 0
        got = self._eval(READ) or []

        def _finish(pre_slugs):
            """合并两条信号源，并**把「页面上一共有几个加载节点」留痕**（#2091）。

            🔴 `nodes == 0` 是「**我们一个加载节点都没读到**」—— 它和
               「读到了节点、但期望那个不在 slugs 里」**必须分开**，否则一次抓取失败
               长得跟一次真的没调一模一样（这条 issue 本身）。
            合并口径走 `build_must_call` —— **只有一份**，测试用历史日志重判走的是同一份。
            """
            probe = build_must_call(None, pre_slugs, marks)
            probe["pre_slugs"] = list(pre_slugs)
            probe["text_slugs"] = list(marks["slugs"])
            probe["slugs"] = probe["loaded"]
            probe["nodes"] = probe["load_nodes"]
            probe["shapes"] = probe["load_shapes"]
            self._skill_load_probe = probe
            return probe["loaded"]

        if not n_calls or len(got) >= n_calls:
            return _finish(got)  # 面板已经是展开的（或本轮压根没调 load_skill）—— 别去 toggle 它
        # 还没展开：点一次「參數」再读
        CLICK = r"""()=>{
            const nodes=[...document.querySelectorAll('span,div')].filter(e=>(e.textContent||'').trim()==='load_skill' && e.getBoundingClientRect().width>0);
            for(const n of nodes){
                let box=n; for(let i=0;i<5 && box;i++){ box=box.parentElement;
                    if(!box) break;
                    const p=[...box.querySelectorAll('button')].find(b=>['參數','参数'].includes(b.textContent.trim()) && b.getBoundingClientRect().width>0);
                    if(p){ p.click(); break; }
                }
            }
        }"""
        for _ in range(2):      # 第 2 次是兜底：万一第 1 次点反了（把已开的关上），再点回来
            self._eval(CLICK)
            self.page.wait_for_timeout(900)
            got = self._eval(READ) or []
            if len(got) >= n_calls:
                break
        return _finish(got)

    def verify_must_call(self, expected) -> dict:
        """验证当轮是否加载了期望 skill。expected 可为单个 slug 或 slug 列表（**多选之一**——
        有些任务合理地会路由到几个 skill 之一，如「只读核价」→ verifying 或 listing 都算对）。
        返回 `{expected, loaded, ok, load_nodes, load_shapes}` —— 🔴 `load_nodes` 是 #2091 加的：
        **页面上一共读到几个加载节点**，判定方靠它分「它没调」和「我们没读到」。"""
        self.loaded_skills()          # 读两条信号源，结果落在 `_skill_load_probe`
        probe = getattr(self, "_skill_load_probe", None) or {}
        # 🔴 `load_nodes`（#2091）：**页面上一共读到几个「加载 skill」的节点**。
        #    `0` ⇒ 我们**什么都没读到**（面板改版 / 抓取坏了都长这样），判定方必须走
        #    「没读到」那一档，**不许判成「没加载」** —— 后者会把人指去改 registry / 改触发词，
        #    而真正坏的是抓取。`None` = 这份 `mc` 不是本 driver 产的（老数据），同样不许当 0。
        out = build_must_call(expected,
                              probe.get("pre_slugs") or [],
                              {"slugs": probe.get("text_slugs") or [],
                               "nodes": probe.get("nodes") or 0,
                               "shapes": probe.get("shapes") or []})
        return out

    # ── 技能市场 ──
    def open_market(self) -> None:
        self._eval(r"""()=>{
            const tip=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='技能' && /group-hover|opacity-0|tooltip/.test(e.className||''));
            let g = tip ? (tip.closest('.group')||tip.parentElement?.parentElement||tip.parentElement) : null;
            const btn = g ? (g.querySelector('a[href],button,[role=button]')||g.querySelector('svg')?.closest('a,button,div')) : null;
            if(btn){ btn.click(); return; }
            // 兜底：任意含「技能」的可点侧栏项
            const alt=[...document.querySelectorAll('a,button,[role=button]')].find(e=>/技能/.test(e.textContent||'') && e.getBoundingClientRect().width>0);
            if(alt) alt.click();
        }""")
        self.page.wait_for_timeout(2500)

    def _fill_search(self, slug: str) -> None:
        self._eval(r"""([ph,slug])=>{
            const inp=[...document.querySelectorAll('input')].find(e=>e.placeholder===ph);
            if(!inp) return;
            const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
            inp.focus(); set.call(inp,''); inp.dispatchEvent(new Event('input',{bubbles:true}));
            set.call(inp,slug); inp.dispatchEvent(new Event('input',{bubbles:true}));
        }""", [SEARCH_PH, slug])
        self.page.wait_for_timeout(2200)

    def card_status(self, slug: str) -> str:
        """搜到卡后读该 slug 卡的状态：已安裝 / 待安裝 / 安裝中 / notfound。
        ⚠️ UI 文案随账号 locale 简繁都可能出现（zh-HK「安裝」/ zh-CN「安装」），两种都要匹配。
        ⚠️ **必须遍历 slug 的全部出现位置，不能只取 indexOf 的首次命中**——skill 描述里会互相引用
        （`developing-video-creative` 的描述写着「交给 producing-hq-ugc-video 生产」，
        `generating-listing-video` 的描述写着「发布交 publishing-shoppable-video」），
        首次命中往往落在**别人卡片的描述文字**上，其后 60 字内没有状态词 → 误报 '?' → 上层记「失败」，
        明明装着却被判没装（2026-09-09 实测踩中）。真卡片的 slug 后面紧跟「免費/包含 N 個技能/已安裝」。"""
        return self._eval(r"""(slug)=>{
            const body=document.body.innerText||'';
            if(body.indexOf(slug)<0) return 'notfound';
            let seen=false;
            for(let i=body.indexOf(slug); i>=0; i=body.indexOf(slug, i+1)){
                seen=true;
                const seg=body.slice(i, i+60);
                if(/已安[裝装]/.test(seg)) return '已安裝';
                if(/安[裝装]中/.test(seg)) return '安裝中';
                if(/安[裝装]/.test(seg)) return '待安裝';
            }
            return seen?'?':'notfound';
        }""", slug)

    def search_skill(self, slug: str) -> str:
        self._fill_search(slug)
        return self.card_status(slug)

    def install_skill(self, slug: str) -> bool:
        """确保在市场；搜 slug；若待装则点安裝并验证已安裝。返回是否已安裝。"""
        if not self._eval(f"()=>!!document.querySelector('input[placeholder=\"{SEARCH_PH}\"]')"):
            self.open_market()
        st = self.search_skill(slug)
        if st == '已安裝':
            return True
        if st == 'notfound':
            return False
        self._eval(r"""()=>{const btn=[...document.querySelectorAll('button')].find(e=>/^安[裝装]$/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0 && !e.closest('nav'));if(btn)btn.click();}""")
        self.page.wait_for_timeout(2500)
        # 可能的确认弹窗（pilot 实测无，但兜底）
        self._eval(r"""()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(e=>/確認|确认|確定|确定|立即安/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0);if(b)b.click();}""")
        self.page.wait_for_timeout(1500)
        return self.search_skill(slug) == '已安裝'

    def ensure_installed(self, slugs: list[str]) -> dict:
        """批量确保已装。返回 {slug: '已安裝'|'新装'|'notfound'|'失败'}。"""
        if not self._eval(f"()=>!!document.querySelector('input[placeholder=\"{SEARCH_PH}\"]')"):
            self.open_market()
        out = {}
        for s in slugs:
            st = self.search_skill(s)
            if st == '已安裝':
                out[s] = '已安裝'
            elif st == 'notfound':
                out[s] = 'notfound'
            else:
                out[s] = '新装' if self.install_skill(s) else '失败'
        # ⚠️ 新装的技能不会进当前会话页已加载的 load_skill 索引 —— Agent 找不到就退回
        # 通用 scout/tiktok 兜底(实测:未 reload 前 competitor-pricing 被 scout/tiktok 顶替、
        # must_call ✗;reload 后一次 load_skill 就调对、pass)。装了新的就刷新页面重载索引。
        if any(v == '新装' for v in out.values()):
            self.page.reload(wait_until='domcontentloaded')
            self.page.wait_for_timeout(6000)
            self.goto_tab("AI 助手")
        return out


if __name__ == "__main__":
    # 冒烟：attach + 报告当前页 + 已装技能数
    import sys
    d = ChatDriver().attach(ziniao=None, reason="冒烟只看 URL 和已装技能数，不驱动任何店")
    print("URL:", d.page.url)
    print("在 chat 页:", "/chat" in d.page.url)
    if "--install" in sys.argv:
        i = sys.argv.index("--install")
        slugs = sys.argv[i + 1].split(",")
        print("ensure_installed:", d.ensure_installed(slugs))
    d.close()
