#!/usr/bin/env python3
"""yzsgo Agentic Chat 网页操作固化库 —— 所有对 www.yzsgo.com/zh-HK/chat 的动作的**唯一入口**。

任何人任何时候操作这个网页都走这里，不再现写 Playwright。封装了 pilot(2026-08-27)实测的三个坑：
  ① 侧栏图标文字是 hover tooltip、被 svg 遮挡 → 用 DOM `.click()`（不用坐标/Playwright click）；
  ② 搜索框/输入是 React 受控输入 → 用原生 value setter + dispatchEvent('input')；
  ③ 流式回复 → 轮询 body 文本尾部稳定判完成。

前置：用户已用带远程调试端口的 Chrome 登录好 Agentic Chat：
  open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/yzsgo-chrome https://www.yzsgo.com

用法：
  from chat_driver import ChatDriver
  d = ChatDriver().attach()                  # 串行：复用页面上已有的 chat tab
  d = ChatDriver().attach(own_tab=True)      # 并行：**自己开一个 tab**，独占一个 gateway session
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

import os
import time

from playwright.sync_api import sync_playwright

# cn-stage 前端是 app.stage.optima.chat（同一套页面），用 YZSGO_CHAT_URL 覆盖；缺省 cn-prod。
CHAT_URL = os.environ.get("YZSGO_CHAT_URL", "https://www.yzsgo.com/zh-HK/chat")
SEARCH_PH = "搜尋技能..."
# 本 tab 认领的 gateway sessionId 存这里（agentic-chat src/lib/session/tabSessionClaim.ts）。
# sessionStorage 天然 per-tab —— 这是「一 tab 一 session」的物理依据，也是并行隔离的校验口。
TAB_SID_KEY = "optima:gw:sid"


class TabSessionUnavailable(RuntimeError):
    """新开的 tab 没能拿到**独立**的 gateway session —— 并行不安全，调用方必须退回串行。

    两种触发（都实证过）：
      ① claim 超时：页面没在 timeout 内写 sessionStorage（没登录 / 连不上 gateway）；
      ② sid 与已有 tab 撞车：该环境 `NEXT_PUBLIC_MULTI_TAB_SESSION` 没开（build-time flag，
         默认关，见 agentic-chat src/lib/feature-flags.ts），新 tab 会被 gateway 的
         createOrResolveSession 并回同一个 session。cn-prod 已开、cn-stage 未验。
    绝不能降级成「那就共用一个 tab 吧」——那正是静默串台的成因。"""


class ChatDriver:
    def __init__(self, port: int = 9222):
        self.port = port
        self._pw = None
        self.browser = None
        self.page = None
        self.session_id = None    # 本 tab 认领的 gateway sessionId（wire 归因/并行隔离校验都靠它）
        self._own_tab = False     # 这个 tab 是我开的吗 —— close() 只关自己开的，绝不关用户的
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

    def attach(self, own_tab="auto", claim_timeout: int = 60) -> "ChatDriver":
        """连上调试端口 Chrome 并选定本 driver 要驱动的 tab。

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
        self.session_id = self._await_sid(claim_timeout if want_own else 10)
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

    def _close_own_tab(self) -> None:
        """只关本 driver 自己开的 tab（降级/收尾共用）。"""
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
                if self._pw:
                    self._pw.stop()

    def _eval(self, js: str, arg=None):
        return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)

    # ── 单对话隔离（**本 tab 内**同一时间只能有一个对话在进行；跨 tab 可并行，见模块 docstring）──
    def is_generating(self) -> bool:
        """当前是否有对话正在流式生成。派生自 chat_state（单一真相）。"""
        return self.chat_state() == "generating"

    def has_pending_question(self) -> bool:
        """Agent 是否停在「需要你的輸入」(AskUserQuestion 弹问)。派生自 chat_state。
        这个状态既非「生成中」也非「结束」，若不处理，下一个用例会串进这个卡住的对话。"""
        return self.chat_state() == "waiting_input"

    def dismiss_pending_question(self) -> bool:
        """关掉待输入问题框（点卡内 取消/關閉），让对话回到可开新对话的状态。返回是否点到。"""
        clicked = bool(self._eval(r"""()=>{
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
            if(!card) return false;
            const btn=[...card.querySelectorAll('button')].find(e=>/^(取消|關閉|关闭)$/.test((e.textContent||'').trim()) && vis(e) && !e.disabled);
            if(btn){btn.click(); return true;}
            return false;
        }"""))
        if clicked:
            self.page.wait_for_timeout(1200)
        return clicked

    def read_question(self) -> str:
        """读当前 AskUserQuestion 卡片全文（问题+选项标题+按钮）——供 _pick_answer 匹配。"""
        return self._eval(r"""()=>{
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
            return card ? (card.innerText||'').slice(0,1200) : '';
        }""") or ""

    def answer_question(self, text: str) -> bool:
        """给当前 AskUserQuestion **回答并提交** —— 真跟鸭嘴兽对话往下走（不是关掉）。
        两种题型（照 agentic-chat QuestionCard 结构）：
          ① 选项题：`text` 与某选项标题互含 → 点该选项行；否则点「其它」展开 textarea 填 text；
          ② 开放题（0 选项）：直接有 textarea → 填 text。
        再点「下一題」(非末题) 或「確認/補充回答」(末题) 提交。返回提交动作是否真的点了。"""
        acted = self._eval(r"""(t)=>{
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            const norm=s=>(s||'').replace(/\s+/g,'').toLowerCase();
            const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
            if(!card) return 'no-card';
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
            self._eval(r"""(t)=>{
                const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
                const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
                const ta=card && [...card.querySelectorAll('textarea')].find(vis);
                if(ta){const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
                    ta.focus(); set.call(ta,t); ta.dispatchEvent(new Event('input',{bubbles:true}));}
            }""", text)
            self.page.wait_for_timeout(500)
        # 提交：末题点 確認/補充回答，非末题点 下一題（都在卡内、非取消/關閉、未 disabled）
        submitted = bool(self._eval(r"""()=>{
            const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
            const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
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
            const card=[...document.querySelectorAll('[data-testid="question-card"]')].find(vis);
            if(card && [...card.querySelectorAll('button')].some(b=>/確認|确认|下一題|下一题|補充回答|补充回答/.test((b.textContent||'').trim()))) return 'waiting_input';
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
        桌面默认连的可能是别的账号 → 连店类 skill 会「桌面应用未连接」。返回 {ok, stores, reply}。"""
        self.goto_tab("AI 助手")
        self.new_conversation()
        r = self.send_and_wait("先别执行任何店铺操作。请确认桌面客户端连接是否正常，并列出现在能操作的 TikTok 紫鸟店铺（Profile ID + 店铺名）。", timeout)
        txt = r["text"]
        # 店名别写死后缀（旧账号店名带「货盘」，换账号就不带了）：ID 后面跟到行尾/分隔符的即店名
        stores = __import__("re").findall(r"(27\d{11,12})\s*[\t|:：、 ]*([^\n\t|]{2,40})", txt)
        ok = bool(stores)   # 能列出可操作店 = 桌面连着且账号对（Agent 回复可能顺带提「未连接」作说明，不据此判）
        return {"ok": ok, "stores": stores, "reply": txt[:600]}

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
    _EMPTY_TRACE = {"tools": [], "count": 0, "names": [], "failures": 0, "failed_tools": [], "repeats": {},
                    "script_failed": 0, "script_ok": 0}

    def send(self, msg: str) -> bool:
        """发消息，并**验证真的发出去了**（状态离开 idle → generating/waiting，或输入框清空+消息上屏）。
        发不出去（仍 idle 且没上屏）返回 False —— 不再「填了字就以为发出去了」。
        ⚠️ **发之前强制 ensure_idle**：本 tab 的对话都是本 driver 发起的，上一个 turn 没结束就发下一个 =
        往忙着的对话里塞消息 → concurrent/傳送中卡死。从代码上根绝——绝不往非 idle 的对话发。"""
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
        while time.time() - start < timeout:
            time.sleep(3)
            st = self.chat_state()
            if st == "service_error":
                end_state = "service_error"
                break
            if st == "waiting_input":
                q = self.read_question()
                ans = self._pick_answer(q, answers)
                if ans is not None and self.answer_question(ans):
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
            "tool_trace": self._scrape_tool_trace(),
        }

    def send_and_wait(self, msg: str, timeout: int = 180, answers=None) -> dict:
        if not self.send(msg):
            # 消息没真发出去（对话忙/并发锁未释放/积分耗尽/报错）—— 别再 wait 一堆残留内容。
            # state 区分 credits（积分不足）/ concurrent（前一 turn 未释放）/ service_error / send_failed，judge 据此报清楚。
            return {"text": "", "transcript": "", "tail": "", "elapsed": 0,
                    "timed_out": False, "state": getattr(self, "_last_send_fail", None) or "send_failed",
                    "tool_trace": dict(self._EMPTY_TRACE)}
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
        self._eval(r"""()=>{const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));const last=bs[bs.length-1];if(last&&last.getAttribute('aria-expanded')==='false')last.click();}""")
        self.page.wait_for_timeout(800)
        tools = self._eval(r"""()=>{
            const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
            const last=bs[bs.length-1]; if(!last) return [];
            const panel=last.parentElement;   // 限定到当轮面板
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
        script_failed = script_ok = 0
        try:  # 结果体扫描出任何岔子都只降为 0，绝不让整个 tool_trace 崩掉（它喂所有用例判定）
            self._eval(r"""()=>{
                const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
                const last=bs[bs.length-1]; const panel=last?last.parentElement:document;
                for(const b of panel.querySelectorAll('button')){ if(/^(結果|结果)$/.test((b.textContent||'').trim())) b.click(); }
            }""")
            self.page.wait_for_timeout(700)
            res_text = self._eval(r"""()=>{
                const bs=[...document.querySelectorAll('button[aria-expanded]')].filter(e=>/個工具|个工具/.test(e.textContent||'')&&!e.hasAttribute('data-old'));
                const last=bs[bs.length-1]; return last? (last.parentElement.innerText||'') : (document.body.innerText||'');
            }""") or ""
            script_failed = res_text.count("✗ Script failed")
            script_ok = res_text.count("✓ Script")
        except Exception:  # noqa: BLE001
            pass
        return {
            "tools": tools,           # [{name,status}] 完整顺序
            "count": len(tools),
            "names": names,
            "failures": len(failures),
            "failed_tools": [t["name"] for t in failures],
            "repeats": repeats,       # {工具名: 次数}，看有没有反复
            "script_failed": script_failed,  # stdout 里 `✗ Script failed` 次数（任务级失败）
            "script_ok": script_ok,          # stdout 里 `✓ Script …` 次数（任务级完成）
        }

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
        load_skill 是个 `<span>` + 就近 `參數/結果` 按钮。直接找所有 `load_skill` 条目、点它的「參數」，读 pre。"""
        # 直接定位每个 load_skill 条目（span/div，自身文本恰为 load_skill），点开它就近的「參數」
        self._eval(r"""()=>{
            const nodes=[...document.querySelectorAll('span,div')].filter(e=>(e.textContent||'').trim()==='load_skill' && e.getBoundingClientRect().width>0);
            for(const n of nodes){
                let box=n; for(let i=0;i<5 && box;i++){ box=box.parentElement;
                    if(!box) break;
                    const p=[...box.querySelectorAll('button')].find(b=>['參數','参数'].includes(b.textContent.trim()) && b.getBoundingClientRect().width>0);
                    if(p){ p.click(); break; }
                }
            }
        }""")
        self.page.wait_for_timeout(900)
        # 读全页 <pre> 里的 {"name":"<slug>"}（当轮对话已 new_conversation 隔离，只此一轮）
        return self._eval(r"""()=>{
            const out=[];
            for(const pre of document.querySelectorAll('pre')){
                const m=(pre.textContent||'').match(/"name"\s*:\s*"([^"]+)"/);
                if(m) out.push(m[1]);
            }
            return [...new Set(out)];
        }""") or []

    def verify_must_call(self, expected) -> dict:
        """验证当轮是否加载了期望 skill。expected 可为单个 slug 或 slug 列表（**多选之一**——
        有些任务合理地会路由到几个 skill 之一，如「只读核价」→ verifying 或 listing 都算对）。
        返回 {expected, loaded, ok}。"""
        loaded = self.loaded_skills()
        exp = expected if isinstance(expected, list) else [expected]
        return {"expected": expected, "loaded": loaded, "ok": any(e in loaded for e in exp)}

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
        ⚠️ UI 文案随账号 locale 简繁都可能出现（zh-HK「安裝」/ zh-CN「安装」），两种都要匹配。"""
        return self._eval(r"""(slug)=>{
            const body=document.body.innerText||''; const i=body.indexOf(slug);
            if(i<0) return 'notfound';
            const seg=body.slice(i, i+60);
            return /已安[裝装]/.test(seg)?'已安裝':/安[裝装]中/.test(seg)?'安裝中':/安[裝装]/.test(seg)?'待安裝':'?';
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
    d = ChatDriver().attach()
    print("URL:", d.page.url)
    print("在 chat 页:", "/chat" in d.page.url)
    if "--install" in sys.argv:
        i = sys.argv.index("--install")
        slugs = sys.argv[i + 1].split(",")
        print("ensure_installed:", d.ensure_installed(slugs))
    d.close()
