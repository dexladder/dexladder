# -*- coding: utf-8 -*-
"""DexLadder v154 assembler.
Input : index.v153.html (canonical v153 payload, sha256 ccbeddf6…)
Output: dist/index.html (v154)  — v153 + exact text patches (manifest below, every count asserted)
        + appended self-mounting layers (layers/*.js, in filename order) + one <style id="v154css">.
Deterministic: same inputs → same bytes. Prints the SHA-256 of the output.
"""
import hashlib, os, re, sys, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = next((p for p in [os.path.join(ROOT, 'src', 'index.v153.html'), os.path.join(ROOT, 'index.v153.html')] if os.path.exists(p)), os.path.join(ROOT, 'src', 'index.v153.html'))
OUT_DIR = os.path.join(ROOT, 'dist')
OUT = os.path.join(OUT_DIR, 'index.html')

src = open(SRC, encoding='utf-8').read()
assert hashlib.sha256(src.encode('utf-8')).hexdigest() == 'ccbeddf6f664da8a8e36b1358ce89a93a33cf8e5a757ae78ce7b872c1e3a0b02', 'input is not the canonical v153 payload'

# ------------------------------------------------------------------ release metadata
# ONE source for every user-visible version string. v155-G defect 6: the payload shipped
# as v155f while the stamp bottom-left, the What's-New banner and the seen-key all still
# read v154, because each of them was a literal typed into a patch. They are all derived
# from this dict now, dist/sw.js is asserted to name the same build, and test/gate154.js
# asserts at runtime that the stamp a user reads IS <meta name="cb:build">.
RELEASE = {'build': 'v159', 'name': 'the floor', 'updated': 'September 13, 2026'}

# ------------------------------------------------------------------ patch manifest
# (id, find, replace, expected count)
PATCHES = [
 # P1 — DLBX ladder: rung 3 is now Coinlore (CoinDesk Data ended CryptoCompare free access 21 May 2026)
 ('dlbx-rung', 'k:"cryptocompare",d:2600', 'k:"coinlore",d:2600', 1),
 ('dlbx-label', 'cryptocompare:"CryptoCompare",binance:"Binance"', 'coinlore:"Coinlore",binance:"Binance"', 1),
 # P2 — price-consensus witness labels (the fetch itself is shimmed to Coinlore by the v154 feeds layer)
 ('quorum-vote', 'votes.push({k:"CryptoCompare",p:cc[s].USD})', 'votes.push({k:"Coinlore",p:cc[s].USD})', 1),
 ('quorum-chip', '">CryptoCompare ${QUOR.src.cryptocompare?"✓":"—"}</span>', '">Coinlore ${QUOR.src.cryptocompare?"✓":"—"}</span>', 1),
 ('quorum-copy', 'CoinGecko (canonical), Binance, CryptoCompare — and truth', 'CoinGecko (canonical), Binance, Coinlore — and truth', 1),
 # P3 — Time-Machine history fallback label (shimmed to Kraken OHLC by the feeds layer)
 ('replay-src', 'hsrc="CryptoCompare")', 'hsrc="Kraken")', 1),
 # P4 — News desk social row: Reddit's public .json is closed; row becomes Attention pulse (Wikipedia page-view velocity)
 ('social-head', '<b>🗣 Social pulse</b><span>live from Reddit’s public API · sorted by engagement</span>', '<b>👁 Attention pulse</b><span>Wikipedia page-view velocity · keyless · this week vs last</span>', 1),
 ('social-sub', '<span class="r">r/\'+esc2(p.sub)+"</span>', '<span class="r">\'+esc2(p.r||p.sub)+"</span>', 1),
 ('social-meta', '\'</b><span class="e">▲ \'+p.ups.toLocaleString()+" · 💬 "+p.cm.toLocaleString()+" · "+ago(p.t)+" ago</span></a>"', '\'</b><span class="e">\'+esc2(p.e||"")+"</span></a>"', 1),
 ('social-empty', 'Social feed unreachable right now — it retries with the headlines.', 'Attention feed unreachable right now — it retries with the headlines.', 1),
 ('social-url', 'url:"https://reddit.com"+d.permalink,t:1e3*(d.created_utc||0),author:d.author}', 'url:/^https?:/.test(d.permalink||"")?d.permalink:"https://reddit.com"+d.permalink,t:1e3*(d.created_utc||0),author:d.author,r:d.r,e:d.e}', 1),
 # P5 — "DexScan" is CoinMarketCap's product name → Pool Radar
 ('radar-tab', '<button data-t="dex">DexScan</button>', '<button data-t="dex">Pool Radar</button>', 1),
 ('radar-btn', 'data-intel="dex">🛰 DexScan</button>', 'data-intel="dex">📡 Pool Radar</button>', 1),
 ('radar-note', 'r("v137","intel","DexScan trending pools', 'r("v137","intel","Pool Radar trending pools', 1),
 ('radar-launch', 'b&&openHub(b.getAttribute("data-intel"))', 'b&&(window.DLRADAR&&"dex"===b.getAttribute("data-intel")?DLRADAR.open("trend"):openHub(b.getAttribute("data-intel")))', 1),
 ('radar-hubtab', 'b&&(tab=b.getAttribute("data-t"),paintTabs(),load())', 'b&&(window.DLRADAR&&"dex"===b.getAttribute("data-t")?(closeHub(),DLRADAR.open("trend")):(tab=b.getAttribute("data-t"),paintTabs(),load()))', 1),
 ('radar-openhub', 'openHub(which){hub||build(),hub.classList.add("on"),tab=which||tab||"dex",paintTabs(),load()}', 'openHub(which){if(window.DLRADAR&&(!which||"dex"===which))return DLRADAR.open("trend");hub||build(),hub.classList.add("on"),tab=which||tab||"dex",paintTabs(),load()}', 1),
 # P6 — MX compute(): a "rung" filter branch, backed by the v154 Rungs layer
 ('mx-rung', 'else if("watch"===MX.filter){var w=watchSet();list=list.filter(function(c){return w.has(c.sym)})}',
  'else if("watch"===MX.filter){var w=watchSet();list=list.filter(function(c){return w.has(c.sym)})}else if("rung"===MX.filter&&window.DLRUNGS){var rs=DLRUNGS.activeSet();list=list.filter(function(c){return rs.has(c.sym)})}', 1),
 # P8 — DLSIM perps: real funding (Leverage Weather) replaces the synthetic rate when available
 ('sim-funding', 'function fundRate(sym){try{var c="undefined"!=typeof bySym&&bySym[sym],mo=c&&c.c24||0;', 'function fundRate(sym){try{if(window.DLWEATHER){var lf=DLWEATHER.funding8h(sym);if(lf!=null)return lf}}catch(e){}try{var c="undefined"!=typeof bySym&&bySym[sym],mo=c&&c.c24||0;', 1),
 # P7 — build tags
 ('build-a', 'BUILD="v153 · purist / offline"', 'BUILD="%(build)s · purist / offline"' % RELEASE, 1),
 ('build-b', 'var B="v153 · bedrock"', 'var B="%(build)s · %(name)s"' % RELEASE, 1),
 # P9 — DeXaI takes the copilot seat (the chat panel, orb and greeting); the legacy localStorage keys keep their names
 ('dexai-panel-title', '<div class="nxc-tt"><b>Oracle</b>', '<div class="nxc-tt"><b>DeXaI</b>', 1),
 ('dexai-panel-aria', 'panel.setAttribute("aria-label","Oracle chat")', 'panel.setAttribute("aria-label","DeXaI chat")', 1),
 ('dexai-orb-aria', 'aria-label="Open Oracle chat"', 'aria-label="Open DeXaI chat"', 1),
 ('dexai-orb-aria2', 'orb.setAttribute("aria-label","Open Oracle chat")', 'orb.setAttribute("aria-label","Open DeXaI chat")', 1),
 ('dexai-orb-title0', 'title="Oracle — DexLadder chat &amp; console"', 'title="DeXaI — DexLadder chat &amp; console"', 1),
 ('dexai-ask-aria', 'aria-label="Ask Oracle"', 'aria-label="Ask DeXaI"', 2),
 ('dexai-orb-title', 'Oracle — ask anything: crypto, markets, your book', 'DeXaI — ask anything: a coin, the market, your book', 1),
 ('dexai-cmdk', 'Ask the Oracle anything', 'Ask DeXaI anything', 1),
 ('dexai-relay-sys', 'You are the Oracle inside DexLadder', 'You are DeXaI inside DexLadder', 1),
 ('dexai-greet', 'Oracle · your crypto copilot', 'DeXaI · your ladder copilot', 1),
 ('dexai-coinai-btn', 'Ask the Oracle about ', 'Ask DeXaI about ', 1),
 ('dexai-dock-aria', 'Open Oracle, the on-device crypto assistant', 'Open DeXaI, the on-device crypto copilot', 1),
 ('dexai-dock-greet', '<span class="ttl">Oracle online</span>', '<span class="ttl">DeXaI online</span>', 1),
 ('dexai-dock-title', 'Oracle — ask anything about crypto, this market, or your book', 'DeXaI — ask anything about crypto, this market, or your book', 1),
 ('dexai-sv-head', 'Sovereign Oracle — ask anything', 'Sovereign DeXaI — ask anything', 1),
 ('dexai-dock-aria2', 'dock.setAttribute("aria-label","Oracle")', 'dock.setAttribute("aria-label","DeXaI")', 1),
 ('dexai-coinai-blurb', 'Ask the Oracle for the full picture.', 'Ask DeXaI for the full picture.', 1),
 # P10 — Trust Center copy: the dead rung is named honestly everywhere a user can read it
 ('trust-quorum-copy', 'Independent witnesses — CoinGecko, Binance, CryptoCompare — are polled', 'Independent witnesses — CoinGecko, Binance, Coinlore — are polled', 1),
 ('trust-ladder-copy', 'CoinGecko → Coinpaprika → CryptoCompare → Binance → Coinbase', 'CoinGecko → Coinpaprika → Coinlore → Binance → Coinbase', 1),
 ('trust-privacy-copy', 'CoinGecko, Coinpaprika, CryptoCompare, Binance, Coinbase (prices)', 'CoinGecko, Coinpaprika, Coinlore, Binance, Coinbase (prices)', 1),
 ('build-meta', '<meta name="cb:build" content="v153">', '<meta name="cb:build" content="v154">', 1),
 # P11 — What's-New banner + list for v154
 ('wn-seen', '"v152"===localStorage.getItem("dl.seen")', '"%(build)s"===localStorage.getItem("dl.seen")' % RELEASE, 1),
 ('wn-dismiss', 'localStorage.setItem("dl.seen","v152")', 'localStorage.setItem("dl.seen","%(build)s")' % RELEASE, 1),
 ('wn-banner', '✨ <b>New in v152 · compass</b><span style="color:var(--faint)">— quest, journey hub, session replay, perp presets</span>', '✨ <b>New in %(build)s · %(name)s</b><span style="color:var(--faint)">— two new desks: liquidity pools you provide to, and bots that trade for you; and the Markets record strip is gone</span>' % RELEASE, 1),
 ('wn-list', 'var NEWS=[["v152 · compass",', 'var NEWS=[["%(build)s · %(name)s' % RELEASE + '","' + 'Two new desks, and a floor under both of them. THE LIQUIDITY DESK: stop taking prices and start making them. Provide to a Uniswap v2 pair and watch the constant product decide your share; open a v3 position over a price range you choose and see the capital efficiency that a narrow band buys you \u2014 and the moment it stops earning because the price left your range; add to a Curve StableSwap pool where the invariant holds the peg until it doesn\u2019t. Stake, and read the reward curve that pays less per coin as more coins arrive, with a vote-escrow multiplier that caps where the protocol caps it. And IMPERMANENT LOSS, stated as arithmetic rather than a warning: what the pool paid you in fees against what simply holding the two coins would have, at every price you care to move to. Every number is the contract\u2019s own, checked against figures the protocols published before this desk existed. Two new ways to trade without watching a chart, both on paper money and both on their own wallet. BUILD YOUR OWN BOT: pick the market and the bar size, stack the rules as blocks — RSI under 30, EMA 20 crossing above EMA 50, a close through the last 20 bars\u2019 high on above-average volume — add a stop, a target, a trailing stop and a cooldown, read the whole thing back in plain English, and test it on real history before it ever runs: every decision fills at the NEXT bar\u2019s open, and the stop is checked against every price inside the bar, wick included. BRING YOUR OWN BOT: your JavaScript runs in a Worker with fetch, sockets and storage removed before your first line \u2014 it just answers onBar(ctx); or run your bot in any language at all and DexLadder asks it one URL per closed bar (Python and Node starter kits included, and a dry-run that shows the raw answer). Both land in the ARENA, where every bot is ranked by the only number that matters \u2014 its edge over simply holding the coin \u2014 with drawdown, fee drag, exposure, a Wilson band on the win rate, and every decision it took, in words. A bot can never reach your trading account: it has its own wallet, and that is all it has."],["v158 · tidy"," The Markets page opened on a panel that answered six questions nobody had asked \u2014 a market cap, a 24h volume, two dominances, Fear \u0026 Greed and breadth, each with its own universe chip, above the hero. It is removed, not hidden: the element, its styles and the third market-data fetch behind it are cut out of the payload. No figure is lost \u2014 the command bar carries them on every view now, with the same whole-market / tracked-set switch, the same sources and the same disagreement marks. Tidied to an industry grade, from seven screenshots. The News desk is served first-party now: /api/news on both hosts reads the seven newsrooms directly, and the public-bridge ladder behind it has six measured rungs — the categorised front page fills, newest first. The Markets spotlight draws the observed week, ending at the live price, and says \\"live\\" instead of \\"7-day\\" when it has no week to show. The command palette has a real search field. The Proof ledger\\u2019s actions stay inside their card. The portfolio board\\u2019s columns end on one line, and on a phone the What\\u2019s-New banner and the hero stat strip fold to one line each. And every market figure is stated once — the witness spread, the universe and the source note are one hover away instead of a row of red chips."],["v157 · leverage","Perpetual futures, done properly: isolated margin with tiered maintenance, a liquidation price you can see before you open, funding that settles on the real UTC clock out of your margin, and a liquidation engine that explains itself afterwards — what it cost, what funding did to it, and whether a stop, less leverage or more margin would have survived. And Rewind, a bar-by-bar backtester: pick a market and a stretch of history (including the 2020 crash, the 2021 top, LUNA and FTX), step or play through real candles, and trade them with orders that fill on the bars that come NEXT — never on the one you are looking at. Live equity curve, drawdown and a verdict that leads with buy-and-hold. Conditional and algorithmic orders on the paper desk: OCO, where one leg cancels the other and a partial fill shrinks its partner exactly, and TWAP, a parent order worked in even slices on the clock. The Local Fork sandbox runs a real pool on your own node — encode, sign and send transactions, watch gas and slippage decide the fill. The Blog: seven long-form guides inside Academy, illustrated with drawn figures and animated diagrams, no image files. The News desk has a working transport again — a four-rung bridge ladder with health memory that remembers which bridge answered, so the categorised front page fills instead of blanking. And a keyless CoinMarketCap Spot Rail with a two-witness cross-check."],["v156 · execution","Advanced execution mode: every order is priced on a liquidity pool — price impact against your slippage tolerance, real venue fees and partial fills. On the DEX, gas and a priority fee (swaps can wait, be dropped or revert) and optional MEV sandwich bots. Near-zero liquidity is refused; stops meet the market in a gap. Every surprise is explained and points to its Academy lab. Beginner is unchanged."],["v155f · dexai","DeXaI — a copilot that never types a number (Read, Desk, Coach, Tutor, Scan, Lens, Brief). Rungs, Sectors, Pool Radar, Leverage Weather, Chain Clock, Forecast, Odds, coin Dossier, Sentinel alerts in words, Chain Ladder, Venue Board, Yield Sandbox, Convert with time travel, Supply Drift, Era Ledger, Baskets, heat lenses, Trust model card. Dead feeds retired (CryptoCompare, Reddit)."],["v153 · citadel","DLGUARD error shield, live-region toasts, faster news cadence, wallet-mirror fixes."],["v152 · compass",', 1),
 ('trust-sources-row', 'sr("CryptoCompare","https://www.cryptocompare.com","Second price fallback")', 'sr("Coinlore","https://www.coinlore.com","Second price fallback (CryptoCompare\'s free API ended May 2026)")', 1),
 # P12 — decorative background stack removed from the web build (user request 2026-09-05):
 #   #aurora (4 drifting blobs + film grain), #ocean (wave canvas), #netbg (floating node mesh).
 #   Removing the three elements is sufficient: netbgInit()/oceanInit() early-return on a missing
 #   node, netbgFrame()/oceanFrame() early-return on a missing ctx, and DLFX's field keeper only
 #   re-subscribes when NB.cv exists. The boot calls go too so no sprites/bubbles are ever seeded.
 ('nobg-markup',
  '<div id="aurora"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div><div class="grain"></div></div>\n<canvas id="ocean" aria-hidden="true"></canvas>\n<canvas id="netbg" aria-hidden="true"></canvas>',
  '<!-- v154: decorative background stack removed (aurora blobs + grain, ocean canvas, netbg node mesh) -->', 1),
 ('nobg-boot', 'restoreState(),oceanInit(),netbgInit(),renderTicker()', 'restoreState(),renderTicker()', 1),
 # P12c — DLFX's field keeper re-subscribed an ocean frame every 3s without checking OC.cv;
 #   with the canvas gone that sub is a dead per-frame call, so the keeper drops it too.
 ('nobg-dlfx-ocean', 'if("function"==typeof oceanFrame){var oc=MOTION.subs.get("ocean");oc&&oc.__dlfx||MOTION.subs.set("ocean",Object.assign(safe(oceanFrame),{__dlfx:1}))}', '', 1),
 # ==================================================================
 # P13 — DISPLAY MODES: four -> two (user request 2026-09-05)
 #   Night = the deep-space navy "dark" palette (default, no data-mode attribute)
 #   Day   = the warm-ivory "day" palette (html[data-mode=day])
 #   Cybernetic and Warm/grey are removed EVERYWHERE: menu, chip title, hotkey help,
 #   legacy CBTHEME toggle button, boot restore and help copy -- and their CSS is
 #   physically stripped from every <style> block by the DEAD-CSS pass below.
 #   Saved dl.mode=cyber|grey folds to Night; the legacy cb.theme key is deleted.
 # ==================================================================
 ('mode2-boot',
  '<script>try{"cyber"===localStorage.getItem("cb.theme")&&document.documentElement.classList.add("cyber");var _dm=localStorage.getItem("dl.mode");"grey"!==_dm&&"day"!==_dm&&"cyber"!==_dm||(document.documentElement.setAttribute("data-mode",_dm),"cyber"===_dm&&document.documentElement.classList.add("cyber"))}catch(e){}</script>',
  '<script>try{var _de=document.documentElement,_m=null;try{_m=localStorage.getItem("dl.mode")}catch(e){}if("day"!==_m&&"dark"!==_m){_m=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"day":"dark";try{localStorage.setItem("dl.mode",_m)}catch(e){}}"day"===_m?(_de.setAttribute("data-mode","day"),_de.style.setProperty("color-scheme","light")):(_de.removeAttribute("data-mode"),_de.style.setProperty("color-scheme","dark"));try{["cb.theme","dl.contrast","dl.modehint.v1"].forEach(function(k){localStorage.removeItem(k)})}catch(e){}}catch(e){}</script>', 1),
 ('mode2-chip-markup',
  '<button class="hchip" id="modeChip" onclick="window.DLMODE&&(DLMODE.menu||DLMODE.cycle)()" title="Display mode — Dark / Cybernetic / Warm / Day">☾</button>',
  '<button class="hchip" id="modeChip" type="button" onclick="window.DLMODE&&DLMODE.toggle()" title="Display mode" aria-label="Switch display mode">☾</button>', 1),
 ('mode2-keys-help',
  '["t","Cycle dark / grey / day"]',
  '["t","Toggle Day / Night"]', 1),
 ('mode2-faq',
  '{kw:"theme cyber dark mode switch toggle appearance",t:"Themes",a:"Two worlds: Dark — the charcoal monument — and Cybernetic — the navy-electric node network. Flip them with the ◈ button in the command bar; your choice persists on this device.",act:null}',
  '{kw:"theme day night dark light display mode switch toggle appearance",t:"Display mode",a:"Two modes, nothing else: Day — warm ivory, bright — and Night — deep-space navy, low light. Flip them with the ☀/☾ chip in the command bar (or press t); the choice persists on this device.",act:null}', 1),
 ('mode2-cywipe-kf', '@keyframes cyWipeMove{to{transform:translateX(115%)}}', '', 1),
 ('mode2-dlfx-click',
  'document.addEventListener("click",function(e){try{var t=e.target;t&&("cbTheme"===t.id||t.closest&&t.closest("#cbTheme"))&&(setTimeout(function(){cyberPaint(),stillFrame()},90),setTimeout(function(){cyberPaint(),stillFrame()},500))}catch(err){}},!0),',
  '', 1),
 ('mode2-cyberpaint',
  'function cyberPaint(){try{var cy=document.documentElement.classList.contains("cyber"),nb=document.getElementById("netbg"),oc=document.getElementById("ocean");nb&&(cy?(nb.style.setProperty("opacity","1","important"),nb.style.setProperty("filter","saturate(1.85) brightness(1.95) contrast(1.12)","important")):(nb.style.removeProperty("opacity"),nb.style.removeProperty("filter"))),oc&&(cy?oc.style.setProperty("opacity",".5","important"):oc.style.removeProperty("opacity"))}catch(e){}}',
  'function cyberPaint(){}', 1),
 # the legacy CBTHEME/#cbTheme toggle script, replaced wholesale: the two-mode chip is the
 # only switch now. The nvscroll listener it also owned is preserved verbatim, a CBTHEME
 # shim keeps any old caller alive, and purge() evicts a stale .cyber class / cb.theme key.
 ('mode2-cbtheme-block', '<script>!function(){"use strict";if(!window.__CYBER){window.__CYBER=1;var ON_cyan="#38F5FF",ON_indigo="#8B5CF6",ON_brand="linear-gradient(120deg,#38F5FF,#8B5CF6)";"loading"===document.readyState?document.addEventListener("DOMContentLoaded",boot):boot(),window.CBTHEME={apply:apply,toggle:toggle,get:function(){return document.body.classList.contains("cyber")?"cyber":"dark"}}}function saved(){try{return"cyber"===localStorage.getItem("cb.theme")?"cyber":"dark"}catch(e){return"dark"}}function retint(){try{"function"==typeof netbgColors&&netbgColors()}catch(e){}try{"function"==typeof oceanColors&&oceanColors()}catch(e){}}function updBtn(cyber){var el=document.getElementById("cbTheme");el&&(el.innerHTML=cyber?\'<span class="thi">◈</span> Cyber\':\'<span class="thi">◐</span> Dark\',el.setAttribute("title",cyber?"Theme: Cybernetic — click for Dark":"Theme: Dark — click for Cybernetic"),el.setAttribute("aria-label",cyber?"Switch to Dark theme":"Switch to Cybernetic theme"))}function apply(mode,persist){var cyber="cyber"===mode,de=document.documentElement,b=document.body;de.classList.toggle("cyber",cyber),b&&b.classList.toggle("cyber",cyber);try{"object"==typeof NB&&NB&&(NB.cyber=cyber,"function"==typeof netbgSize&&NB.cv&&netbgSize())}catch(e){}if(cyber)de.style.setProperty("--cyan",ON_cyan),de.style.setProperty("--indigo",ON_indigo),de.style.setProperty("--brand",ON_brand),retint();else if("function"==typeof applyVibe)try{applyVibe(!1)}catch(e){retint()}else retint();if(persist)try{localStorage.setItem("cb.theme",mode)}catch(e){}if(updBtn(cyber),persist){try{var calm;if(!document.body.classList.contains("calm")&&!matchMedia("(prefers-reduced-motion: reduce)").matches){var wp=document.getElementById("cyWipe");wp&&wp.remove(),(wp=document.createElement("div")).id="cyWipe",document.body.appendChild(wp),setTimeout(function(){wp.parentNode&&wp.parentNode.removeChild(wp)},700)}}catch(e){}if("function"==typeof toast)try{toast("good",cyber?"Cybernetic":"Dark",cyber?"Node-network engaged — the field is live":"Sovereign monument restored")}catch(e){}}}function toggle(){apply(document.body.classList.contains("cyber")?"dark":"cyber",!0)}function mountBtn(){if(document.getElementById("cbTheme"))return!0;var sov=document.getElementById("cbSov");if(!sov||!sov.parentNode)return!1;var btn=document.createElement("button");return btn.className="cbi",btn.id="cbTheme",btn.type="button",btn.addEventListener("click",toggle),sov.parentNode.insertBefore(btn,sov),updBtn(document.body.classList.contains("cyber")),!0}function boot(){apply(saved(),!1);var tries=0,iv=setInterval(function(){(mountBtn()||++tries>50)&&clearInterval(iv)},200);window.addEventListener("load",function(){setTimeout(function(){document.body.classList.contains("cyber")&&retint()},300)});var st=null;window.addEventListener("scroll",function(){document.body&&(document.body.classList.add("nvscroll"),st&&clearTimeout(st),st=setTimeout(function(){document.body.classList.remove("nvscroll")},520))},{passive:!0})}}();</script>', '<script>!function(){"use strict";if(window.__CYBER)return;window.__CYBER=1;window.CBTHEME={apply:function(m){window.DLMODE&&DLMODE.set&&DLMODE.set("day"===m?"day":"dark")},toggle:function(){window.DLMODE&&DLMODE.toggle&&DLMODE.toggle()},get:function(){try{return window.DLMODE&&DLMODE.get&&"day"===DLMODE.get()?"day":"dark"}catch(e){return"dark"}}};function boot(){var st=null;window.addEventListener("scroll",function(){document.body&&(document.body.classList.add("nvscroll"),st&&clearTimeout(st),st=setTimeout(function(){document.body.classList.remove("nvscroll")},520))},{passive:!0})}"loading"===document.readyState?document.addEventListener("DOMContentLoaded",boot):boot()}();</script>', 1),
 # ==================================================================
 # P14 — INDUSTRY-GRADE DAY/NIGHT (2026-09-05, second pass)
 #   The whole legacy mode engine (four modes, dropdown menu, hint ring) is replaced by a
 #   two-state toggle: Day + Night, seeded from the OS on the FIRST visit only, sticky after,
 #   synced across tabs, with color-scheme on the root so native controls follow the theme.
 #   The two competing palette axes are removed with it: the Vibe accent cycler (which wrote
 #   --cyan/--indigo/--brand as INLINE styles on <html> and so overrode whatever the theme's
 #   own tokens said) and the High-contrast overlay.
 # ==================================================================
 ('theme-engine', 'var MODES=["dark","cyber","grey","day"],META={dark:"#0B1220",cyber:"#061019",grey:"#191310",day:"#FBF7F1"},GLYPH={dark:"☾",cyber:"◈",grey:"◐",day:"☀"},LABEL={dark:"Dark",cyber:"Cybernetic",grey:"Warm",day:"Day"};function modeGet(){try{var m=localStorage.getItem("dl.mode");return MODES.indexOf(m)>=0?m:"dark"}catch(e){return"dark"}}function modeSet(m,quiet){MODES.indexOf(m)<0&&(m="dark"),"dark"===m?doc.documentElement.removeAttribute("data-mode"):doc.documentElement.setAttribute("data-mode",m);try{"cyber"===m?(doc.documentElement.classList.add("cyber"),localStorage.setItem("cb.theme","cyber")):(doc.documentElement.classList.remove("cyber"),"cyber"===localStorage.getItem("cb.theme")&&localStorage.removeItem("cb.theme"))}catch(e){}try{localStorage.setItem("dl.mode",m)}catch(e){}var mt=doc.querySelector(\'meta[name="theme-color"]\');mt&&mt.setAttribute("content",META[m]);var ch=$("modeChip");ch&&(ch.textContent=GLYPH[m],ch.title="Display mode: "+LABEL[m]+" — tap for Dark / Cybernetic / Warm / Day");var mm=$("dlModeMenu");mm&&mm.querySelectorAll(".dlmm-o").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-m")===m)});try{window.dispatchEvent(new CustomEvent("dl:mode",{detail:m}))}catch(e){}quiet||toastSafe("Display mode",LABEL[m])}function modeCycle(){modeSet(MODES[(MODES.indexOf(modeGet())+1)%MODES.length])}var HINT={dark:"Deep-space navy · classic",cyber:"Neon strings · grid alive",grey:"Ember dusk · low light",day:"Warm ivory · bright"};function modeMenu(){var ex=$("dlModeMenu");if(ex)ex.remove();else{var ch=$("modeChip");if(ch){try{localStorage.setItem("dl.modehint.v1","1")}catch(e){}ch.classList.remove("dlmm-new");var cur=modeGet(),m=doc.createElement("div");m.id="dlModeMenu",m.setAttribute("role","menu"),m.setAttribute("aria-label","Display mode"),m.innerHTML=\'<div class="dlmm-h">Display mode</div>\'+MODES.map(function(k){return\'<button type="button" class="dlmm-o\'+(k===cur?" on":"")+\'" data-m="\'+k+\'" role="menuitemradio" aria-checked="\'+(k===cur)+\'"><span class="dlmm-g">\'+GLYPH[k]+\'</span><span class="dlmm-t"><b>\'+LABEL[k]+"</b><small>"+HINT[k]+\'</small></span><span class="dlmm-c">✓</span></button>\'}).join(""),doc.body.appendChild(m);var r=ch.getBoundingClientRect();m.style.top=r.bottom+8+"px";var MW=Math.min(248,window.innerWidth-16),rr=Math.max(8,window.innerWidth-r.right);rr=Math.min(rr,Math.max(8,window.innerWidth-MW-8)),m.style.right=rr+"px",m.querySelectorAll(".dlmm-o").forEach(function(b){b.addEventListener("click",function(){modeSet(b.getAttribute("data-m")),setTimeout(function(){m.parentNode&&m.remove()},140)})}),requestAnimationFrame(function(){m.classList.add("in")}),setTimeout(function(){var away=function(ev){m.parentNode?m.contains(ev.target)||ev.target===ch||(m.remove(),doc.removeEventListener("pointerdown",away,!0)):doc.removeEventListener("pointerdown",away,!0)};doc.addEventListener("pointerdown",away,!0);var esc=function(ev){"Escape"===ev.key&&(m.parentNode&&m.remove(),doc.removeEventListener("keydown",esc,!0))};doc.addEventListener("keydown",esc,!0)},0)}else modeCycle()}}window.DLMODE={get:modeGet,set:modeSet,cycle:modeCycle,menu:modeMenu};try{if(!localStorage.getItem("dl.modehint.v1")){var _mc0=$("modeChip");_mc0&&_mc0.classList.add("dlmm-new")}}catch(e){}', '/* v154c two-mode theme engine — Day + Night, OS-seeded on first visit, sticky after */var THEMES={dark:{label:"Night",glyph:"☾",meta:"#0B1220",scheme:"dark"},day:{label:"Day",glyph:"☀",meta:"#FBF7F1",scheme:"light"}};function modeGet(){try{return"day"===localStorage.getItem("dl.mode")?"day":"dark"}catch(e){return"dark"}}function modeOther(m){return"day"===m?"dark":"day"}function modePaint(m){var t=THEMES[m]||THEMES.dark,de=doc.documentElement;"day"===m?de.setAttribute("data-mode","day"):de.removeAttribute("data-mode");try{de.style.setProperty("color-scheme",t.scheme)}catch(e){}try{var ms=doc.querySelectorAll(\'meta[name="theme-color"]\');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",t.meta)}catch(e){}var c=$("modeChip"),o=THEMES[modeOther(m)];c&&(c.textContent=t.glyph,c.title="Display mode: "+t.label+" — click for "+o.label,c.setAttribute("aria-label","Switch to "+o.label+" mode"))}function modeSet(m,quiet){m="day"===m?"day":"dark";var cur=modeGet(),de=doc.documentElement,chg=m!==cur;try{localStorage.setItem("dl.mode",m)}catch(e){}if(chg&&!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)){de.classList.add("dl-theming");clearTimeout(modeSet.__t);modeSet.__t=setTimeout(function(){de.classList.remove("dl-theming")},280)}modePaint(m);try{window.dispatchEvent(new CustomEvent("dl:mode",{detail:m}))}catch(e){}quiet||!chg||toastSafe("Display mode",THEMES[m].label)}function modeToggle(){modeSet(modeOther(modeGet()))}function modeCycle(){modeToggle()}window.DLMODE={get:modeGet,set:modeSet,toggle:modeToggle,cycle:modeToggle,menu:modeToggle,other:modeOther};try{window.addEventListener("storage",function(e){if(e&&"dl.mode"===e.key){var m="day"===e.newValue?"day":"dark";m!==("day"===doc.documentElement.getAttribute("data-mode")?"day":"dark")&&modePaint(m)}})}catch(e){}modePaint(modeGet());', 1),
 # head: declare both schemes to the UA, and drop the stale duplicate theme-color
 # Day's --faint was #8C7E6D — 3.70:1 on the #FBF7F1 page, 3.39:1 on the wash: below WCAG AA.
 # #776956 keeps the warm hue and measures 4.99:1 on the page, 4.58:1 on the darker wash.
 ('theme-day-faint', '--muted:#6F6254;--faint:#8C7E6D', '--muted:#6F6254;--faint:#776956', 1),
 ('theme-meta-scheme', '<meta name="theme-color" content="#0B1220">\n',
  '<meta name="theme-color" content="#0B1220">\n<meta name="color-scheme" content="dark light">\n', 1),
 ('theme-meta-dupe', '<meta name="theme-color" content="#0D0F12">\n', '', 1),
 # native form controls were pinned to dark, so selects/date pickers stayed dark in Day mode.
 # color-scheme is inherited — the root declaration is enough and is now correct in both modes.
 ('theme-inputs-scheme', 'input,select,textarea{color-scheme:dark}', '', 1),
 # --- Vibe accent cycler: control removed, accent handed back to the theme tokens ---
 ('theme-vibe-apply',
  'function applyVibe(withToast){const v=VIBES[(S.vibe||0)%VIBES.length],r=document.documentElement.style;r.setProperty("--cyan",v.a),r.setProperty("--indigo",v.b),r.setProperty("--brand","linear-gradient(120deg,"+v.a+","+v.b+")"),document.body.dataset.vibe=v.id,renderVibes(),"function"==typeof oceanColors&&oceanColors(),"function"==typeof netbgColors&&netbgColors(),withToast&&toast("good",mt("Theme","vibe check ✅"),v.line)}',
  'function applyVibe(){try{document.documentElement.style.removeProperty("--cyan"),document.documentElement.style.removeProperty("--indigo"),document.documentElement.style.removeProperty("--brand"),document.body&&(document.body.dataset.vibe=VIBES[0].id)}catch(e){}renderVibes()}', 1),
 ('theme-vibe-set', 'function setVibe(i){S.vibe=(i%VIBES.length+VIBES.length)%VIBES.length,applyVibe(!0),saveP(),sfx("open")}',
  'function setVibe(){}', 1),
 ('theme-vibe-render',
  'function renderVibes(){const host=document.getElementById("vibes");host&&(host.innerHTML=\'<span class="vlbl">vibe</span>\'+VIBES.map((v,i)=>`<button class="vdot ${i===(S.vibe||0)%VIBES.length?"on":""}" style="background:linear-gradient(135deg,${v.a},${v.b})" title="${v.name}" onclick="setVibe(${i})"></button>`).join(""))}',
  'function renderVibes(){const host=document.getElementById("vibes");host&&(host.innerHTML="",host.hidden=!0)}', 1),
 ('theme-vibe-cycle', 'function cycleAccent(){setVibe(((S.vibe||0)+1)%VIBES.length)}', 'function cycleAccent(){}', 1),
 ('theme-vibe-kit', '["vibe","Vibe check — cycle the theme","<i data-i3=palette></i>",cycleAccent],', '', 1),
 # VIBES[0] is the brand pair (#00E5FF/#5B7CFF) and still feeds the share-card canvases; pin it.
 ('theme-vibe-restore', '"number"==typeof P.vibe&&(S.vibe=P.vibe%VIBES.length),P.nvSeen||(S.vibe=5),', 'S.vibe=0,', 1),
 # --- High contrast overlay removed (its only entry point was the deleted mode menu) ---
 ('theme-hc-boot', 'hcGet()&&doc.documentElement.setAttribute("data-contrast","hi");', '', 1),
 # changelog rows stop advertising modes the app no longer ships
 ('theme-log-v149', ' · certificate Save-as-PDF · high-contrast mode · report-a-bug button', ' · certificate Save-as-PDF · report-a-bug button', 1),
 ('theme-log-v148', 'r("v148","sentry","Display-mode menu names all four themes · content sentry', 'r("v148","sentry","Content sentry', 1),
 ('theme-log-v147', 'r("v147","circuit","Cybernetic display mode — neon strings on living grid")', 'r("v147","circuit","Native order ticket — stop & stop-limit, GTC/IOC/FOK, post-only")', 1),
 ('theme-log-v146', 'r("v146","ember","Warm Day & Warm Dark palettes · academy layout restored")', 'r("v146","ember","Day palette reworked · academy layout restored")', 1),
 ('theme-log-v138', 'r("v138","omni","Three display modes · global stats strip', 'r("v138","omni","Global stats strip', 1),
 ('theme-hc-diag', '+m+(hcGet()?"+hc":"")+" · "', '+m+" · "', 1),
 ('theme-hc-export', ',contrast:hcSet,mounts:mounts}', ',mounts:mounts}', 1),
 ('theme-hc-funcs', 'function hcGet(){try{return"1"===localStorage.getItem("dl.contrast")}catch(e){return!1}}function hcSet(on){try{on?localStorage.setItem("dl.contrast","1"):localStorage.removeItem("dl.contrast")}catch(e){}doc.documentElement.setAttribute("data-contrast",on?"hi":"std"),on||doc.documentElement.removeAttribute("data-contrast"),T("good","High contrast "+(on?"on":"off"),on?"Stronger text and borders in every mode.":"Standard palette restored.")}function mountHcRow(menu){try{if($("#dltHcBtn",menu))return;var w=doc.createElement("div");for(w.innerHTML=\'<div class="dlmm-h dlt-hc-h">Accessibility</div><button type="button" id="dltHcBtn" class="dlmm-o\'+(hcGet()?" on":"")+\'" role="menuitemcheckbox" aria-checked="\'+hcGet()+\'"><span class="dlmm-g">◎</span><span class="dlmm-t"><b>High contrast</b><small>Stronger text &amp; borders</small></span><span class="dlmm-c">✓</span></button>\';w.firstChild;)menu.appendChild(w.firstChild);$("#dltHcBtn",menu).addEventListener("click",function(e){e.stopPropagation();var on=!hcGet();hcSet(on),this.classList.toggle("on",on),this.setAttribute("aria-checked",String(on))})}catch(e){}}', '', 1),
 ('theme-hc-observer',
  'try{new MutationObserver(function(muts){for(var i=0;i<muts.length;i++)for(var j=0;j<muts[i].addedNodes.length;j++){var n=muts[i].addedNodes[j];n&&"dlModeMenu"===n.id&&mountHcRow(n)}}).observe(doc.body,{childList:!0})}catch(e){}',
  '', 1),
    # ---- v154d · WCAG AA correction pass (2026-09-07). Every value verified against the
    # ---- REAL winning Day block (the warm html[data-mode=day] one), not the dead cool block.
    ('v154d-night-faint', '--muted:#7E8CA8;--faint:#6E7C9F;', '--muted:#7E8CA8;--faint:#7381A2;', 1),   # 4.30 -> 4.60
    ('v154d-day-violet-gold', '--violet:#6188FF;--gold:#B7791F;', '--violet:#3B5BDB;--gold:#8A6100;', 1),  # 2.99 -> 5.23 / 3.36 -> 5.11
    ('v154d-day-market', '--up:#16C784;--up-soft:rgba(22,199,132,.1);--down:#EA3943;--down-soft:rgba(234,57,67,.1);',
        '--up:#0B7346;--up-soft:rgba(11,115,70,.1);--down:#C0182B;--down-soft:rgba(192,24,43,.1);', 1),   # 2.03 -> 5.45 / 3.75 -> 5.68
    ('v154d-day-txt3', '--txt-3:#8C7E6D}', '--txt-3:#6B5F4F}', 1),   # 3.64 -> 5.74
    # the dead cool Day palette: html[data-mode=day] (0,1,1) always beats [data-mode=day] (0,1,0),
    # so this whole block could never render. Keep only its color-scheme declaration.
    ('v154d-day-dead-cool', '[data-mode=day]{color-scheme:light;--bg:#F3F5FA;--bg-solid:#EDF0F7;--ink:#101828;--ink-2:#344256;--muted:#5C6A82;--faint:#69778F;--glass:rgba(255,255,255,.86);--glass-2:rgba(250,251,254,.75);--glass-line:rgba(16,40,80,.13);--surface:#FFFFFF;--surface-2:#F6F8FC;--line:#E3E9F2;--line-2:#CFD9E8;--indigo:#3D5BFF;--cyan:#0089B3;--violet:#7C3AED;--gold:#A16207;--up:#0A9A5A;--up-soft:rgba(10,154,90,.12);--down:#DE3D4C;--down-soft:rgba(222,61,76,.12);--brand:linear-gradient(120deg,#0089B3,#3D5BFF);--shadow-sm:0 1px 2px rgba(16,24,40,.08);--shadow:0 14px 40px -16px rgba(16,24,40,.16);--shadow-lg:0 30px 70px -24px rgba(16,24,40,.2);--grid:rgba(21,52,105,.05)}', '[data-mode=day]{color-scheme:light}', 1),

    ('v154d-night-violet', '--cyan:#00E5FF;--violet:#8B5CF6;--gold:#FFB300;', '--cyan:#00E5FF;--violet:#9575F7;--gold:#FFB300;', 1),   # 4.23 -> 5.26

    ('v154d-night-indigo', '--indigo:#5B7CFF;--cyan:#00E5FF;--violet:#9575F7;', '--indigo:#6D8AFF;--cyan:#00E5FF;--violet:#9575F7;', 1),   # 4.22 -> 4.92
    ('v154d-night-txt3', '--txt-3:#7C8598}', '--txt-3:#8791A4}', 1),   # 4.14 -> 4.83

    ('v154e-day-cool', 'html[data-mode=day]{--bg:#FBF7F1;--bg-solid:#FBF7F1;--ink:#221A12;--ink-2:#4C3F31;--muted:#6F6254;--faint:#776956;--glass:rgba(255,254,251,.96);--glass-2:rgba(250,246,239,.92);--glass-line:#F1EAE0;--surface:#FFFFFF;--surface-2:#FAF5EE;--line:#F1EAE0;--line-2:#E4D8C8;--indigo:#C2410C;--cyan:#C2410C;--violet:#3B5BDB;--gold:#8A6100;--up:#0B7346;--up-soft:rgba(11,115,70,.1);--down:#C0182B;--down-soft:rgba(192,24,43,.1);--brand:linear-gradient(120deg,#C2410C,#E8590C);--shadow-sm:0 1px 2px rgba(40,30,18,.04);--shadow:0 8px 24px rgba(40,30,18,.06);--shadow-lg:0 16px 40px rgba(40,30,18,.1);--grid:rgba(194,65,12,.05);--gr-hl:#F1EAE0;--gr-hl2:#F4F6F9;--gr-lift:rgba(194,65,12,.06);--txt-3:#6B5F4F}', 'html[data-mode=day]{--bg:#F5F7FB;--bg-solid:#EEF2F8;--ink:#0D1421;--ink-2:#3B4A63;--muted:#58677E;--faint:#626F86;--glass:rgba(255,255,255,.88);--glass-2:rgba(241,244,249,.8);--glass-line:rgba(13,20,33,.12);--surface:#FFFFFF;--surface-2:#F1F4F9;--line:#E3E8F0;--line-2:#CFD7E3;--line-int:#7A879C;--indigo:#2F4BD0;--cyan:#00728F;--violet:#6D28D9;--gold:#8A6100;--up:#0B7346;--up-soft:rgba(11,115,70,.1);--down:#C0182B;--down-soft:rgba(192,24,43,.1);--brand:linear-gradient(120deg,#00728F,#2F4BD0);--shadow-sm:0 1px 2px rgba(13,20,33,.05);--shadow:0 10px 28px -18px rgba(13,20,33,.18);--shadow-lg:0 24px 56px -24px rgba(13,20,33,.22);--grid:rgba(13,20,33,.05);--gr-hl:rgba(13,20,33,.10);--gr-hl2:rgba(13,20,33,.05);--gr-lift:rgba(47,75,208,.08);--gr-srf:rgba(13,20,33,.028);--gr-shadow:0 1px 2px rgba(13,20,33,.05),0 10px 28px -18px rgba(13,20,33,.18);--nv-e1:0 1px 2px rgba(13,20,33,.06);--nv-e2:0 6px 24px -10px rgba(13,20,33,.14);--nv-e3:0 16px 48px -16px rgba(13,20,33,.18);--nv-topline:rgba(13,20,33,.05);--txt-3:#626F86}', 1),   # warm cream -> cool light, CMC-class but our own accents

    ('v154e-day-meta', 'day:{label:"Day",glyph:"☀",meta:"#FBF7F1",scheme:"light"}', 'day:{label:"Day",glyph:"☀",meta:"#F5F7FB",scheme:"light"}', 1),

    ('v154h-dark-default', 'if("day"!==_m&&"dark"!==_m){_m=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"day":"dark";try{localStorage.setItem("dl.mode",_m)}catch(e){}}', 'if("day"!==_m&&"dark"!==_m){_m="dark";try{localStorage.setItem("dl.mode",_m)}catch(e){}}', 1),   # Night is the default; the OS no longer seeds first visit

    ('v154k-news-note', 'Live feeds are blocked from a local <code>file://</code> page — showing a curated snapshot (Jul&nbsp;2026). Host it (e.g. GitHub&nbsp;Pages) and real-time headlines stream in automatically.', 'Live feeds need a real origin — a page opened from <code>file://</code> can\\x27t call them, so this is the built-in snapshot. The hosted build at <a href="https://www.dexladder.com" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline">www.dexladder.com</a> streams live headlines.', 1),   # was pointing at GitHub Pages and a stale date


 # --- v159 · THE MARKETS RECORD STRIP IS REMOVED --------------------------------------
 #   Owner call on the shipped v158 strip: "remove this panel entirely instead it makes no
 #   sense." #dlGstat stated a market cap, a 24h volume, two dominances, Fear & Greed and
 #   breadth in one wrapped block, each figure carrying its own universe chip and a switch
 #   above it — six answers to questions nobody on the Markets page had asked yet, above the
 #   hero. It is not hidden: nothing calls mountGstat, so the element never enters the
 #   document, and every dead #dlGstat rule is removed by the dead-selector pass below.
 #
 #   NO VIEW LOSES A FIGURE. v155-G's law was "one bar owns the figures"; with the record
 #   gone that bar is #cbCmd on every view including Markets, which is why the .cb-agg
 #   hide rule scoped to the Markets route is dropped from layers/v154.css. The command bar
 #   carries the same two-segment universe switch, the same .gs-u labels, the same
 #   provenance chips and the same contested marks.
 ('gstat-out', 'function mountLaunchers(){mountGstat(),mountHeat();',
               'function mountLaunchers(){mountHeat();', 1),
 #   The trust line (#dlUpd) and the Journey host hung off the strip. They keep their place
 #   at the top of the Markets section by anchoring to the section itself.
 ('gstat-upd-anchor',
  'function mountUpd(){try{var g=$("#dlGstat");if(g&&!$("#dlUpd")){var u=doc.createElement("div");u.id="dlUpd",u.className="dlt-upd",g.parentElement.insertBefore(u,g.nextSibling)}',
  'function mountUpd(){try{var g=doc.querySelector("#page-markets .wrap.section");if(g&&!$("#dlUpd")){var u=doc.createElement("div");u.id="dlUpd",u.className="dlt-upd",g.insertBefore(u,g.firstChild)}', 1),
 ('gstat-journey-anchor',
  'function mountHost(){try{var g=$("#dlGstat");if(!g||$("#dlJourneyHost"))return;var h=ce("div","",""),upd;h.id="dlJourneyHost",($("#dlUpd")||g).insertAdjacentElement("afterend",h),sync()}catch(e){}}',
  'function mountHost(){try{var u=$("#dlUpd"),w=document.querySelector("#page-markets .wrap.section");if(!u&&!w||$("#dlJourneyHost"))return;var h=ce("div","",""),upd;h.id="dlJourneyHost",u?u.insertAdjacentElement("afterend",h):w.insertBefore(h,w.firstChild),sync()}catch(e){}}', 1),
]

out = src
for pid, find, rep, n in PATCHES:
    c = out.count(find)
    assert c == n, f'patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

# ------------------------------------------------------------------ v159 · the record strip
# #dlGstat — the Markets global-stats strip — is not hidden, it is cut out. gstatRender and
# mountGstat are adjacent in the payload and nothing else calls either (the one call site,
# in mountLaunchers, is removed by patch `gstat-out` above), so both functions come out
# whole. That takes the third independent CoinGecko /global fetch and its 5-minute cache
# with them, which is why the v155 S9/S10 patches that used to tame that fetch are gone.
_gs_a = 'function gstatRender(g,fng){'
_gs_z = 'rs[0]&&gstatRender(rs[0],rs[1])})}}'
assert out.count(_gs_a) == 1, 'gstatRender is not where v159 left it'
assert out.count(_gs_z) == 1, 'mountGstat does not end where v159 left it'
_a = out.index(_gs_a); _z = out.index(_gs_z, _a) + len(_gs_z)
assert 0 < _z - _a < 2400, f'the gstat excision spans {_z - _a} bytes — that is not two functions'
GSTAT_CUT = _z - _a
out = out[:_a] + out[_z:]
assert 'mountGstat' not in out, 'mountGstat survived the v159 excision'
assert 'gstatRender' not in out, 'gstatRender survived the v159 excision'

# ------------------------------------------------------------------ P13b — dead theme CSS
# Every selector that can only ever match the two deleted modes (or the deleted legacy
# toggle / its wipe overlay) is physically removed from every <style> block; a rule whose
# whole selector list dies is dropped, and a <style> block left empty is dropped too.
# Selector-list splitting is paren-aware; @media/@supports/@layer/@container recurse;
# @keyframes and @font-face are copied verbatim.
DEAD_SEL = re.compile(r'\[data-mode=(?:grey|cyber)\]|\[data-contrast=hi\]|\.cyber(?![\w-])|\.dlmm-|#dlModeMenu(?![\w-])|#cbTheme(?![\w-])|#dlGstat(?![\w-])|#cyWipe(?![\w-])|#vibes(?![\w-])|\.vdot(?![\w-])|\.vlbl(?![\w-])')
DEAD = {'sel': 0, 'rules': 0, 'blocks': 0}

def _sel_split(sel):
    parts, depth, buf = [], 0, ''
    for ch in sel:
        if ch in '([': depth += 1
        elif ch in ')]': depth -= 1
        if ch == ',' and depth == 0:
            parts.append(buf); buf = ''
        else:
            buf += ch
    parts.append(buf)
    return parts

def _strip_css(css):
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            out.append(css[i:]); break
        sel = css[i:j]
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        assert depth == 0, 'unbalanced CSS braces'
        body = css[j + 1:k - 1]
        head = sel.strip()
        if head.startswith('@'):
            at = head.split()[0].split('(')[0].lower()
            if at in ('@media', '@supports', '@layer', '@container', '@scope'):
                nb = _strip_css(body)
                if nb.strip(): out.append(sel + '{' + nb + '}')
                else: DEAD['rules'] += 1
            else:
                out.append(css[i:k])
        else:
            keep = []
            for p in _sel_split(sel):
                if DEAD_SEL.search(p): DEAD['sel'] += 1
                else: keep.append(p)
            if ''.join(keep).strip(): out.append(','.join(keep) + '{' + body + '}')
            else: DEAD['rules'] += 1
        i = k
    return ''.join(out)

def _style_block(m):
    inner = _strip_css(m.group(2))
    if not inner.strip():
        DEAD['blocks'] += 1
        return ''
    return m.group(1) + inner + '</style>'

_n_style = out.count('<style')
out = re.sub(r'(<style[^>]*>)(.*?)</style>', _style_block, out, flags=re.S)
print(f"dead-css: selectors={DEAD['sel']} rules={DEAD['rules']} emptied-blocks={DEAD['blocks']} of {_n_style} style blocks")
# v159 · +11 selectors / +10 rules: every #dlGstat rule, the strip being cut out entirely.
assert (DEAD['sel'], DEAD['rules'], DEAD['blocks']) == (162, 146, 2), f"dead-css drift: {DEAD}"
# ---- two-mode post-conditions: every retired appearance control is gone from the payload ----
for _dead in ['[data-mode=grey]', '[data-mode=cyber]', '#cbTheme', '#cyWipe', '#dlModeMenu',
              'dlmm-', 'data-contrast', 'hcGet', 'mountHcRow', 'vibe check']:
    assert _dead not in out, f'retired appearance control still in the payload: {_dead}'
# the three retired keys survive ONLY inside the boot script's one-time eviction list
for _k in ['cb.theme', 'dl.contrast', 'dl.modehint.v1']:
    assert out.count(_k) == 1, f'{_k} should appear once, in the boot eviction list only'
assert 'cbTheme' not in out and 'cyWipe' not in out, 'legacy toggle plumbing left behind'
assert '["cb.theme","dl.contrast","dl.modehint.v1"].forEach' in out, 'boot eviction list missing'
assert len(re.findall(r'\.cyber(?![\w-])', out)) == 6, 'unexpected .cyber refs (5 dead netbg reads + FX.cyber alias expected)'
assert 'Cybernetic' not in out and 'Warm Dark' not in out, 'a retired mode is still named in user-facing copy'
assert out.count('THEMES={dark:') == 1 and out.count('modeToggle') == 5, 'two-mode engine missing'
assert out.count('function modeCycle()') == 1, 'modeCycle alias missing (the v138 module still calls it)'
assert out.count('prefers-color-scheme: light') == 0, 'OS seeding must be gone — Night is the unconditional default'
assert out.count('_m="dark";try{localStorage.setItem("dl.mode",_m)') == 1, 'dark-default boot seed missing'
assert out.count('<meta name="color-scheme" content="dark light">') == 1, 'root color-scheme declaration missing'
assert out.count('<meta name="theme-color"') == 1, 'theme-color meta must be single and engine-driven'
assert 'input,select,textarea{color-scheme:dark}' not in out, 'native controls still pinned to dark'
assert out.count('r.setProperty("--cyan"') == 0, 'an inline accent override still fights the theme tokens'


# ------------------------------------------------------------------ v154g — warm Day purge
# A previous pass shipped a whole warm-cream Day skin as hard-coded hexes inside
# html[data-mode=day] rules (header.nav, .tape, #mxSubnav, row hovers, chips, table heads...).
# Token edits can never reach those. Every light-warm colour inside a Day-scoped rule is
# re-cast to the same HSL lightness on a cool hue, so contrast is preserved exactly and the
# cream is gone. Illustration/canvas code is untouched: this only rewrites CSS rule bodies.
import colorsys as _cs

def _warm(r, g, b):
    L = 0.2126*(r/255) + 0.7152*(g/255) + 0.0722*(b/255)
    return L > 0.42 and r >= g >= b and (r - b) >= 6

def _cool_hex(r, g, b):
    h, l, s = _cs.rgb_to_hls(r/255, g/255, b/255)
    nr, ng, nb = _cs.hls_to_rgb(214/360.0, l, min(s, 0.30))
    return '#%02X%02X%02X' % (round(nr*255), round(ng*255), round(nb*255))

_WARMED = {'n': 0}

def _recolor_decl(body):
    def hx(m):
        h = m.group(1)
        if len(h) == 3: h = ''.join(c*2 for c in h)
        r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        if not _warm(r, g, b): return m.group(0)
        _WARMED['n'] += 1
        return _cool_hex(r, g, b)
    def rg(m):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        a = m.group(4)
        if not _warm(r, g, b): return m.group(0)
        _WARMED['n'] += 1
        c = _cool_hex(r, g, b).lstrip('#')
        nr, ng, nb = int(c[0:2],16), int(c[2:4],16), int(c[4:6],16)
        return ('rgba(%d,%d,%d,%s)' % (nr, ng, nb, a)) if a else ('rgb(%d,%d,%d)' % (nr, ng, nb))
    body = re.sub(r'#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})\b', hx, body)
    body = re.sub(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)', rg, body)
    return body

def _day_rule(m):
    return m.group(1) + _recolor_decl(m.group(2)) + '}'

out = re.sub(r'([^{}]*\[data-mode=["\']?day["\']?\][^{}]*\{)([^{}]*)\}', _day_rule, out)
print(f'warm-day purge: {_WARMED["n"]} colours re-cast to cool')
assert _WARMED['n'] > 40, f'warm-day purge found too little: {_WARMED["n"]}'


# ================================================================== v155-A · data honesty
# Audit 2026-09-07 findings 2 (missing data rendered as a fact), 11 (block height 0),
# and decisions D-02 / D-03 in docs/quality/decisions.md.
#
#   * `x.circulating_supply || 0` turned an ABSENT circulating supply into a confident
#     "0 BTC" beside a $1.59T market cap. A market fact is now a number or null.
#   * The Coinpaprika fallback shim went further and INVENTED observations: an all-time
#     high of 1.6x the current price, a fixed -37.5% distance from it, a 24h high/low
#     manufactured from the 24h percentage move, and an FDV that was just the market cap.
#     Those become null; a surface that cannot show them says so.
#   * Blockchair reports an unconfirmed transaction as block_id -1, so `block_id > 0`
#     labelled the Bitcoin/BCH genesis transaction (block 0) "mempool".
#
# DLF is defined in the head, before any adapter can run, so every fallback path has it.
_DLF = ('<script>window.DLF={n:function(v){if(null==v||""===v)return null;var x=+v;return isFinite(x)?x:null},'
        'txt:function(v,f,u){return null==v?"Unavailable":(f?f(v):String(v))+(u?" "+u:"")}};</script>')
_boot = '<script>try{var _de=document.documentElement'
assert out.count(_boot) == 1, 'head boot script anchor is not unique'
out = out.replace(_boot, _DLF + _boot, 1)

HONEST = [
 # --- Coinpaprika → CoinGecko shim: stop manufacturing observations -------------
 ('paprika-range',
  'high_24h:pr*(1+Math.abs(+q.percent_change_24h||0)/200),low_24h:pr*(1-Math.abs(+q.percent_change_24h||0)/200)',
  'high_24h:null,low_24h:null', 1),
 ('paprika-ath', 'ath:1.6*pr,ath_change_percentage:-37.5', 'ath:null,ath_change_percentage:null', 1),
 ('paprika-fdv', 'fully_diluted_valuation:+q.market_cap||0', 'fully_diluted_valuation:null', 1),
 ('paprika-supply',
  'circulating_supply:+x.circulating_supply||0,max_supply:+x.max_supply||0,total_supply:+x.total_supply||0',
  'circulating_supply:DLF.n(x.circulating_supply),max_supply:DLF.n(x.max_supply),total_supply:DLF.n(x.total_supply)', 1),
 # --- renderers: an unknown supply reads "Unavailable", never "0" ---------------
 ('sup-render-mx', '${cNum(c.supply)} ${c.sym}', '${null==c.supply?"Unavailable":cNum(c.supply)+" "+c.sym}', 1),
 ('sup-render-kpi', '["Circ. Supply",cNum(c.supply)+" "+c.sym]',
  '["Circ. Supply",null==c.supply?"Unavailable":cNum(c.supply)+" "+c.sym]', 1),
 ('sup-render-stats', '["Circulating supply",cNum(c.supply)+" "+c.sym]',
  '["Circulating supply",null==c.supply?"Unavailable":cNum(c.supply)+" "+c.sym]', 1),
 ('sup-render-mxpro', 'cNumX(c.supply)+\'<span class="sub">\'',
  '(null==c.supply?"Unavailable":cNumX(c.supply))+\'<span class="sub">\'', 1),
 ('sup-render-cmc', '<span class="k">Circulating supply</span><span class="v">\'+cNum(c.supply)+" "+esc2(c.sym)',
  '<span class="k">Circulating supply</span><span class="v">\'+(null==c.supply?"Unavailable":cNum(c.supply)+" "+esc2(c.sym))', 1),
 # --- explorer: height 0 is a real, confirmed block ----------------------------
 ('block-zero', 'tx.block_id>0?cNum(tx.block_id):"mempool"',
  'null!=tx.block_id&&tx.block_id>=0?cNum(tx.block_id):"mempool"', 1),
]
for pid, find, rep, n in HONEST:
    c = out.count(find)
    assert c == n, f'honesty patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

_sup = re.findall(r'supply:\+?[dx]\.circulating_supply\|\|0', out)
assert len(_sup) == 5, f'expected 5 remaining ||0 supply adapters, found {len(_sup)}'
out = re.sub(r'supply:\+?([dx])\.circulating_supply\|\|0', lambda m: 'supply:DLF.n(%s.circulating_supply)' % m.group(1), out)
assert out.count('supply:mc.supply||0') == 1, 'mirror adapter supply anchor moved'
out = out.replace('supply:mc.supply||0', 'supply:DLF.n(mc.supply)', 1)
assert 'circulating_supply||0' not in out, 'a supply adapter still coerces missing data to zero'

# ------------------------------------------------------------------ a11y: contrast
# The Night down-token fails WCAG 2.2 AA once the translucent chip fill is composited:
#   --down #FF5252 on --down-soft over --surface   = 4.08  (needs 4.5 at 12.5px/600)
#   --down #FF5252 on --down-soft over --surface-2 = 4.44
# Same pure-red axis, lightness only. --down-soft is deliberately unchanged.
A11Y = [
 ('a11y-down-night', '--down:#FF5252', '--down:#FF7A7A', 1),
]
for pid, find, rep, n in A11Y:
    c = out.count(find)
    out = out.replace(find, rep)
    assert c == n, f'a11y patch {pid}: expected {n} occurrence(s), found {c}'
assert '--down:#FF5252' not in out, 'the failing night down-token is still shipping'
print('a11y: night --down re-cast #FF5252 -> #FF7A7A (chip worst case 4.08 -> 5.16)')

# ------------------------------------------------------------------ a11y: hard-coded foregrounds
# The token pass above proves every TOKEN clears AA. It cannot see the other half of the payload:
# colours written straight into a rule as a literal, outside the token system entirely. In Night
# those sit on a dark panel and read; in Day layers/zz-day-surfaces.js retints the panel under
# them to white and the literal stays exactly where it was, at roughly 1.4-2.2. Measured in the
# running page by test/gate-render-contrast.js, not inferred from the source.
#
# Every substitution below moves a literal onto the token that already carries the same meaning,
# so the colour gains a Day value for free and can never strand again. Direction greens become
# --up, direction reds --down, ambers --gold, cyans --cyan; the grey family becomes --muted and
# the near-white text family becomes --ink. No new colour is invented in this group.
A11Y_TOKENISE = [
 # direction / semantic accents -> the token that already means that thing in both modes
 ('a11y2-up-00e676',  'color:#00e676', 'color:var(--up)',    7),
 ('a11y2-up-3ae58f',  'color:#3ae58f', 'color:var(--up)',    6),
 ('a11y2-up-7cf5b2',  'color:#7cf5b2', 'color:var(--up)',    5),
 ('a11y2-up-22d07e',  'color:#22d07e', 'color:var(--up)',    1),
 ('a11y2-up-4be38f',  'color:#4be38f', 'color:var(--up)',    1),
 ('a11y2-down-ff5252','color:#ff5252', 'color:var(--down)',  9),
 ('a11y2-down-ff6b87','color:#ff6b87', 'color:var(--down)',  5),
 ('a11y2-down-ff9e9e','color:#ff9e9e', 'color:var(--down)',  5),
 ('a11y2-down-f0455e','color:#f0455e', 'color:var(--down)',  1),
 ('a11y2-gold-ffb300','color:#ffb300', 'color:var(--gold)',  6),
 ('a11y2-cyan-00e5ff','color:#00e5ff', 'color:var(--cyan)',  5),
 ('a11y2-cyan-00dcff','color:#00dcff', 'color:var(--cyan)',  1),
 ('a11y2-cyan-8fe7ff','color:#8fe7ff', 'color:var(--cyan)',  5),
 # the muted-grey family: eight near-identical hand-mixed greys, all meaning "secondary text"
 ('a11y2-muted-66788f','color:#66788f', 'color:var(--muted)', 4),
 ('a11y2-muted-8fa0bc','color:#8fa0bc', 'color:var(--muted)', 5),
 ('a11y2-muted-5e7a9b','color:#5e7a9b', 'color:var(--muted)', 4),
 ('a11y2-muted-93a3be','color:#93a3be', 'color:var(--muted)', 4),
 ('a11y2-muted-7e93b4','color:#7e93b4', 'color:var(--muted)', 3),
 ('a11y2-muted-5f7095','color:#5f7095', 'color:var(--muted)', 1),
 ('a11y2-muted-6e89a8','color:#6e89a8', 'color:var(--muted)', 1),
 ('a11y2-muted-587896','color:#587896', 'color:var(--muted)', 1),
 # the near-white text family: five hand-mixed off-whites, all meaning "primary text"
 ('a11y2-ink-eaf0fb', 'color:#eaf0fb', 'color:var(--ink)',  26),
 ('a11y2-ink-f5f7fa', 'color:#f5f7fa', 'color:var(--ink)',   9),
 ('a11y2-ink-eaf2ff', 'color:#eaf2ff', 'color:var(--ink)',   7),
 ('a11y2-ink-d9e2f2', 'color:#d9e2f2', 'color:var(--ink)',   5),
 ('a11y2-ink-e7edf8', 'color:#e7edf8', 'color:var(--ink)',   4),
]
_tok = 0
for pid, find, rep, n in A11Y_TOKENISE:
    c = out.count(find)
    assert c == n, f'a11y patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)
    _tok += c
# post-condition: not one of those literals may still be shipping as a foreground
for _pid, _find, _rep, _n in A11Y_TOKENISE:
    assert _find not in out, f'a11y patch {_pid}: the literal foreground {_find} is still shipping'

# --faint / --txt-3 in Day measured 4.20 against the tinted chip panels the app actually paints
# (#E5EAF1, #E4EEF3), not the four named surfaces the token gate samples. Same hue, lightness
# only: #626F86 -> #5C687D lifts the worst real panel 4.20 -> 4.67 and --bg-solid 4.52 -> 4.87.
A11Y_FAINT = [
 ('a11y2-faint-day', '--faint:#626F86', '--faint:#5C687D', 1),
 ('a11y2-txt3-day',  '--txt-3:#626F86', '--txt-3:#5C687D', 1),
]
for pid, find, rep, n in A11Y_FAINT:
    c = out.count(find)
    assert c == n, f'a11y patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)
assert '#626F86' not in out, 'the Day faint token that failed on a tinted panel is still shipping'

# Three chips carried white text on a light brand fill. Same hue, lightness only.
#   .bal-pill .av   #FFF on --cyan (#00E5FF)  = 1.54 -> dark ink on the same cyan = 12.1
#   #chainTog .on   #FFF on #FFB84D           = 1.72 -> dark ink on the same amber = 11.3
#   .livechip       #FFF on #E53935           = 4.23 -> #FFF on #D32F2F            =  5.02
A11Y_CHIPS = [
 ('a11y2-balpill-av', '.bal-pill .av{', '.bal-pill .av{color:#04121B !important;', 1),
 ('a11y2-livechip',   'background:#e53935', 'background:#D32F2F', 1),
]
for pid, find, rep, n in A11Y_CHIPS:
    c = out.count(find)
    assert c == n, f'a11y patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)
assert 'background:#e53935' not in out, 'the livechip red that failed under white text is still shipping'

# The build watermark is created by script with an inline style, so no stylesheet sweep can
# ever reach it. In Day its own translucent plate composites to #2F333A and #5E7A9B on that is
# 2.86. Same hue axis, lightness only: -> #A6AEB9, which is 5.74 there and 8.4 in Night.
_c = out.count('color:#5E7A9B')
assert _c == 1, f'a11y patch a11y2-buildtag: expected 1 occurrence, found {_c}'
out = out.replace('color:#5E7A9B', 'color:#A6AEB9')
assert 'color:#5E7A9B' not in out, 'the build watermark colour that failed in Day is still shipping'

# The P2P payment-rail avatars take their hue from a script-side map and paint it BOTH as the
# glyph and as a 13% tint behind it, inline, so no stylesheet can reach the hue to correct it.
# Every rail clears AA on its own tint except Card, whose violet is 4.08 in Night. Same hue,
# lightness only: #8A63FF -> #9C7DFF, which is 5.25 on that chip. (Day forces these glyphs to
# ink in layers/v154.css, because a rule cannot read an inline hue to mix it.)
_c = out.count('Card:["\U0001F4B3","#8A63FF"]')
assert _c == 1, f'a11y patch a11y2-p2av-card: expected 1 occurrence, found {_c}'
out = out.replace('Card:["\U0001F4B3","#8A63FF"]', 'Card:["\U0001F4B3","#9C7DFF"]')
assert 'Card:["\U0001F4B3","#8A63FF"]' not in out, 'the P2P card violet that failed in Night is still shipping'

# The trader avatars hash a name onto a seven-colour palette and paint the letter in that
# colour over a 13% tint of it, inline. Six of the seven clear AA on their own tint in Night;
# the violet is 4.08. Same hue, lightness only: #8A63FF -> #9C7DFF = 5.25 on that chip.
_pal_old = '["#00E5FF","#8A63FF","#00E676","#FFB300","#FF5252","#14BED0","#A3E635"]'
_pal_new = '["#00E5FF","#9C7DFF","#00E676","#FFB300","#FF5252","#14BED0","#A3E635"]'
_c = out.count(_pal_old)
assert _c == 1, f'a11y patch a11y2-p2av-palette: expected 1 occurrence, found {_c}'
out = out.replace(_pal_old, _pal_new)
assert _pal_old not in out, 'the avatar palette violet that failed in Night is still shipping'

print(f'a11y: {_tok} hard-coded foreground literals re-pointed at tokens '
      f'({len(A11Y_TOKENISE)} colours), faint/txt-3 Day darkened, 3 chips re-cast')
print('data honesty: 5 adapters + 1 mirror nullable, 5 renderers guarded, paprika shim de-fabricated, block 0 valid')

# ================================================================== v155-C · one canonical market snapshot
# Audit finding 1 (four market caps, four 24h volumes and four BTC dominance figures in one DOM),
# finding 3 (provenance through fallback), finding 14 (DeXaI reads the snapshot).
#
# Every global figure had its own producer, its own universe and its own clock:
#   updateSpotlight  tracked top-30 INCLUDING USDT, 60s
#   renderGStats     tracked top-30 EXCLUDING USDT, on ticker repaint  <- differs from the line
#                                                                        above by exactly the
#                                                                        USDT market cap
#   marketState      tracked top-30 EXCLUDING USDT, every 5s
#   fetchGlobals     CoinGecko /global, fetched ONCE at boot, never again
#   loadPulse        CoinGecko /global, fetched ONCE on first News visit
#   mountGstat       CoinGecko /global behind a 5-minute cache, degrading silently to a tracked
#                    sum under the same "Market Cap" label
#   globalWidget     tracked top-500 (MX.coins), a different store entirely
#
# layers/21-snapshot.js publishes one frozen Snapshot per 60s cycle and every surface below
# becomes a reader of it. It adds no fetch wrapper (it uses DLCORE.jget) and no timer (it rides
# the existing 60s live loop).
#
# SCOPE NOTE: `out` is the patched v153 payload only. layers/*.js are appended after every
# assert in this file runs, so no assert here can see layers/10-feeds.js. The layer half is
# guarded by test/gate154.js, which reads dist/index.html.
SNAPSHOT = [

 # --- S14 · the supply hole the v155-A honesty pass could not see. Its regex was
 #          supply:\+?[dx]\.circulating_supply\|\|0 and its closing assert was
 #          "circulating_supply||0 not in out" — both spelled against ONE provider's field
 #          name. This adapter uses SUPPLY, so it shipped a zero for a missing supply while
 #          the market cap beside it was real.
 ('snap-supply-cc', 'supply:+r.SUPPLY||0', 'supply:DLF.n(r.SUPPLY)', 1),

 # --- S15 · adopt() fabricates a USDT row when the feed omits it. A fabricated row must not
 #          assert observations; nulls keep it out of every aggregate honestly.
 ('snap-supply-usdt',
  'mcap:0,vol:0,supply:0,spark:Array(336).fill(1)',
  'mcap:null,vol:null,supply:null,synthetic:!0,spark:Array(336).fill(1)', 1),

 # --- S1 · hero .stat-strip: stop summing, start reading. The literal 56 dominance
 #         fallback goes with it — an unknown dominance is now unknown, not 56%.
 ('snap-spotlight',
  'const tot=coins.reduce((s,x)=>s+(x.mcap||0),0),vol=coins.reduce((s,x)=>s+(x.vol||0),0);'
  'document.getElementById("g-mcap").textContent=cUSD(tot),'
  'document.getElementById("g-vol").textContent=cUSD(vol),'
  'document.getElementById("g-dom").textContent=tot?((bySym.BTC?bySym.BTC.mcap:0)/tot*100).toFixed(1)+"%":"—";'
  'try{window.__dom=parseFloat(document.getElementById("g-dom").textContent)||56}catch(_){}',
  'window.DLSNAP&&DLSNAP.paintHero();'
  'try{window.__dom=window.DLSNAP?DLSNAP.get("universes.global.dominance.BTC").value:null}catch(_){}', 1),

 # --- S2 · the .gi strip: the whole body is delegated, so the universe label and the
 #         provenance chip cannot be omitted by a later edit to the template. The hero
 #         summed WITH the fabricated USDT row and this strip summed WITHOUT it; the two
 #         figures differed by exactly the USDT market cap. Both now read one field.
 ('snap-gstats',
  'function renderGStats(){const host=document.getElementById("gstatsIn");if(!host)return;'
  'const pool=coins.filter(c=>"USDT"!==c.sym);if(!pool.length)return void(host.innerHTML="");'
  'const tot=pool.reduce((s,x)=>s+(x.mcap||0),0),vol=pool.reduce((s,x)=>s+(x.vol||0),0),'
  'btc=bySym.BTC?bySym.BTC.mcap:0,eth=bySym.ETH?bySym.ETH.mcap:0,'
  'w=tot?pool.reduce((s,x)=>s+(x.c24||0)*(x.mcap||0),0)/tot:0;host.innerHTML=',
  'function renderGStats(){const host=document.getElementById("gstatsIn");if(!host)return;'
  'if(window.DLSNAP)return DLSNAP.paintStrip(host);'
  'const pool=[],tot=null,vol=null,btc=null,eth=null,w=null;host.innerHTML=', 1),

 # --- S3 · fetchGlobals: its own /global fetch is removed. G stays as the read-model the
 #         tape already reads, now refilled from the snapshot on every cycle rather than
 #         written once at boot and never again. The Fear & Greed leg moves into the cycle.
 ('snap-fetchglobals',
  'function fetchGlobals(){"function"==typeof jget&&(jget(CG+"/global")',
  'function fetchGlobals(){if(window.DLSNAP)return DLSNAP.fill(G),void renderTicker();'
  '"function"==typeof jget&&(jget(CG+"/global")', 1),

 # --- S4 · boot: fetchGlobals() was the ONLY market job on that line without a setInterval
 #         around it, which is why the tape's market cap was frozen for the whole session.
 #         DLSNAP.start() rides the 60s live loop that is already on this same line.
 ('snap-boot',
  'renderNetline(),setInterval(()=>{document.hidden||renderNetline()},15e3),fetchGlobals(),setInterval(tick,1500)',
  'renderNetline(),setInterval(()=>{document.hidden||renderNetline()},15e3),'
  '(window.DLSNAP?DLSNAP.start():fetchGlobals()),setInterval(tick,1500)', 1),

 # --- S5 · loadPulse's global leg. PLAN CHANGE: the plan wrapped only the head of the
 #         chain (jget(CG+"/global").then(map)) and left the Coinpaprika fallback and the
 #         pg-* render in place. That could not work: DLSNAP.pulse() resolving a NULL market
 #         cap would hit `g.btc.toFixed(1)` downstream and throw, and a rejection would fall
 #         straight into the Coinpaprika fetch the snapshot is meant to absorb. The whole leg
 #         is delegated instead, which also deletes one /global call site and the Coinpaprika
 #         call site outright. Coinpaprika survives as a WITNESS inside layers/21-snapshot.js.
 ('snap-loadpulse',
  'jget(CG+"/global").then(d=>{const g=d.data;return{mcap:g.total_market_cap.usd,vol:g.total_volume.usd,btc:g.market_cap_percentage.btc||0,eth:g.market_cap_percentage.eth||0,chg:g.market_cap_change_percentage_24h_usd||0}}).catch(()=>jget("https://api.coinpaprika.com/v1/global").then(g=>({mcap:g.market_cap_usd,vol:g.volume_24h_usd,btc:g.bitcoin_dominance_percentage||0,eth:bySym.ETH&&g.market_cap_usd?bySym.ETH.mcap/g.market_cap_usd*100:0,chg:g.market_cap_change_24h||0}))).then(g=>{document.getElementById("pg-mcap").textContent=cUSD(g.mcap),document.getElementById("pg-vol").textContent=cUSD(g.vol),document.getElementById("pg-btc").textContent=g.btc.toFixed(1)+"%",document.getElementById("pg-eth").textContent=g.eth.toFixed(1)+"%";const row=document.querySelector("#globRows .gr:first-child");row&&(row.querySelector("b").innerHTML=`${cUSD(g.mcap)} <span class="${g.chg>=0?"up":"down"}" style="font-size:12px">${pct(g.chg)}</span>`)}).catch(()=>{})',
  '(window.DLSNAP?DLSNAP.pulse():Promise.resolve(null))', 1),

 # --- S11 · the tape. G.mcap was boot-frozen; S3 makes it cycle-fresh. The item gains its
 #          freshness class so a stale tape is visibly stale rather than silently wrong.
 ('snap-ticker',
  'function renderTicker(){renderGStats();const tr=document.getElementById("tapeTrack");if(!tr)return;let s="";if(G.mcap&&',
  'function renderTicker(){renderGStats();const tr=document.getElementById("tapeTrack");if(!tr)return;'
  'let s="",_gf=window.DLSNAP?DLSNAP.freshClass("universes.global.marketCap"):"";'
  'if(G.mcap&&', 1),

 # --- S11b · the tape item itself becomes the provenance-bearing node: it carries the
 #           freshness class and names the universe it is quoting. (PLAN CHANGE: the plan's
 #           S11 only DECLARED _gf and never used it, so a stale tape stayed silently wrong.)
 ('snap-ticker-item',
  '(s+=\'<span class="ti">MCAP <b class="stat">\'+cUSD(G.mcap)+"</b></span>")',
  '(s+=\'<span class="ti dl-prov \'+(_gf||"stale")+\'">MCAP <b class="stat">\'+cUSD(G.mcap)'
  '+\'</b> <span class="gs-u">whole market</span></span>\')', 1),

 # --- S6 · the command bar held the second of the two divergent USDT-filtered sums, on a 5s
 #         clock. DLSNAP.barState() paints the chips from the tracked universe and returns
 #         null, so the payload's updStats() has nothing left to derive.
 ('snap-marketstate',
  'function marketState(){try{if("undefined"!=typeof coins&&coins.length){'
  'var pool=coins.filter(function(c){return"USDT"!==c.sym}),tot=0,vol=0,btc=0,eth=0,w=0;',
  'function marketState(){if(window.DLSNAP)return DLSNAP.barState();'
  'try{if("undefined"!=typeof coins&&coins.length){'
  'var pool=coins.filter(function(c){return"USDT"!==c.sym}),tot=0,vol=0,btc=0,eth=0,w=0;', 1),

 # --- S7 · the MX global widget summed a top-500 store under the same "Market cap" label as
 #         the top-30 surfaces. It stops being a competing answer and renders the one tracked
 #         universe, named.
 ('snap-globalwidget',
  'function globalWidget(){var mc=0,vol=0,btc=0;MX.coins.forEach(function(c){mc+=c.mcap||0,vol+=c.vol||0});',
  'function globalWidget(){if(window.DLSNAP)return DLSNAP.mxPanel();'
  'var mc=0,vol=0,btc=0;MX.coins.forEach(function(c){mc+=c.mcap||0,vol+=c.vol||0});', 1),

 # --- S8 · aggr() set approx:1 but nothing ever rendered that qualifier beside the number,
 #         so a degraded tracked sum was indistinguishable from a whole-market figure.
 ('snap-aggr',
  'function aggr(){var cs=null;try{cs="undefined"!=typeof coins&&coins&&coins.length?coins:null}catch(e){}if(!cs)return null;',
  'function aggr(){if(window.DLSNAP)return DLSNAP.aggrTracked();'
  'var cs=null;try{cs="undefined"!=typeof coins&&coins&&coins.length?coins:null}catch(e){}if(!cs)return null;', 1),

 # --- S12 · the DeXaI global intent was a FOURTH provider (Coinpaprika, 7s timeout) at a
 #          fifth instant, so the copilot could quote a market cap that appeared nowhere on
 #          screen. It becomes a snapshot read and cites the snapshot id it answered from.
 ('snap-dexai',
  'var localSum=0,localVol=0,btcM=0;try{coins.forEach(function(c){"USDT"!==c.sym&&'
  '(localSum+=c.mcap||0,localVol+=c.vol||0),"BTC"===c.sym&&(btcM=c.mcap||0)})}catch(e){}',
  'if(window.DLSNAP)return DLSNAP.answerGlobal();'
  'var localSum=0,localVol=0,btcM=0;try{coins.forEach(function(c){"USDT"!==c.sym&&'
  '(localSum+=c.mcap||0,localVol+=c.vol||0),"BTC"===c.sym&&(btcM=c.mcap||0)})}catch(e){}', 1),

 # --- S13 · quorumCheck already computed a median across CoinGecko/Binance/Coinlore and a
 #          deviation flagged above 1.5% — and then discarded both. It now publishes them
 #          against the snapshot that was on screen at the time.
 ('snap-quorum-publish',
  'const ps=votes.map(v=>v.p).slice().sort((a,b)=>a-b),'
  'med=ps.length%2?ps[(ps.length-1)/2]:(ps[ps.length/2-1]+ps[ps.length/2])/2,'
  'dev=Math.max(...votes.map(v=>Math.abs(v.p-med)/med*100));',
  'const ps=votes.map(v=>v.p).slice().sort((a,b)=>a-b),'
  'med=ps.length%2?ps[(ps.length-1)/2]:(ps[ps.length/2-1]+ps[ps.length/2])/2,'
  'dev=Math.max(...votes.map(v=>Math.abs(v.p-med)/med*100));'
  'try{window.DLSNAP&&DLSNAP.witness(s,votes,med,dev)}catch(_e){}', 1),

 # --- S16 · PLAN CHANGE (addition). The plan's own gate note flagged renderResearch's rdDom
 #          dominance bar as "a 4th independent total ... converted in step 6" and meanwhile
 #          loosened the assertion to <= 1 to tolerate it. Converting it costs one anchor and
 #          lets the post-condition be == 0, so no independent market-cap aggregate survives
 #          anywhere in the payload. The bar's denominator is the tracked market cap.
 ('snap-rddom',
  'const top=rdTop(8),W=coins.reduce((s,c)=>s+(c.mcap||0),0)||1;',
  'const top=rdTop(8),W=(window.DLSNAP?DLSNAP.get("universes.tracked.marketCap").value:null)||1;', 1),
]
for pid, find, rep, n in SNAPSHOT:
    c = out.count(find)
    assert c == n, f'snapshot patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

# ---- post-conditions: the defect cannot come back ----
# (1) At most one producer per canonical figure: no surface derives its own market cap.
assert out.count('coins.reduce((s,x)=>s+(x.mcap||0),0)') == 0, \
    'the hero still derives its own total market cap'
assert out.count('pool.reduce((s,x)=>s+(x.mcap||0),0)') == 0, \
    'the .gi strip still derives its own USDT-filtered market cap'
assert not re.search(r'reduce\(\(s,[a-z]\)\s*=>\s*s\+\([a-z]\.mcap\|\|0\),0\)', out), \
    'a NEW independent market-cap aggregate appeared in the payload'

# (2) Every remaining global fetch site is unreachable while the snapshot is present.
#     PLAN CHANGE: the plan asserted CG+"/global" == 2 with both sites guarded. S5 here
#     delegates the WHOLE loadPulse global leg instead of only its head, which deletes that
#     call site and the Coinpaprika fallback beside it outright, so the count is 1.
assert out.count('CG+"/global"') == 1, \
    'a CG /global call site was added or removed unexpectedly: %d' % out.count('CG+"/global"')
assert out.count('if(window.DLSNAP)return DLSNAP.fill(G)') == 1, \
    'fetchGlobals is not guarded by the snapshot'
assert out.count('window.DLSNAP?DLSNAP.pulse()') == 1, \
    "loadPulse's global leg is not guarded by the snapshot"
assert 'DLSNAP.mountStrip(el)' not in out, \
    'the record strip mounts again — v159 cut it out, so there is nothing to mount'
assert out.count('if(window.DLSNAP)return DLSNAP.answerGlobal();') == 1, \
    'the DeXaI global intent still reaches its own provider'
for _g in ('DLSNAP.paintHero()', 'DLSNAP.paintStrip(host)', 'DLSNAP.barState()',
           'DLSNAP.mxPanel()', 'DLSNAP.aggrTracked()', 'DLSNAP.start()', 'DLSNAP.witness('):
    assert out.count(_g) == 1, 'surface not routed through the snapshot: %s' % _g
assert out.count('DLSNAP') >= 20, 'not every surface was routed through the snapshot'

# (3) No fabricated figure, and no zero standing in for a missing one.
assert 'parseFloat(document.getElementById("g-dom").textContent)||56' not in out, \
    'the fabricated 56% dominance fallback is still in the payload'
# The v155-A guard checked ONE provider's vocabulary ('circulating_supply||0'). This checks the
# IDIOM, case-insensitively, so an adapter for a provider nobody has integrated yet is covered.
# The plan's proposed regex (\w*[Ss]upply) still missed supply:+r.SUPPLY||0 — the S14 target.
_SUPZERO = r'(?i)supply\s*:\s*\+?[\w.]+\s*\|\|\s*0'
assert not re.search(_SUPZERO, out), \
    'an adapter in the payload still coerces a missing supply to zero: %s' % re.findall(_SUPZERO, out)
assert 'mcap:0,vol:0,supply:0' not in out, 'the fabricated USDT row still asserts zero observations'
assert out.count('synthetic:!0') == 1, 'the fabricated USDT row is not marked synthetic'
# SCOPE: layers/*.js are appended after this file's last assert, so the Coinlore
# `supply: +x.csupply || 0` (fixed by edit L1 in layers/10-feeds.js) and everything about
# layers/21-snapshot.js are guarded in test/gate154.js, which reads dist/index.html.
print('canonical snapshot: 17 patches, 7 producers demoted to readers, '
      '2 supply adapters nullable, quorum publishes its median')



# ================================================================== v155-B · honest copy, versions and share assets
# Audit 2026-09-07 findings 4 (news error diagnosis), 6 (stop-loss certainty),
# 9 (share/crawler assets), 31 (documentation version drift).

BCOPY = [
 # --- 31: the Trust Center printed a hard-coded v150 three times, on a v154 build.
 ('ver-source', 'BUILDV="v150",UPDATED="July 29, 2026"',
  'BUILDV=(function(){try{return(document.querySelector(\'meta[name="cb:build"]\')||{}).content||"%(build)s"}catch(e){return"%(build)s"}})(),'
  'UPDATED=(function(){try{return(document.querySelector(\'meta[name="cb:updated"]\')||{}).content||"%(updated)s"}catch(e){return"%(updated)s"}})()' % RELEASE, 1),
 ('ver-about', 'data provider · v150 · last updated \'+UPDATED+"</p></div>"',
  'data provider · \'+BUILDV+\' · last updated \'+UPDATED+"</p></div>"', 1),
 ('ver-paper', 'technical paper. v150 · \'+UPDATED+\'</p>',
  'technical paper. \'+BUILDV+\' · \'+UPDATED+\'</p>', 1),
 ('ver-diag', 'return"DexLadder v150 · page "',
  'return"DexLadder "+((document.querySelector(\'meta[name="cb:build"]\')||{}).content||"")+" · page "', 1),
 ('ver-meta', '<meta name="cb:build" content="v154">',
  '<meta name="cb:build" content="%(build)s">\n<meta name="cb:updated" content="%(updated)s">' % RELEASE, 1),
 # --- 6: the risk helper taught that a stop caps the loss exactly. It does not: a stop-market
 #        order fills at the next available price, a stop-limit may not fill at all, and both
 #        sides pay a fee. The planned loss is now named as planned, with the gap arithmetic
 #        shown from the user's own inputs rather than asserted.
 ('stop-honesty', '. If the stop hits, that is all you lose."',
  '. That is the <b>planned</b> loss if it fills exactly at your stop, before fees. '
  'A stop-market order fills at the next available price, so a gap costs more — 1% past your stop '
  'is about <b>$"+(stop?(riskUSD*(stop+1)/stop).toFixed(2):"—")+"</b>. A stop-limit may not fill at all. '
  'Entry and exit fees are charged on top."', 1),
 # --- 4: an HTTPS page told the visitor its feeds were blocked because it was a file:// page.
 #        A browser fetch failure cannot distinguish CORS from a network fault, so the note now
 #        reports the protocol honestly, dates the snapshot, and offers a retry.
 ('news-note-honest',
  'note&&(note.innerHTML=\'<span style="width:7px;height:7px;border-radius:50%;background:#FFB300;display:inline-block"></span> Live feeds need a real origin — a page opened from <code>file://</code> can\\x27t call them, so this is the built-in snapshot. The hosted build at <a href="https://www.dexladder.com" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline">www.dexladder.com</a> streams live headlines.\')',
  'note&&(note.innerHTML=\'<span style="width:7px;height:7px;border-radius:50%;background:#FFB300;display:inline-block"></span> \'+('
  '"file:"===location.protocol'
  '?"This page was opened straight from your disk (<code>file://</code>), which browsers do not allow to call news feeds. Showing the built-in snapshot, curated July&nbsp;2026. The hosted build at <a href=\\x27https://www.dexladder.com\\x27 target=\\x27_blank\\x27 rel=\\x27noopener\\x27 style=\\x27color:var(--cyan);text-decoration:underline\\x27>www.dexladder.com</a> streams live headlines."'
  ':"Live headlines are unavailable right now, so this is the built-in snapshot, curated July&nbsp;2026. The browser does not tell a page whether a feed was blocked, rate-limited or simply down, so the cause is not known here. <button type=\\x27button\\x27 class=\\x27dl-b\\x27 id=\\x27nxNewsRetry\\x27 onclick=\\x27try{loadNews()}catch(e){}\\x27>Try again</button>"'
  '))', 1),
 # --- 9: www is the canonical, Cloudflare-served host; the apex is a Netlify mirror until the
 #        domain transfer. The share card and canonical must name one host, and og.png must exist.
 ('canon-link', '<link rel="canonical" href="https://dexladder.com/">',
  '<link rel="canonical" href="https://www.dexladder.com/">', 1),
 ('canon-ogurl', 'og:url" content="https://dexladder.com/"', 'og:url" content="https://www.dexladder.com/"', 1),
 ('canon-ogimg', 'og:image" content="https://dexladder.com/og.png"', 'og:image" content="https://www.dexladder.com/og.png"', 1),
 ('canon-twimg', 'twitter:image" content="https://dexladder.com/og.png"', 'twitter:image" content="https://www.dexladder.com/og.png"', 1),
]
for pid, find, rep, n in BCOPY:
    c = out.count(find)
    assert c == n, f'copy patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)
assert 'v150' not in out or out.count('v150') <= 2, 'stale v150 version copy still shipping: %d' % out.count('v150')
print(f"honest copy: version copy from release metadata ({RELEASE['build']} / {RELEASE['updated']}), "
      "stop-loss planned-loss wording, protocol-aware news note, canonical host = www")


# ================================================================== v155-D · service worker: freshness for navigations
# Live-site audit 2026-09-08. The shipped worker served NAVIGATIONS cache-first from the cached
# shell, so a returning visitor with a warm cache kept booting whatever build they first saw —
# the mechanism behind "the live site is ten builds behind" being invisible to returning
# visitors. dist/sw.js is rewritten (network-first navigations with a deadline and a cached-shell
# fallback, res.ok + content-type checked before every put, an explicit TTL and a bounded data
# cache). This patch is the payload half: the worker is no longer allowed to swap under a live
# session, and the page says out loud when a newer build is waiting.
#
# THE STALE-SHELL DEFENCE IS UNTOUCHED AND RE-ASSERTED BELOW:
#   1. no worker on a native scheme or a dev origin  — the capacitor:/localhost branch, verbatim
#   2. the inline head purge with a one-shot session-scoped reload — the cb.swpurged key, verbatim
#   3. a visible build stamp in the UI — #cbBuildTag, untouched
#
# What changes is only the update path. The old code called location.reload() on EVERY
# controllerchange, so a worker that had called skipWaiting() reloaded the page under the user's
# hands mid-session — the exact silent auto-swap the "never auto-swaps" law forbids, and it also
# fired a spurious reload on a visitor's very first load, when claim() first takes control. Now:
# the worker waits, the page shows an honest banner naming the build this tab is still running,
# and only a click posts {dl:'sw-skip-waiting'} and reloads. A swap started in another tab shows
# the banner here too, and never reloads this one.
SWREG_OLD = r'''<script>!function(){try{if(!("serviceWorker"in navigator))return;var native;if("capacitor:"===location.protocol||/^(localhost|127\.0\.0\.1|papertrade\.app)$/.test(location.hostname)){var found=!1;return void navigator.serviceWorker.getRegistrations().then(function(rs){if(rs&&rs.length)return found=!0,Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){if(window.caches&&caches.keys)return caches.keys().then(function(ks){if(ks&&ks.length)return found=!0,Promise.all(ks.map(function(k){return caches.delete(k)}))})}).then(function(){if(found){var k="cb.swpurged";try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,"1")}catch(e){}location.reload()}}).catch(function(){})}if("http:"!==location.protocol&&"https:"!==location.protocol)return;window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})});var _swap=!1;navigator.serviceWorker.addEventListener("controllerchange",function(){if(!_swap){_swap=!0;try{location.reload()}catch(e){}}})}catch(e){}}();</script>'''

SWREG_NEW = r'''<script>!function(){try{if(!("serviceWorker"in navigator))return;if("capacitor:"===location.protocol||/^(localhost|127\.0\.0\.1|papertrade\.app)$/.test(location.hostname)){var found=!1;return void navigator.serviceWorker.getRegistrations().then(function(rs){if(rs&&rs.length)return found=!0,Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){if(window.caches&&caches.keys)return caches.keys().then(function(ks){if(ks&&ks.length)return found=!0,Promise.all(ks.map(function(k){return caches.delete(k)}))})}).then(function(){if(found){var k="cb.swpurged";try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,"1")}catch(e){}location.reload()}}).catch(function(){})}if("http:"!==location.protocol&&"https:"!==location.protocol)return;function rel(){try{location.reload()}catch(e){}}var asked=!1,swapped=!1,had=!!navigator.serviceWorker.controller;function stamp(){try{return(document.querySelector('meta[name="cb:build"]')||{}).content||"this build"}catch(e){return"this build"}}function banner(reg){if(document.getElementById("dlSwUpd"))return;var b=document.createElement("div");b.id="dlSwUpd",b.setAttribute("role","status"),b.style.cssText="position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147482050;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:min(560px,calc(100vw - 24px));padding:11px 14px;border-radius:13px;font:600 13px/1.4 system-ui,-apple-system,sans-serif;background:var(--surface,#101726);color:var(--ink,#E7EDF8);border:1px solid var(--line-2,#2A3A54);box-shadow:0 10px 34px rgba(0,0,0,.5)";var t=document.createElement("span");t.textContent="A newer build of DexLadder is ready. This tab is still running "+stamp()+".";var y=document.createElement("button");y.type="button",y.textContent="Reload to update",y.style.cssText="cursor:pointer;font:700 13px/1 system-ui,sans-serif;padding:9px 13px;border-radius:9px;border:0;background:var(--cyan,#00E5FF);color:var(--bg-solid,#05080E)";var n=document.createElement("button");n.type="button",n.textContent="Later",n.setAttribute("aria-label","Dismiss the update notice"),n.style.cssText="cursor:pointer;font:600 13px/1 system-ui,sans-serif;padding:9px 11px;border-radius:9px;background:none;border:1px solid var(--line-2,#2A3A54);color:var(--ink-2,#AEB9CF)",y.addEventListener("click",function(){asked=!0,y.disabled=!0,y.textContent="Updating\u2026";var w=reg&&reg.waiting;if(!w)return void rel();try{w.postMessage({dl:"sw-skip-waiting"})}catch(e){rel()}}),n.addEventListener("click",function(){try{b.parentNode&&b.parentNode.removeChild(b)}catch(e){}}),b.appendChild(t),b.appendChild(y),b.appendChild(n),(document.body||document.documentElement).appendChild(b)}function watch(reg){if(reg){reg.waiting&&navigator.serviceWorker.controller&&banner(reg);try{reg.addEventListener("updatefound",function(){var w=reg.installing;w&&w.addEventListener("statechange",function(){"installed"===w.state&&navigator.serviceWorker.controller&&banner(reg)})})}catch(e){}}}window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").then(watch).catch(function(){})});navigator.serviceWorker.addEventListener("controllerchange",function(){if(asked)return void(swapped||(swapped=!0,rel()));had&&navigator.serviceWorker.getRegistration().then(function(r){banner(r||null)}).catch(function(){})})}catch(e){}}();</script>'''

_c = out.count(SWREG_OLD)
assert _c == 1, f'sw patch sw-register: expected 1 occurrence, found {_c}'
out = out.replace(SWREG_OLD, SWREG_NEW)

# ---- post-conditions: the defect cannot come back ----
assert 'if(!_swap){_swap=!0;try{location.reload()}catch(e){}}' not in out, \
    'the unconditional controllerchange reload is back — that is a silent mid-session swap'
assert out.count('sw-skip-waiting') == 1, \
    'the update must travel one way only: a click in the page telling the waiting worker to take over'
assert out.count('id="dlSwUpd"') == 1 and out.count('Reload to update') == 1, \
    'the update prompt is missing — a new build must never arrive without a visible, honest signal'
assert out.count('A newer build of DexLadder is ready') == 1, 'the prompt no longer names what happened'
# ---- stale-shell defence, three layers, none removable ----
assert out.count('"capacitor:"===location.protocol') == 1 and \
       out.count(r'/^(localhost|127\.0\.0\.1|papertrade\.app)$/.test(location.hostname)') == 1, \
    'defence 1 gone: a worker could now be registered on a native scheme or a dev origin'
assert out.count('"cb.swpurged"') == 1 and out.count('sessionStorage.setItem(k,"1")') == 1, \
    'defence 2 gone: the inline purge no longer has its one-shot session-scoped reload'
assert out.count('id="cbBuildTag"') == 1, 'defence 3 gone: the visible build stamp is not in the UI'
print('service worker: navigations network-first (payload half) — waiting worker + honest prompt, '
      'no unconditional controllerchange reload; 3 stale-shell defences re-asserted')


# ================================================================== v155-C · LAYOUT
# Measured layout audit, Chromium 1440x900 against test/harness.js. Five defects, all of
# them the same law broken: NO ORPHAN VOIDS. The three that live in the canonical payload
# are patched here (count-asserted); the three that are pure geometry live in
# layers/v154.css and layers/zzz-columns.js, and test/gate154.js measures the result.

# the geometry half of this block lives in layers/v154.css; read it here so the asserts below
# can prove the CSS side is still present, not just the payload side.
css_pre = open(os.path.join(ROOT, 'layers', 'v154.css'), encoding='utf-8').read()

# --- L1: the markets rail header duplicated itself ------------------------------------
# ensureHead() guarded only "is my immediate previous sibling already a rail header".
# mountHeat() then does insertBefore(#dlHeat, mxMoversHost) — it slides the heatmap in
# BETWEEN the header and the host it labels. The old header is now stranded in front of
# the heatmap (mislabelling it "Top movers · 24h"), the guard no longer sees a header
# before the host, and a second one is minted. Result: the same uppercase band label
# rendered three times on one page — twice by this function, once by #mxGL2 below.
# The fix stamps each header with the id of the host it belongs to, so a stranded header
# is identifiable and is removed before a replacement is made. One header per host, always.
# Stranded headers are looked up DOCUMENT-wide, not in the host's parent: the column layers
# move the host into another parent, and a header left in the old parent was never found —
# a second one was minted beside the host (gate154's intermittent "x2" on Markets).
RAILHEAD_OLD = ('function ensureHead(host,txt){if(host){var prev=host.previousElementSibling;'
                'if(!(prev&&prev.classList&&prev.classList.contains("mx-rail-h"))){'
                'var h=document.createElement("div");h.className="mx-rail-h",h.textContent=txt,'
                'host.parentNode.insertBefore(h,host)}}}')
RAILHEAD_NEW = ('function ensureHead(host,txt){if(!host||!host.parentNode)return;'
                'var p=host.parentNode,q=document.querySelectorAll(\'.mx-rail-h[data-for="\'+host.id+\'"]\'),i;'
                'for(i=0;i<q.length;i++)if(q[i].nextElementSibling!==host&&q[i].parentNode)'
                'q[i].parentNode.removeChild(q[i]);'
                'var prev=host.previousElementSibling;'
                'if(prev&&prev.classList&&prev.classList.contains("mx-rail-h")){'
                'prev.setAttribute("data-for",host.id);if(prev.textContent!==txt)prev.textContent=txt;return}'
                'var h=document.createElement("div");h.className="mx-rail-h";'
                'h.setAttribute("data-for",host.id);h.textContent=txt;p.insertBefore(h,host)}')

# --- L2/L3: three bands, one label ----------------------------------------------------
# Investigated from the code, not from the screen. The three bands are NOT three renders
# of one thing — two of them are genuinely different cuts and one was the stranded header
# above. #mxGL2 reads C() (the global `coins` array: top 30 by market cap), drops the
# stablecoins and shows the best three and worst three. moversStrip() reads MX.coins —
# the whole loaded ladder, 500 deep — and shows the best four and worst four. Same idea,
# different universes, and the shared label made them look like a duplicate render.
# So: keep both, name each one after the universe it actually reads.
LAYOUT = [
 ('lay-railhead-dedupe', RAILHEAD_OLD, RAILHEAD_NEW, 1),
 # the full-ladder strip (moversStrip -> MX.coins, 500 coins)
 ('lay-movers-label', 'ensureHead(mv,"Top movers · 24h")',
  'ensureHead(mv,"Biggest 24h moves · whole ladder")', 1),
 # the top-30 leaderboard (#mxGL2 -> C() -> the 30-coin `coins` array)
 ('lay-gl2-label', '<div class="mx-ph">Top movers · 24h</div><div class="gl-h">Gainers</div>',
  '<div class="mx-ph">Top 30 · gainers &amp; losers</div><div class="gl-h">Gainers</div>', 1),

 # --- L4: the heatmap could ship as a blank 426px frame ------------------------------
 # drawHeat() returns silently when `coins` is empty and when the canvas has no box, and
 # the first paint was hung on an IntersectionObserver watching the CANVAS, which fires
 # once and disconnects. Before that observer fires — and forever, if the ladder never
 # loads — #dlHeat is a full-width panel of chrome around an empty canvas. The project's
 # law is that missing data says "Unavailable"; it never renders blank. The panel now
 # carries an explicit data-heat state, and layers/v154.css swaps the canvas for an
 # honest "Unavailable" note whenever that state is not "ok".
 ('lay-heat-state',
  'function drawHeat(){var cv=$("dlHeatCv");if(cv){var cs=null;try{cs="undefined"!=typeof coins&&coins&&coins.length?coins:null}catch(e){}if(cs){'
  'var dpr=Math.min(window.devicePixelRatio||1,2),W=cv.clientWidth,H=cv.clientHeight;if(W&&H){',
  'function heatState(s){try{var b=$("dlHeat");if(b)b.setAttribute("data-heat",s)}catch(e){}}'
  'function drawHeat(){var cv=$("dlHeatCv");if(cv){var cs=null;try{cs="undefined"!=typeof coins&&coins&&coins.length?coins:null}catch(e){}'
  'if(!cs){heatState("empty");return}if(cs){heatState("ok");'
  'var dpr=Math.min(window.devicePixelRatio||1,2),W=cv.clientWidth,H=cv.clientHeight;if(!W||!H){heatState("empty");return}if(W&&H){', 1),
 # the panel is born unavailable and earns "ok" by drawing; the honest note ships with it
 ('lay-heat-mount',
  'box.id="dlHeat",box.innerHTML=\'<div class="hh"><span class="t">🗺 Market Heatmap</span>'
  '<button id="dlHeatR" type="button">↻ Refresh</button></div><canvas id="dlHeatCv"></canvas>',
  'box.id="dlHeat",box.setAttribute("data-heat","empty"),box.innerHTML=\'<div class="hh"><span class="t">🗺 Market Heatmap</span>'
  '<button id="dlHeatR" type="button">↻ Refresh</button></div><canvas id="dlHeatCv"></canvas>'
  '<div class="hx" role="status">Unavailable — no ladder data to map right now.</div>', 1),
 # watch the panel, not the canvas: the canvas is display:none while the state is not "ok",
 # and an IntersectionObserver on a display:none element never fires at all.
 ('lay-heat-io', '{threshold:.1});io.observe(cv)}', '{threshold:.1});io.observe(box)}', 1),

 # --- L6: mountCycle assumed two nodes shared a parent ------------------------------
 # It inserts #dlCycle before `document.querySelector(".mx-rail-h")` — the FIRST rail
 # header anywhere in the document — using mxMoversHost's parent as the container. That
 # only ever worked because every band was a direct child of #mktpro. The moment any
 # band lives one level down (the two-up column pass does exactly that) the reference
 # node belongs to a different parent and insertBefore throws NotFoundError, killing
 # the rest of mountLaunchers with it. Insert relative to a node that is actually a
 # sibling, or relative to the host itself.
 ('lay-cycle-sibling',
  'var head=document.querySelector(".mx-rail-h");host.parentNode.insertBefore(box,head||host)',
  'var head=document.querySelector(".mx-rail-h");'
  'if(!head||head.parentNode!==host.parentNode)head=host;'
  'host.parentNode.insertBefore(box,head)', 1),
]
for pid, find, rep, n in LAYOUT:
    c = out.count(find)
    out = out.replace(find, rep)
    assert c == n, f'layout patch {pid}: expected {n} occurrence(s), found {c}'

# ---- post-conditions: none of these defects can come back ----
# one header per host, and the stranded-header path is gone for good
assert 'if(!(prev&&prev.classList&&prev.classList.contains("mx-rail-h"))){' not in out, \
    'the rail header is minted on the old sibling-only guard again — a stranded header will duplicate it'
assert out.count('.mx-rail-h[data-for="') == 1 and out.count('h.setAttribute("data-for",host.id)') == 1, \
    'the rail header no longer records which host it labels, so a stranded one cannot be found'
# no two band labels may read the same
assert out.count('Top movers · 24h') == 0, \
    'the shared "Top movers · 24h" label is back — two different cuts of the data would read as one'
assert out.count('Biggest 24h moves · whole ladder') == 1 and out.count('Top 30 · gainers &amp; losers') == 1, \
    'the two movers bands are no longer named after the universe each of them reads'
# the heatmap can never ship as a blank frame again
assert out.count('function heatState(s)') == 1 and out.count('heatState("empty")') == 2 and out.count('heatState("ok")') == 1, \
    'the heatmap no longer reports whether it drew anything'
# the lens half of the same panel (layers/39b-ledgers.js) states it too — no data, no blank frame
_lens = open(os.path.join(ROOT, 'layers', '39b-ledgers.js'), encoding='utf-8').read()
assert _lens.count('function heatState(s)') == 1 and _lens.count('heatState("empty")') >= 5, \
    'the heatmap lenses no longer declare an empty state — an empty lens would paint nothing'
assert 'window.DLHEATX = { paint: lensPaint }' in _lens, \
    'the heatmap repaint is no longer reachable, so a re-columned canvas would ship stretched'
assert 'box.setAttribute("data-heat","empty")' in out, 'the heatmap does not start in the unavailable state'
assert out.count('class="hx" role="status">Unavailable') == 1, \
    'the heatmap has no honest empty state — a blank canvas would ship instead'
assert 'var head=document.querySelector(".mx-rail-h");host.parentNode.insertBefore(box,head||host)' not in out, \
    'mountCycle inserts against a node that need not be its sibling again — that throws the moment a band is nested'
assert out.count('if(!head||head.parentNode!==host.parentNode)head=host') == 1, \
    'mountCycle no longer checks that its reference node is a sibling'
assert 'io.observe(cv)}' not in out, \
    'the first heatmap paint is hung on the canvas again — it is display:none until it draws, so it would never fire'
assert '#dlHeat:not([data-heat="ok"]) #dlHeatCv{display:none}' in css_pre, \
    'layers/v154.css does not hide the canvas while the heatmap has nothing to draw'
assert '#dlHeat:not([data-heat="ok"]) .hx{' in css_pre, \
    'layers/v154.css never shows the heatmap Unavailable note'

# --- L5: the footer spacer — one cause, eight views ---------------------------------
# Every view ended in ~560-610px of document that carried no surface at all. It is not a
# min-height and it is not eight mistakes: it is one rule. `footer{padding:26px 0 112px}`
# reserves a landing strip for #nxbn, the FIXED bottom nav — which only exists at
# max-width:640px. Above that the nav is display:none and the 112px is pure void, on
# every view, forever. And the footer itself painted no surface, so its 379px of real
# content read as void too. layers/v154.css gives the footer a surface and trims the
# spacer to the width that actually needs it. Asserted here so it cannot drift back.
assert 'footer{display:none}' not in out
assert '#nxbn{display:none}' in out and '@media(max-width:640px){#nxbn{display:block' in out, \
    'the bottom nav is no longer a <=640px-only element, so the footer spacer may be load-bearing again'
assert 'padding:26px 0 calc(112px + env(safe-area-inset-bottom))!important' in out, \
    'the footer spacer moved — the desktop override in layers/v154.css is now aimed at nothing'
assert '@media (min-width:641px){footer{' in css_pre, \
    'layers/v154.css no longer trims the footer spacer above the bottom-nav breakpoint'

print('layout: rail headers de-duplicated and each movers band named after its own universe, '
      'heatmap has an honest Unavailable state, footer spacer scoped to the bottom-nav breakpoint')


# ================================================================== v155-E · uncertainty, shown
# A live run against the real upstreams exposed five defects that mocked fixtures could not
# reveal, because a fixture never disagrees with itself and never paints twice at two instants.
#
#   E1  the quorum disagreement was computed and never shown. CoinGecko said the whole market
#       traded $88.52B in 24h; Coinpaprika said $176.07B. The snapshot computed
#       quorum:"disagree", stored both witnesses, and the screen printed the median $132.29B —
#       a number NEITHER provider reported — under a plain green "live" chip with a
#       "3/3 witnesses ✓" tick beside it.
#   E2  the freshness chip baked its age into innerHTML at paint time, so one instant showed
#       four different ages for one snapshot. (Layer half: layers/20-core.js.)
#   E3  one strip, two witness sets: a CoinGecko-only BTC dominance beside a CG/Paprika median
#       market cap, under one chip naming both. (Layer half: layers/21-snapshot.js.)
#   E4  the tracked 24h volume exceeded the whole-market one. (Layer half: 21-snapshot.js.)
#   E5  the loading state mislabelled its own universe. (Layer half: 21-snapshot.js.)
#
# The layer halves are asserted at the bottom of this block and again, at runtime, by
# test/gate154.js. What follows is the payload half: the surfaces the layers cannot reach.
HONEST2 = [

 # --- E1a · the feed chip's witness tick. quorumTag() reported ONLY the per-coin PRICE
 #     quorum and printed a green ✓ whenever those agreed — beside a global 24h volume whose
 #     two witnesses were 1.99x apart. A tick that means "prices agree" must not be read as
 #     "everything on this screen agrees", so the tag now also answers for the canonical
 #     market figures and cannot show ✓ while any of them is contested.
 ('hon2-quorumtag',
  'function quorumTag(){if(!QUOR.t||Date.now()-QUOR.t>24e4)return"";const n=void 0,worst=void 0;'
  'return" · "+(1+(QUOR.src.binance?1:0)+(QUOR.src.cryptocompare?1:0))+"/3 witnesses"'
  '+(QUOR.rows.reduce((m,r)=>Math.max(m,r.dev),0)>1.5?" ⚠":" ✓")}',
  'function quorumTag(){if(!QUOR.t||Date.now()-QUOR.t>24e4)return"";const n=void 0,worst=void 0;'
  'let gdis=[];try{gdis=window.DLSNAP?DLSNAP.disagreements():[]}catch(_e){}'
  'const pdis=QUOR.rows.reduce((m,r)=>Math.max(m,r.dev),0)>1.5;'
  'return" · "+(1+(QUOR.src.binance?1:0)+(QUOR.src.cryptocompare?1:0))+"/3 witnesses"'
  '+(pdis||gdis.length?" ⚠":" ✓")'
  '+(gdis.length?" · "+gdis.length+" market figure"+(1===gdis.length?"":"s")+" contested":"")}', 1),

 # --- E1b/E2 · the tape. It renders the whole-market cap and BTC dominance from G, which the
 #     snapshot refills every cycle, but it printed them bare: no disagreement mark, and its
 #     freshness class was frozen at paint with no timestamp for provRefresh() to re-derive
 #     from. data-at puts it on the one shared clock with every other chip.
 ('hon2-tape',
  'if(G.mcap&&(s+=\'<span class="ti dl-prov \'+(_gf||"stale")+\'">MCAP <b class="stat">\'+cUSD(G.mcap)'
  '+\'</b> <span class="gs-u">whole market</span></span>\'),'
  'G.dom&&(s+=\'<span class="ti">BTC.D <b class="stat">\'+G.dom.toFixed(1)+"%</b></span>"),',
  'if(G.mcap&&(s+=\'<span class="ti dl-prov \'+(_gf||"stale")+\'" data-at="\''
  '+(window.DLSNAP?DLSNAP.get("universes.global.marketCap").servedAt||0:0)+\'"\''
  '+(window.DLSNAP&&DLSNAP.contested(DLSNAP.get("universes.global.marketCap"))?\' data-contested="1"\':"")'
  '+\'>MCAP <b class="stat">\'+cUSD(G.mcap)'
  '+"</b>"+(window.DLSNAP?DLSNAP.mark("universes.global.marketCap","market cap"):"")'
  '+\' <span class="gs-u">whole market</span></span>\'),'
  'G.dom&&(s+=\'<span class="ti">BTC.D <b class="stat">\'+G.dom.toFixed(1)+"%</b>"'
  '+(window.DLSNAP?DLSNAP.mark("universes.global.dominance.BTC","BTC dominance"):"")+"</span>"),', 1),

 # --- N1 · /api/news. Every host answers HTTP 200 text/html with the 2.5 MB SPA shell.
 #     apiFetch already refused to PARSE it — but it left the body unread, so the browser
 #     downloaded all 2.5 MB anyway, once per host, three times, on every pull: 7.78 MB of
 #     nothing. The endpoint is a deploy-side problem this build cannot fix; the CLIENT's
 #     honesty is that it must not pay for the same wrong answer twice. accept:application/json
 #     states what is wanted, cancel() drops the body at the first header that says otherwise,
 #     and a host that serves a page instead of the API is not asked again this session.
 ('hon2-news-noapi', 'var HKEY="dl.apihost.v1";', 'var HKEY="dl.apihost.v1",NOAPI={};', 1),
 ('hon2-news-apifetch',
  '  async function apiFetch(path){\n'
  '    var hs=hosts();\n'
  '    for(var i=0;i<hs.length;i++){\n'
  '      var h=hs[i];\n'
  '      try{\n'
  '        var res=await fetch(h+path,{signal:(window.AbortSignal&&AbortSignal.timeout)?AbortSignal.timeout(9000):void 0});\n'
  '        if(!res.ok)continue;\n'
  '        var ct=(res.headers.get("content-type")||"");\n'
  '        if(ct.indexOf("json")<0)continue; /* HTML = SPA fallthrough, not the API */\n'
  '        var j=await res.json();\n',
  '  function drop(res){try{res&&res.body&&res.body.cancel()}catch(e){}}\n'
  '  async function apiFetch(path){\n'
  '    var hs=hosts();\n'
  '    for(var i=0;i<hs.length;i++){\n'
  '      var h=hs[i];\n'
  '      if(NOAPI[h])continue; /* already answered with a page, not an API */\n'
  '      try{\n'
  '        var res=await fetch(h+path,{headers:{accept:"application/json"},signal:(window.AbortSignal&&AbortSignal.timeout)?AbortSignal.timeout(9000):void 0});\n'
  '        if(!res.ok){drop(res);continue}\n'
  '        var ct=(res.headers.get("content-type")||"");\n'
  '        if(ct.indexOf("json")<0){NOAPI[h]=1;drop(res);continue} /* HTML = SPA fallthrough: drop the body unread and retire the host */\n'
  '        var j=await res.json();\n', 1),

 # --- I1 · coin icons. 58 of 147 requests 404 from an UNPINNED jsdelivr @master path.
 #     The letter-glyph fallback IS reached and is clean (icon() chains logo -> CDN -> glyph,
 #     upgradeIcons leaves the glyph in place on error), so nothing renders wrong — but the
 #     ref is a moving branch, and the same 34 missing symbols were re-requested on every
 #     repaint. @0.18.1 is the newest tag and was verified to serve byte-identical answers for
 #     both the symbols the set has and the ones it does not. A symbol that 404s once is not
 #     asked for again this session, and icon() emits the glyph for it directly.
 ('hon2-icon-pin',
  'function logoURL(sym){return"https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/"+String(sym||"").toLowerCase()+".png"}',
  'var ICO404=window.__ICO404||(window.__ICO404={});'
  'function icoDead(sym){return!!ICO404[String(sym||"").toLowerCase()]}'
  'window.__icoFail=function(sym){ICO404[String(sym||"").toLowerCase()]=1};'
  'function logoURL(sym){return"https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@0.18.1/128/color/"+String(sym||"").toLowerCase()+".png"}', 1),
 ('hon2-icon-upgrade',
  'if((sym||!(t.length<=1))&&sym){el.dataset.lg="1";var img=new Image;img.alt="",img.loading="lazy",'
  'img.onload=function(){el.textContent="",el.style.background="transparent",el.appendChild(img)},'
  'img.onerror=function(){},img.src=logoURL(sym)}',
  'if((sym||!(t.length<=1))&&sym&&!icoDead(sym)){el.dataset.lg="1";var img=new Image;img.alt="",img.loading="lazy",'
  'img.onload=function(){el.textContent="",el.style.background="transparent",el.appendChild(img)},'
  'img.onerror=function(){window.__icoFail(sym)},img.src=logoURL(sym)}', 1),
 ('hon2-icon-guard',
  'window.icon=function(c,s){var st="width:"+(s=s||30)+"px;height:"+s+"px;font-size:"+Math.round(.42*s)+"px",'
  'primary=c.logo||logoURL(c.sym),',
  'window.icon=function(c,s){var st="width:"+(s=s||30)+"px;height:"+s+"px;font-size:"+Math.round(.42*s)+"px";'
  'if(!c.logo&&icoDead(c.sym))'
  'return\'<span class="coin-ic" style="\'+st+";background:"+(c.color||"#5B7CFF")+\';color:#fff">\'+(c.glyph||"?")+"</span>";'
  'var primary=c.logo||logoURL(c.sym),', 1),
 ('hon2-icon-record',
  'if(this.dataset.f){this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1}',
  'if(this.dataset.f){window.__icoFail&&window.__icoFail(\'"+(c.sym||"")+"\');'
  'this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1}', 1),
 # --- I2 · and the letter-glyph fallback that finding assumed was reached is DEAD CODE.
 #     The handler is  onerror="<fb>if(this.dataset.f){...glyph...}else{this.dataset.f=1}"  and
 #     there is no path through it that reaches the glyph:
 #       c.logo set     -> fb runs FIRST and sets this.onerror=null before swapping the src, so
 #                         the second failure fires nothing at all;
 #       c.logo absent  -> fb is "", so the first failure only sets dataset.f and never retries.
 #     Either way a 404 icon leaves an empty circle, and window.__icoFail is never called from
 #     the path that renders every table row — which is why the negative cache above barely bit.
 #     Flipping the two branches fixes both: a logo-less img is BORN with data-f, so its first
 #     failure takes the glyph branch and records the symbol; a logo-bearing img swaps to the CDN
 #     inside the else branch WITHOUT nulling its own handler, so its second failure lands there
 #     too. Same two attempts as before, and now they end somewhere.
 ('hon2-icon-fallback',
  'var primary=c.logo||logoURL(c.sym),fb=c.logo?"this.onerror=null;this.src=\'"+logoURL(c.sym)+"\';":"";'
  'return\'<span class="coin-ic" style="\'+st+\'"><img src="\'+primary+\'" alt="" loading="lazy" onerror="\'+'
  '(fb?fb.replace(/"/g,"&quot;"):"")+'
  '"if(this.dataset.f){window.__icoFail&&window.__icoFail(\'"+(c.sym||"")+"\');'
  'this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1}\\"></span>"',
  'var primary=c.logo||logoURL(c.sym),fb=c.logo?"this.src=\'"+logoURL(c.sym)+"\';":"";'
  'return\'<span class="coin-ic" style="\'+st+\'"><img src="\'+primary+\'" alt="" loading="lazy"\'+'
  '(c.logo?"":\' data-f="1"\')+\' onerror="\'+'
  '"if(this.dataset.f){window.__icoFail&&window.__icoFail(\'"+(c.sym||"")+"\');'
  'this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1;"+fb+"}\\"></span>"', 1),
 # --- I3 · and now that the glyph is actually rendered, it needs a foreground it can be read
 #     against. Every glyph site paired `background: <the coin's own brand colour>` with a
 #     hard-coded `color:#fff`, and a brand palette spans the whole hue range: white lands at
 #     3.64 on #5B7CFF, 3.25 on #26A17B and 2.57 on #98A1BC in Day. The backdrop is chosen per
 #     coin at runtime, so no token and no static substitution can answer for it — the
 #     foreground has to be computed from the backdrop. icoFg() does exactly that (WCAG
 #     relative luminance) and every glyph site is routed through it. The pivot is the exact
 #     crossover where white and black tie, L = 0.1791, and the two ends are pure #FFFFFF and
 #     #000000 — at any other pair the worst backdrop (one sitting ON the crossover) tops out
 #     at 4.14 and fails AA. With these two it can never drop below 4.58, for any hue.
 ('hon2-icofg-def',
  'function icon(c,s){const st=`width:${s=s||30}px;height:${s}px;font-size:${Math.round(.42*s)}px`;',
  'function icoFg(h){h=String(h||"#5B7CFF").replace("#","");if(3===h.length)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];'
  'var f=function(v){v=parseInt(v,16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)},'
  'L=.2126*f(h.slice(0,2))+.7152*f(h.slice(2,4))+.0722*f(h.slice(4,6));return L>.1791?"#000000":"#FFFFFF"}'
  'function icon(c,s){const st=`width:${s=s||30}px;height:${s}px;font-size:${Math.round(.42*s)}px`;', 1),
 ('hon2-icofg-base',
  'return c.logo?`<span class="coin-ic" style="${st}"><img src="${c.logo}" alt="" loading="lazy" '
  'onerror="this.parentNode.style.background=\'${c.color}\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'${c.glyph}\'))"></span>`:'
  '`<span class="coin-ic" style="${st};background:${c.color};color:#fff">${c.glyph}</span>`}',
  'return c.logo?`<span class="coin-ic" style="${st}"><img src="${c.logo}" alt="" loading="lazy" '
  'onerror="this.parentNode.style.background=\'${c.color}\';this.parentNode.style.color=\'${icoFg(c.color)}\';'
  'this.replaceWith(document.createTextNode(\'${c.glyph}\'))"></span>`:'
  '`<span class="coin-ic" style="${st};background:${c.color};color:${icoFg(c.color)}">${c.glyph}</span>`}', 1),
 ('hon2-icofg-coinicon',
  'return c.logo?\'<span class="coin-ic" style="\'+st+\'"><img src="\'+esc(c.logo)+\'" alt="" loading="lazy" '
  'onerror="this.parentNode.style.background=\\\'\'+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+esc(c.glyph||"?")+"\'))\\"></span>":'
  '\'<span class="coin-ic" style="\'+st+";background:"+(c.color||"#5B7CFF")+\';color:#fff">\'+esc(c.glyph||"?")+"</span>"}',
  'return c.logo?\'<span class="coin-ic" style="\'+st+\'"><img src="\'+esc(c.logo)+\'" alt="" loading="lazy" '
  'onerror="this.parentNode.style.background=\\\'\'+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'"+icoFg(c.color)+"\';'
  'this.replaceWith(document.createTextNode(\'"+esc(c.glyph||"?")+"\'))\\"></span>":'
  '\'<span class="coin-ic" style="\'+st+";background:"+(c.color||"#5B7CFF")+";color:"+icoFg(c.color)+\'">\'+esc(c.glyph||"?")+"</span>"}', 1),
 ('hon2-icofg-cmc-dead',
  'if(!c.logo&&icoDead(c.sym))return\'<span class="coin-ic" style="\'+st+";background:"+(c.color||"#5B7CFF")+\';color:#fff">\'+(c.glyph||"?")+"</span>";',
  'if(!c.logo&&icoDead(c.sym))return\'<span class="coin-ic" style="\'+st+";background:"+(c.color||"#5B7CFF")+";color:"+icoFg(c.color)+\'">\'+(c.glyph||"?")+"</span>";', 1),
 ('hon2-icofg-cmc-err',
  'this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'#fff\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1;"+fb+"}',
  'this.parentNode.style.background=\'"+(c.color||"#5B7CFF")+"\';this.parentNode.style.color=\'"+icoFg(c.color)+"\';'
  'this.replaceWith(document.createTextNode(\'"+(c.glyph||"?")+"\'))}else{this.dataset.f=1;"+fb+"}', 1),
]
for pid, find, rep, n in HONEST2:
    c = out.count(find)
    assert c == n, f'honesty2 patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

# ---- post-conditions: none of the five can come back ----------------------------------
# E1 · the tick can no longer say "ok" while a canonical figure is contested
assert out.count('DLSNAP.disagreements()') == 1, \
    'the feed witness tick no longer consults the canonical figures'
assert '(QUOR.rows.reduce((m,r)=>Math.max(m,r.dev),0)>1.5?" ⚠":" ✓")' not in out, \
    'quorumTag decides its tick from the PRICE rows alone again'
assert out.count('" market figure"') == 1, \
    'the feed chip no longer names how many market figures are contested'
# E1b/E2 · the tape marks a contested figure and is on the one shared clock
assert out.count('DLSNAP.mark("universes.global.marketCap","market cap")') == 1 and \
       out.count('DLSNAP.mark("universes.global.dominance.BTC","BTC dominance")') == 1, \
    'the tape prints the whole-market median with no disagreement mark again'
assert out.count('class="ti dl-prov \'+(_gf||"stale")+\'" data-at=') == 1, \
    'the tape chip carries no timestamp, so its freshness is frozen at paint again'
assert out.count('DLSNAP.contested(DLSNAP.get("universes.global.marketCap"))') == 1, \
    'the tape chip would keep its clean green dot over a contested figure'
# N1 · the news client cannot download a 2.5MB page three times for nothing
assert out.count('if(NOAPI[h])continue;') == 1 and out.count('NOAPI[h]=1;drop(res);continue}') == 1, \
    'apiFetch will retry a host that already answered with the SPA shell'
assert out.count('function drop(res){') == 1 and out.count('if(!res.ok){drop(res);continue}') == 1, \
    'apiFetch leaves the body of a rejected response to download in full again'
assert out.count('fetch(h+path,{headers:{accept:"application/json"}') == 1, \
    'apiFetch no longer states that it wants JSON'
assert 'var res=await fetch(h+path,{signal:' not in out, 'the old unqualified apiFetch request is back'
# I1 · the icon path is pinned and remembers what is not there
assert 'cryptocurrency-icons@master' not in out, 'the coin-icon CDN ref is an unpinned branch again'
assert out.count('cryptocurrency-icons@0.18.1') == 1, 'the coin-icon CDN ref is not pinned to one tag'
assert out.count('window.__icoFail') == 4 and out.count('icoDead(') == 3, \
    'a coin icon that 404s is not recorded, so the same missing symbol is re-requested every repaint'
assert out.count('!icoDead(sym)') == 1, 'upgradeIcons asks for a symbol it already knows is missing'
assert 'fb=c.logo?"this.onerror=null;this.src=' not in out, \
    "icon()'s first fallback kills its own error handler again, so the letter glyph is unreachable"
assert out.count('(c.logo?"":\' data-f="1"\')') == 1, \
    'a logo-less coin icon no longer takes the glyph branch on its first failure — a 404 would leave an empty circle'
assert out.count('this.dataset.f=1;"+fb+"}') == 1, \
    'the CDN retry is no longer inside the else branch, so the second failure has nowhere to land'
assert out.count('function icoFg(h)') == 1, 'the glyph foreground is not computed from its backdrop'
assert out.count('color:#fff">') == 0 and out.count("style.color='#fff'") == 0, \
    'a coin glyph still assumes white reads on the coin brand colour behind it: %d static sites' % (
        out.count('color:#fff">') + out.count("style.color='#fff'"))
assert out.count('icoFg(c.color)') == 6, 'not every glyph site takes its foreground from its backdrop'

# ---- the layer halves. layers/*.js are appended after every assert in this file runs, so
#      they are read from disk here and guarded again, at runtime, by test/gate154.js. -----
_core = open(os.path.join(ROOT, 'layers', '20-core.js'), encoding='utf-8').read()
assert _core.count('var PROV = { now: 0 };') == 1 and _core.count('function provRefresh()') == 1, \
    'the provenance chip has no shared clock — two surfaces can print two ages for one timestamp again'
assert _core.count('age < 6e4 ? "live"') == 1, \
    'the live/recent/stale thresholds are stated more than once in the core layer'
assert '\'<span class="dl-prov \' + cls + \'" title=' not in _core, \
    'DLCORE.prov bakes the age into innerHTML at paint time again'
assert _core.count('data-at="') == 1 and _core.count('provAge(at)') == 3, \
    'the chip no longer carries the timestamp its age is derived from'
_pw = _core[_core.index('var PROV = { now: 0 };'):_core.index('function coinsAll')]
assert not re.search(r'setInterval|requestAnimationFrame|new\s+(Mutation|Intersection|Resize)Observer\b', _pw), \
    'the freshness refresh added a timer or an observer — it must ride the paths that already run'

_snap = open(os.path.join(ROOT, 'layers', '21-snapshot.js'), encoding='utf-8').read()
assert _snap.count('function contested(f)') == 1 and _snap.count('function witText(') == 1 \
   and _snap.count('function dis(f, what)') == 1 and _snap.count('function disagreements()') == 1, \
    'the snapshot computes a disagreement it cannot render'
assert _snap.count('dis(') >= 12, 'a contested figure is not marked at every point of display'
# v159 · 5 -> 4: the removed record strip carried one of the five call sites.
assert _snap.count('function provStrip(') == 1 and _snap.count('provStrip(') == 4, \
    'a strip chip no longer answers for every figure under it'
assert _snap.count('function subsetCheck(') == 1 and _snap.count('function flag(kind)') == 1 \
   and _snap.count('flag("volume")') == 3, \
    'a tracked figure that exceeds its whole-market superset is rendered without saying so'
assert _snap.count('function srcNote(') == 1 and _snap.count('srcNote(') >= 6, \
    'a figure witnessed differently from the chip above it no longer names its own source'
assert 'var btcR = W([cg && wit(cg.source, cg.btcPct, cg.at, 1), pp && wit(pp.source, pp.btcPct, pp.at, 1)]);' in _snap, \
    'BTC dominance is a single-witness figure again while the market cap beside it is a two-witness median'
# (arch-1: the witness constructor moved, typed and parity-tested, to web/app/src/lib/snapshot/field.ts;
#  the layer's wit() delegates to it — the guard follows the rule to where it now lives)
_snapcore = open(os.path.join(ROOT, 'app', 'src', 'lib', 'snapshot', 'field.ts'), encoding='utf-8').read()
assert _snap.count('function wit(src, v, at, positive) { return SN.wit(src, v, at, positive); }') == 1 and _snapcore.count('if (positive && +(v as number) <= 0) return null;') == 1, \
    'a provider answering 0 for a quantity that cannot be zero is voted as an observation again'
assert _snap.count('at, 1)') == 7 and _snap.count('cg.chg, cg.at, 0)') == 1 and _snap.count('pp.chg, pp.at, 0)') == 1, \
    'the zero guard is not applied per figure — a 24h change of zero is a real reading and must keep its 0'
assert _snap.count('                                    : "no source";') == 1, \
    'a whole-market figure with no witness borrows the name of a provider that answered about '\
    'something else — the record would name a source that never reported it'
assert 'if (!o) return field(null, "loading", { universe: u });' in _snap, \
    'a loading field falls back to the global universe label again'
assert _snap.count('gs[i].outerHTML = mxPanel();') == 1, \
    'repaint() does not cover .mx-glob — it would hold its cold-load state for a whole cycle'
assert _snap.count('function paintPulse()') == 1 and _snap.count('paintPulse();') == 2, \
    'the News pulse fetches and paints in one function again — it would keep whichever snapshot '\
    'was current when the desk was last opened while every other surface moved on'
assert _snap.count('C.provRefresh();') == 2, \
    'the chips are not re-derived from the shared clock on the paths that already run'
assert 'dl-prov\\s+(live|recent|stale)' not in _snap, \
    'freshness() parses a class out of rendered HTML again instead of reading the decision'
assert not re.search(r'setInterval\(|requestAnimationFrame\(|new\s+(Mutation|Intersection|Resize)Observer\b', _snap), \
    'the snapshot layer added a timer, loop or observer'

# --- P1 · Polymarket asked for 60 events (7.14 MB in ONE request) and rendered at most 30.
_odds = open(os.path.join(ROOT, 'layers', '36-odds.js'), encoding='utf-8').read()
assert 'limit=60' not in _odds, 'the odds board asks for twice the events it can render'
assert _odds.count('&limit=30') == 1 and _odds.count('list.slice(0, 30)') == 1, \
    'the odds request and the odds render disagree about how many events there are'

# --- P2 · both RSS CORS proxies returned 522 after ~19.6s. The client deadline must be short
#          and the failure must degrade to a labelled empty state, not a hang. Unchanged
#          behaviour, asserted so it cannot drift.
assert out.count('for(const px of PROXIES)try{const res=await fetch(px(feed.url),{headers:{},signal:window.AbortSignal&&AbortSignal.timeout?AbortSignal.timeout(6e3):void 0})') == 1, \
    'the RSS proxy path lost its short (6s) client-side deadline — a 19.6s upstream hang would reach the user'
assert out.count('No headlines loaded yet') >= 1, \
    'a dead news transport no longer degrades to a labelled empty state'

_css2 = open(os.path.join(ROOT, 'layers', 'v154.css'), encoding='utf-8').read()
assert '.dl-prov.contested{color:var(--down)}' in _css2 and '.dl-dis,.dl-flag{' in _css2, \
    'a contested chip has no styling of its own — it would render as clean agreement'
assert 'var(--down-soft)' in _css2 and 'var(--surface-2)' in _css2, \
    'the contested marks left the token system'

print('uncertainty shown: quorum disagreement rendered at every point of display, one shared clock '
      'for every freshness chip, per-figure witness ledgers, subset containment flagged, loading '
      'state named after its own universe; news client cancels a non-JSON body and retires the '
      'host, coin-icon CDN pinned to @0.18.1 with a negative cache, odds request halved to 30')


# ================================================================== v155-F · the token that had no Day value
# SHIP BLOCKER. `--txt-1` — the PRIMARY text token — was declared exactly once, on :root,
# with the Night value #F2F5FA. The Day palette block redefines --txt-3, and layers/v154.css
# re-points --txt-2 at --ink-2, but nothing ever gave --txt-1 a Day value. So in Day every
# rule reading it painted near-white on a white card:
#
#   .cmc-stats .cs .v      market cap · volume 24h · volume/mcap · FDV · circulating ·
#                          max supply · all-time high            1.09:1   (7 statistics)
#   .cs-range .rk-head b   24h low / 24h high                    1.09:1
#   #dlRisk .ro b          the risk-sizing output in the ticket  1.09:1
#   #mktpro .mx-glob .gg .v, #cine-tracks .acard .am b           1.09:1
#
# All of them verified `background:transparent; background-image:none` — nothing composites
# over them, they are simply invisible. Every one is on the coin detail page or a panel the
# eight-route walk never opened, which is why no gate saw it (see test/gate-render-contrast.js).
#
# The fix stays inside the token system and on the token's own hue. #F2F5FA is HSL(217.5°,
# 44.4%, 96.5%); the Day value is the SAME hue and saturation with the lightness moved to 20%:
# #1C2D4A. Measured with the maths in test/gate-contrast.js, against every opaque Day surface
# the payload paints:
#     #FFFFFF 13.78 · #F7F9FC 13.07 · #F5F7FB 12.85 · #F1F4F9 12.50 · #EEF2F8 12.27 · #E5EAF1 11.40
# Night is untouched: :root still declares #F2F5FA and the Day block only exists under
# html[data-mode=day].
#
# Two more Day-blind foregrounds ride with it, both hard-coded lights on rules the runtime
# Day retint could not repair (it only fixes a foreground when the SAME rule declares a dark
# background, and neither of these does):
#   #cv-pairlabel.pairlbl   "BTC / USDT" above the chart   #eaf0ff → 1.14 on the retinted card
#   #dlCoinAI button.ask    "Ask DeXaI about BTC →", Forecast, Wire, Alert
#                                                         #cff6ff → 1.15
# Both take a Day value from the token system on their own hue: the pair label is primary text
# (--txt-1, 13.78), the ask buttons are the accent (--cyan = #00728F in Day, 5.52 on white and
# 4.57 on the darkest Day chip). Both Day-scoped, so Night keeps the exact colours it had.
DAYTXT = [
 ('f-txt1-day',
  '--nv-topline:rgba(13,20,33,.05);--txt-3:#5C687D}',
  '--nv-topline:rgba(13,20,33,.05);--txt-3:#5C687D;--txt-1:#1C2D4A}', 1),

 # --- and the one --txt token whose NIGHT value was the failing half. Extending the render
 #     walk to the coin page measured --txt-3 (#8791A4) against the stats plate it actually
 #     sits on, #252D42, at 4.32:1 — 40 elements, "24h low" and "24h high" among them. Same
 #     hue (219°) and saturation, lightness up: #9AA4B8 reads 5.47 there and only improves on
 #     every darker Night surface it already passed.
 ('f-txt3-night', '--txt-2:#A1A9BD;--txt-3:#8791A4}', '--txt-2:#A1A9BD;--txt-3:#9AA4B8}', 1),

 # --- the risk sizer writes its three labels with an inline hard-coded #93A3BE, so no
 #     stylesheet sweep can reach them: 2.55:1 on the white Day ticket. They are exactly what
 #     --txt-3 is for (5.63 in Day, 5.47 in Night), so they now read it.
 ('f-risk-labels', 'color:#93A3BE', 'color:var(--txt-3)', 3),
]
for pid, find, rep, n in DAYTXT:
    c = out.count(find)
    assert c == n, f'day-token patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

# ---- post-conditions: the defect cannot come back ------------------------------------
assert out.count('--txt-1:#1C2D4A') == 1, 'the Day value for --txt-1 is not in the payload exactly once'
assert out.count('--txt-1:#F2F5FA') == 1, 'the Night value for --txt-1 moved or multiplied'
# the Day PALETTE block, not merely the first Day-scoped rule: it is the one that declares
# the mode's ground and ink, and it is where a text token's Day value has to live.
_daypal = next((m.group(0) for m in re.finditer(r'html\[data-mode=day\]\{[^}]*\}', out)
                if '--bg:' in m.group(0) and '--ink:' in m.group(0)), None)
assert _daypal, 'the Day palette block moved'
assert '--txt-1:#1C2D4A' in _daypal, \
    '--txt-1 is not defined inside the Day palette block — it would inherit Night again'
_rootpal = re.search(r':root\{--cmc-sans:[^}]*\}', out)
assert _rootpal, 'the :root text-token block moved'
# THE STRUCTURAL GUARD: every --txt-* token declared on :root must have a Day answer, either
# in the Day palette block or by being re-pointed at an already-themed token in the CSS layer.
# This is what stops the next token from shipping with one value for two modes.
_csslayer_f = open(os.path.join(ROOT, 'layers', 'v154.css'), encoding='utf-8').read()
for _t in sorted(set(re.findall(r'(--txt-\d+)\s*:', _rootpal.group(0)))):
    _in_day = (_t + ':') in _daypal
    _themed = re.search(re.escape(_t) + r'\s*:\s*var\(--', _csslayer_f) is not None
    assert _in_day or _themed, (
        '%s is declared once, on the Night :root, and has no Day answer — every rule reading '
        'it paints a Night colour on a Day surface' % _t)
# the two hard-coded lights the runtime retint cannot reach
assert 'html[data-mode=day] .chart-card.pro .pairlbl,' in _csslayer_f and \
       'html[data-mode=day] #cv-pairlabel{color:var(--txt-1)!important}' in _csslayer_f, \
    'the chart pair label has no Day value — "BTC / USDT" would read at 1.14 again'
assert 'html[data-mode=day] #dlCoinAI button.ask{color:var(--cyan)!important}' in _csslayer_f, \
    'the Ask DeXaI / Forecast buttons have no Day value — they would read at 1.15 again'
assert '--txt-3:#9AA4B8' in out and '#8791A4' not in out, \
    'the Night --txt-3 that read 4.32 on the coin stats plate is still shipping'
assert 'color:#93A3BE' not in out and out.count('color:var(--txt-3)') >= 3, \
    "the risk sizer still writes its labels with an inline literal no stylesheet can reach"
# the accent pairings: one foreground for a token that inverts between the modes
for _rule, _why in [
    ('html:not([data-mode=day]) .cybtn{color:#04121C!important}', 'white on the bright Night brand gradient (1.54)'),
    ('html[data-mode=day] #dlRisk .rr .go{color:#FFFFFF!important}', 'dark ink on the deep Day brand gradient (2.74)'),
    ('html:not([data-mode=day]) #dlPerp .go .sh{color:#04120A!important}', 'white on the bright Night --down (2.52)'),
    ('html[data-mode=day] #dlPerp .go .sh{color:#FFFFFF!important}', 'dark ink on the deep Day --up (3.20)'),
    ('#page-learn .simple b{color:var(--up)}', 'a green that failed in BOTH modes (3.25 / 3.89)')]:
    assert _rule in _csslayer_f, 'accent pairing lost: %s — %s' % (_rule, _why)
assert '.dl154 .dn,.dl-tbl .dn,.dl-row .dn{color:var(--down)}' in _csslayer_f and \
       '.dx-slot .dn{color:var(--down)}' in _csslayer_f, \
    'the down marks are back on a Night-only literal that reads 2.5 on a Day panel'
# the runtime sweep's second half: a light foreground on a rule with no opaque background
_dsurf = open(os.path.join(ROOT, 'layers', 'zz-day-surfaces.js'), encoding='utf-8').read()
assert _dsurf.count('function dayFg(') == 1 and _dsurf.count('function darkenTo(') == 1, \
    'the Day sweep repairs a foreground only when the same rule paints a dark background — '\
    'a rule that sets ONLY a colour is walked straight past again'
assert 'FG_TARGET' in _dsurf and _dsurf.count('seenFg') >= 2, \
    'the foreground sweep has no target ratio or no dedupe of its own'
assert not re.search(r'setInterval\(|new\s+(Mutation|Intersection|Resize)Observer\b', _dsurf), \
    'the Day sweep added a timer or an observer'
assert ':root{--fa2:var(--cyan)}' in _csslayer_f, \
    '--fa2 is undefined again: every reader would take its Night-only #00dcff fallback in Day too'
assert 'html[data-mode=day] .kn-facts .kf-eye em{color:var(--cyan)!important}' in _csslayer_f, \
    "the lesson eyebrow is back on the track palette's Night accent (1.66 in Day)"
assert 'html[data-mode=day] .sn-eye{color:var(--cyan)!important}' in _csslayer_f, \
    'the lab eyebrow is back on an inline Night accent (1.66 in Day)'
for _r in ['html[data-mode=day] .sn-btn.ghost{color:var(--cyan)!important}',
           'html[data-mode=day] .nxc-in button{color:#FFFFFF!important}',
           'html[data-mode=day] .btn.primary{color:#FFFFFF!important}']:
    assert _r in _csslayer_f, 'a Day pairing the walk proved wrong is unanswered again: %s' % _r
assert '--fa2:\'+TRKC[Math.floor(i/3)]' in out and re.search(r'TRKC=\["#00DCFF"', out), \
    'the track palette moved — the Day answer above is aimed at an accent that is no longer stamped inline'
assert '|kn-agree|' in _dsurf, \
    'the sweep re-casts a foreground inside the consensus panel it deliberately leaves dark'
assert "if (bg && /var\\(/i.test(stripWashes(bg))) continue;" in _dsurf, \
    'the sweep re-casts a foreground whose rule paints a THEMED background — that pairing '\
    'inverts with the mode and is already answered'
assert open(os.path.join(ROOT, 'layers', '40-dexai.js'), encoding='utf-8').read().count(
    'color:var(--muted,#8fa4c4)') == 3, \
    'the AI console writes its notes with an inline literal no stylesheet can reach (2.54 in Day)'
assert _dsurf.count('function stripWashes(') == 1 and 'darkness(stripWashes(bg))' in _dsurf, \
    'a mostly-transparent color-mix reads as an opaque panel again, so the sweep walks past '\
    'the rule instead of repairing the light foreground on it'
assert 'color:var(--cyan,#00e5ff);align-self:center' in open(
    os.path.join(ROOT, 'layers', '40-dexai.js'), encoding='utf-8').read(), \
    'the DeXaI Tutor label is back on an inline literal (1.46 in Day)'
assert out.count('color:#cff6ff') == 4, \
    'a Night ask-button colour was changed instead of being answered in Day (%d sites)' % out.count('color:#cff6ff')
assert out.count('.pairlbl{font-weight:700;font-size:14px;letter-spacing:-.01em;color:#eaf0ff}') == 1, \
    'the Night pair-label colour was changed instead of being answered in Day'

# ---- the layer halves of the two cheap defects ----------------------------------------
# D1 · the portfolio holdings ledger. The board is a three-column masonry at 1440; the
#      ledger table carries min-width:640px and was packed into a 422px column, so its
#      scroller clipped at 388px and PRICE, VALUE and 24H sat outside the card. A card with
#      a hard minimum wider than a column does not belong in the columns — it stays on the
#      full-width head, where 640px fits inside 1298px with room to spare.
_cols = open(os.path.join(ROOT, 'layers', 'zzz-columns.js'), encoding='utf-8').read()
assert _cols.count('function tooWideForColumn(') == 1 and _cols.count('tooWideForColumn(') == 2, \
    'the masonry no longer keeps a card wider than a column out of the columns'
assert _cols.count('function minNeed(') == 1 and 'getComputedStyle(n[i]).minWidth' in _cols, \
    "the masonry no longer READS a card's hard minimum width — it would have to be hard-coded"
assert "(tooWideForColumn(el, colW) ? wide : packable)" in _cols, \
    'the portfolio tail is packed without splitting off the cards that cannot fit a column'
assert not re.search(r'setInterval\(|requestAnimationFrame\(|new\s+(Mutation|Intersection|Resize)Observer\b', _cols), \
    'the layout layer added a timer, loop or observer'

# D2 · the Era Ledger printed a literal `undefined`. eraSheet() called paint(keys.length - 1)
#      with no guard, so on a device where eraRecord() has bailed (fewer than 50 coins loaded)
#      keys is empty, keys[-1] is undefined, and the sheet read "week of undefined (latest)"
#      over an empty table with a scrubber whose max was -1. Missing data reads "Unavailable".
_led = open(os.path.join(ROOT, 'layers', '39b-ledgers.js'), encoding='utf-8').read()
assert _led.count('      if (!keys.length) {\n        body.innerHTML') == 1, \
    'eraSheet() paints an index into an empty key list again'
assert _led.count('<span id="dlEraLbl">Unavailable</span>') == 1, \
    'the empty Era Ledger no longer names itself Unavailable'
assert _led.count('dlEraScrub') == 2, \
    'the empty Era Ledger still ships a scrubber — its max would be -1'
assert re.search(r'if \(!keys\.length\) \{[\s\S]{0,900}?return;\s*\}\s*body\.innerHTML =', _led), \
    'the empty-state branch no longer returns before the populated markup is built'
_era = _led[_led.index('function eraSheet()'):_led.index('/* ---------------------------------------------------------- Baskets */')]
assert 'paint(keys.length - 1);' in _era and _era.index('if (!keys.length) {') < _era.index('paint(keys.length - 1);'), \
    'the guard no longer runs before paint()'
assert not re.search(r'setInterval\(|requestAnimationFrame\(|new\s+(Mutation|Intersection|Resize)Observer\b', _era), \
    'the Era Ledger fix added a timer, loop or observer'

print('day token: --txt-1 given a Day value (#1C2D4A, 13.78 on white, hue and saturation of '
      'the Night token, lightness only); chart pair label and the Ask/Forecast buttons answered '
      'in Day; holdings ledger kept out of the masonry columns; Era Ledger empty state worded')


# ================================================================== v155-G · VERTICAL RHYTHM
# The previous layout pass declared markets fixed on a HORIZONTAL metric — dead-rail
# percentage and band fill — measured at 1440 only. Both halves of that were wrong, and
# test/gate-rhythm.js is the replacement: row bottom-edge spread, ink-density variance
# between neighbours, vertical-gap outliers, the largest empty run INSIDE a card, ink that
# falls outside the box that clips it, and maximal unpainted rectangles — at 1280 / 1440 /
# 1728 / 2000 / 2560, in both modes. Measured against the shipped payload it read:
#
#   markets @2000 Night   row spread 374px = 80% of the tallest card in the band
#                         (#mxTopHost: 141 / 95 / 469 / 252 / 141)
#                         density 0.101 (tracked-set card) beside 0.497 (trending)  = 4.9x
#                         .t-scroll overflowed 975px with its scrollbar suppressed
#                         #tape and #dlGstat stated the same market cap 92px apart
#   markets @1440         #dlGstat truncated 433px of itself, silently
#   markets @1280-2560    944x256 unpainted beside the spotlight card
#
# Five of the six causes are geometry and live in layers/v154.css, layers/zz-layout-balance.js
# and layers/21-snapshot.js (asserted at the bottom of this block, and again at runtime by
# test/gate154.js). Two are in the canonical payload and are patched here.
RHYTHM = [
 # --- G6a · the price ribbon is not a stat bar --------------------------------------
 # #cbCmd (the terminal command bar), #tape (the ribbon) and #dlGstat (the Markets record)
 # each rendered a market cap, a BTC dominance and a Fear & Greed within 160px of one
 # another. Every one was right and every one named its universe — and a visitor read two
 # market caps at once as the app contradicting itself.
 #
 # Nothing is deleted and no label is dropped: the three ribbon items keep their figures,
 # their .gs-u universe labels and their DLSNAP.mark() disagreement marks exactly as the
 # v155-E honesty pass built them. They declare themselves aggregates, and layers/v154.css
 # decides which single bar shows them on a given view. A marquee is the wrong surface for
 # a contested figure — it moves, it can be mid-scroll, and it has nowhere to put a witness
 # list — so the ribbon is never that bar. Everything it carried is stated by the command
 # bar, which is on every view, and by the record on Markets.
 ('rh-tape-mcap',
  '\'" data-at="\'+(window.DLSNAP?DLSNAP.get("universes.global.marketCap").servedAt||0:0)',
  '\'" data-agg="1" data-at="\'+(window.DLSNAP?DLSNAP.get("universes.global.marketCap").servedAt||0:0)', 1),
 ('rh-tape-dom',
  '<span class="ti">BTC.D <b class="stat">',
  '<span class="ti" data-agg="1">BTC.D <b class="stat">', 1),
 ('rh-tape-fng',
  '<span class="ti">FEAR/GREED <b class="stat">',
  '<span class="ti" data-agg="1">FEAR/GREED <b class="stat">', 1),

 # --- G4a · the spotlight chart takes the height of its box -------------------------
 # drawArea(cv,data,accent,fixedH) already measures its own box: H = fixedH || rect.height.
 # The spotlight call handed it the magic number 150, so the card could never be taller
 # than its chart — and the hero's left column runs 555px beside it. The result was the
 # single largest unpainted rectangle on the view: 944x256 at 2000px, 656x288 at 1440.
 # Dropping the magic number is the whole fix; layers/v154.css lets the card and the canvas
 # fill the row, and drawArea reads the box it was actually given.
 # --- 6 · the last two version literals a reader can actually see ------------------
 # The command palette offered "What's new in v152" and the journey hub subtitled every
 # one of its entries "v152 · compass" on a build four releases later. Same defect as the
 # stamp: version copy typed as a literal instead of read from the release metadata.
 ('rh-cmdk-whatsnew', 'What\u2019s new in v152', 'What\u2019s new in %(build)s' % RELEASE, 1),
 ('rh-hub-release', 'sub:"v152 · compass"', 'sub:"%(build)s · %(name)s"' % RELEASE, 1),

 ('rh-spot-box',
  'drawArea(document.getElementById("spotChart"),c.hist.slice(-84),c.c7>=0?"#14BED0":"#F0455E",150)',
  'drawArea(document.getElementById("spotChart"),c.hist.slice(-84),c.c7>=0?"#14BED0":"#F0455E",0)', 1),
]
for pid, find, rep, n in RHYTHM:
    c = out.count(find)
    assert c == n, f'rhythm patch {pid}: expected {n} occurrence(s), found {c}'
    out = out.replace(find, rep)

# ---- post-conditions: the six defects cannot come back --------------------------------
# G6 · every ribbon aggregate declares itself one, and NOT ONE of them lost a figure,
#      a universe label or a disagreement mark in the process.
assert out.count('data-agg="1"') == 3, \
    'the price ribbon no longer marks exactly its three market aggregates — a bar rule ' \
    'aimed at data-agg would either miss one or hide a coin price'
assert out.count('DLSNAP.mark("universes.global.marketCap","market cap")') == 1 and \
       out.count('DLSNAP.mark("universes.global.dominance.BTC","BTC dominance")') == 1, \
    'a ribbon aggregate lost its disagreement mark when it was marked as an aggregate'
assert out.count('<span class="gs-u">whole market</span>') == 1, \
    'the ribbon market cap no longer names the universe it measured'
assert out.count('class="ti dl-prov \'+(_gf||"stale")+\'" data-agg="1" data-at=') == 1, \
    'the ribbon market cap lost its freshness chip or its shared-clock timestamp'
_css_g = open(os.path.join(ROOT, 'layers', 'v154.css'), encoding='utf-8').read()
assert '#tape .ti[data-agg]{display:none}' in _css_g, \
    'the price ribbon is a second stat bar again'
# v159 · the record is gone, so the command bar is the only bar left and must NOT be
#        hidden on Markets — that rule is what used to make it defer to the record.
assert 'html[data-route="markets"] #cbCmd .cb-agg{display:none}' not in _css_g, \
    'the command bar hides its market figures on Markets again — with the record strip '\
    'removed that leaves the view stating no market cap at all'
assert '#dlGstat' not in re.sub(r'/\*[\s\S]*?\*/', '', _css_g), \
    'a #dlGstat rule is back in the layer stylesheet, styling an element that never mounts'
assert ':has(' not in re.sub(r'/\*[\s\S]*?\*/', '', _css_g), \
    'a :has() selector is back in the layer stylesheet — anchored at the root over a 2.7MB '\
    'document it re-runs on every mutation and took the renderer down in the render walk'
_snap_g = open(os.path.join(ROOT, 'layers', '21-snapshot.js'), encoding='utf-8').read()
assert _snap_g.count('function stampRoute()') == 1 and _snap_g.count('w.__dlroute = 1') == 1, \
    'the route is no longer stamped on <html>, so the rule above is aimed at nothing'
assert _snap_g.count('function uniSwitch(which)') == 1 and _snap_g.count('uniSwitch("cb")') == 1 \
   and _snap_g.count('uniSwitch("gstat")') == 0, \
    'a bar carries one universe with no way to reach the other — the second universe would ' \
    'have to be shown at the same time to be shown at all'
assert _snap_g.count('uniSel = { cb: "tracked" }') == 1, \
    'the command bar no longer keeps its default universe — it is the tracked-set status line'
assert _snap_g.count('function uniBind()') == 1 and _snap_g.count('uniBound = true') == 1, \
    'the universe switch is not bound exactly once'
assert not re.search(r'setInterval\(|requestAnimationFrame\(|new\s+(Mutation|Intersection|Resize)Observer\b', _snap_g), \
    'the universe switch added a timer, loop or observer'

# G1 · an intrinsic grid may never demand more width than its container has. This is the
#      class the 469px tracked-set card belonged to: minmax(420px,1fr) inside a 325px panel.
# comments stripped, so a rule QUOTED in a comment cannot satisfy or defeat the check
_css_code = re.sub(r'/\*[\s\S]*?\*/', '', _css_g)
_bare = re.findall(r'repeat\(auto-fit,\s*minmax\((\d+)px\s*,', _css_code)
assert not _bare, \
    'an auto-fit grid can floor above its container width again (%s) — that overflows the ' \
    'card it lives in at every width narrower than the floor' % _bare
assert len(re.findall(r'minmax\(min\((\d+)px,100%\),1fr\)', _css_code)) >= 8, \
    'the min(N,100%) floor is gone from the intrinsic grids'
assert '#mktpro .mx-glob,' not in _css_g, \
    'the tracked-set panel is back in the wide-two-up family — it lives in a five-up band ' \
    'and is never a wide block'
assert '#mktpro .mx-glob{\n  display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;' in _css_g, \
    'the tracked-set card is not a two-column stat plate any more'

# G3 · a band of sibling cards is a row, and a row ends on one line.
assert '#mktpro .mx-top,.pulse,.front-pkg,.mkt-hero,.sec-grid,.cbb-venues{align-items:stretch!important}' in _css_g, \
    'the card-band family lost the rows the rhythm audit measured ragged'
_bal = open(os.path.join(ROOT, 'layers', 'zz-layout-balance.js'), encoding='utf-8').read()
assert "g.style.alignItems = g.style.alignItems || 'stretch';" in _bal, \
    'the packer chooses the column count and then declines to answer for the bottom edge again'
assert "|| 'start';" not in _bal, 'the packer top-aligns a card band again'
assert "if ((a === '1' && b === '-1')" in _bal, \
    'the packer counts a full-width band footer as one of the cards it is balancing again — ' \
    'that scores an even split for the wrong item count and orphans the last real card'

# G5 · a scroller states that it scrolls. (The strip that used to truncate 433px of itself
#      at 1440 is gone in v159 — the excision above is what answers for it now.)
assert 'dlGstat' not in out, \
    'the record strip is back in the payload — v159 cut it out, element, styles and all'
assert _css_g.count('scrollbar-width:thin') >= 2, \
    'a scroller with 400-1100px of content out of view has no affordance again'

# 6 · the version copy. Every user-visible build string is derived from RELEASE, and
#     test/gate154.js asserts at runtime that the stamp a user reads IS the meta tag.
assert re.findall(r'var B="([^"]+) · %s"' % RELEASE['name'], out) == [RELEASE['build']], \
    'the visible build stamp is a literal again: %r' % re.findall(r'var B="([^"]+) · ', out)
assert re.findall(r'BUILD="([^"]+) · purist / offline"', out) == [RELEASE['build']], \
    'the diagnostics build string is a literal again'
assert out.count('New in %(build)s · %(name)s' % RELEASE) == 1 and \
       out.count('"%s"===localStorage.getItem("dl.seen")' % RELEASE['build']) == 1 and \
       out.count('localStorage.setItem("dl.seen","%s")' % RELEASE['build']) == 1, \
    "the What's-New banner and its seen-key do not name the release this build ships"
# and nothing a reader can see may still name the previous build. The only survivors
# allowed are the two source comments that RECORD what v154 did — a comment is not copy.
_stale = [out[max(0, m.start() - 46):m.start() + 46] for m in re.finditer(r'v15[0-4][a-z]?(?![\w])', out)
          if not re.match(r'v%s' % RELEASE['build'][1:], out[m.start():m.start() + 8])]
_ok_marks = ('<!-- v154: decorative background stack removed',
             '/* v154c two-mode theme engine',
             '["v153 · citadel"', '["v152 · compass"', 'v153 \u00b7 ', '"v152"',
             'index.v153', 'v150', 'v151', '__v152', 'nav.__v15', 'DLX \u00b7 v153')
_bad = [x for x in _stale if not any(k in x for k in _ok_marks)]
assert not _bad, \
    'a previous build is still named where a reader can see it on a %s build: %r' % (RELEASE['build'], _bad[:4])

print('vertical rhythm: intrinsic grids floored at min(N,100%%), the tracked-set panel out of '
      'the wide-block family and back to a two-column plate, card bands stretched to one line, '
      'scrollers given an affordance, the price ribbon retired as a stat bar (three aggregates '
      'marked, every figure/label/mark intact), spotlight chart sized from its own box, '
      'version copy derived from RELEASE (%s)' % RELEASE['build'])


# ================================================================== v156-V · the films speak like people
# Owner report (11 Sep 2026): the film series' narration was robotic. It was the browser's
# speechSynthesis — whatever system voice the device had, restarted from the top of the line on
# every pause, seek and resume, and silent in half the WebViews. It is replaced by 32 recorded
# clips (web/dist/voice/<film>-<scene>.mp3, one per scene, rendered offline with a neural voice —
# web/voice/README.md), played on ONE <audio> element that is slaved to the film clock:
#   · the clip starts NV.L seconds into its scene and seeks with the scrubber (currentTime is the
#     scene offset, not "from the top");
#   · pause/close/end/voice-off stop it; resume picks up mid-sentence;
#   · playbackRate follows the 0.5× / 1× / 1.5× speed button; drift > .35 s is corrected on
#     timeupdate (no new timers, no loops);
#   · clips are fetched with fetch() (a plain 200, so the worker's static cache keeps them for
#     offline) and played from blob: URLs; a film's four clips are prefetched when narration
#     is switched on;
#   · the element is unlocked inside the user's click (iOS/Safari autoplay rule).
# No synthetic voice remains in the film player: if a clip cannot load, captions carry the film.
VOICE_FILMS = ['doublespend', 'mining', 'keys', 'merkle', 'halving', 'difficulty', 'mempool', 'attack51']
_vdir = os.path.join(OUT_DIR, 'voice')
_missing = ['%s-%d.mp3' % (f, n) for f in VOICE_FILMS for n in range(1, 5) if not os.path.isfile(os.path.join(_vdir, '%s-%d.mp3' % (f, n)))]
assert not _missing, 'film narration clips missing from dist/voice: %r' % _missing[:6]
for _f in VOICE_FILMS:
    assert out.count('id:"%s",title:' % _f) == 1, 'film %s is no longer in the payload — dist/voice is out of step' % _f

_NV = ('var NV={a:null,u:{},h:0,sc:null,t:0,ok:0,L:.35,'
 'src:function(id,n){return"voice/"+id+"-"+(n+1)+".mp3"},'
 'get:function(k){return NV.u[k]||(NV.u[k]=fetch(k).then(function(r){if(!r.ok)throw Error("voice "+r.status);return r.blob()}).then(function(b){return URL.createObjectURL(new Blob([b],{type:"audio/mpeg"}))}).catch(function(e){throw delete NV.u[k],e}))},'
 'el:function(){var a=NV.a;if(!a){a=NV.a=new Audio,a.preload="auto",a.setAttribute("data-dl","film-voice"),a.ontimeupdate=NV.sync;try{a.preservesPitch=!0}catch(e){}}return a},'
 'unlock:function(){var a=NV.el();if(!NV.ok){NV.ok=1;try{var d=new DataView(new ArrayBuffer(46)),w=function(o,s){for(var i=0;i<s.length;i++)d.setUint8(o+i,s.charCodeAt(i))};'
 'w(0,"RIFF"),d.setUint32(4,38,!0),w(8,"WAVEfmt "),d.setUint32(16,16,!0),d.setUint16(20,1,!0),d.setUint16(22,1,!0),d.setUint32(24,8e3,!0),d.setUint32(28,16e3,!0),d.setUint16(32,2,!0),d.setUint16(34,16,!0),w(36,"data"),d.setUint32(40,2,!0);'
 'a.src=URL.createObjectURL(new Blob([d],{type:"audio/wav"}));var p=a.play();p&&p.catch(function(){})}catch(e){}}},'
 'prefetch:function(ep){ep&&ep.scenes.forEach(function(s,i){s.say&&NV.get(NV.src(ep.id,i)).catch(function(){})})},'
 'play:function(sc){var a=NV.el(),h=++NV.h;NV.sc=sc,clearTimeout(NV.t),a.pause();'
 'NV.get(NV.src(P.ep.id,sc.idx)).then(function(u){var go=function(){if(h===NV.h&&P.voice&&P.play&&P.ep){var o=P.T-sc.t0-NV.L;if(o<0)return void(NV.t=setTimeout(go,-o/P.spd*1e3));'
 'if(a.src!==u&&(a.src=u),!(a.duration&&o>=a.duration)){try{a.currentTime=o}catch(e){}a.playbackRate=P.spd;var p=a.play();p&&p.catch(function(){})}}};go()}).catch(function(){})},'
 'sync:function(){var a=NV.a,sc=NV.sc;if(a&&!a.paused&&sc){if(!P.play||!P.voice||!P.rt||P.rt.scenes[P.sceneIdx]!==sc)return NV.stop();a.playbackRate!==P.spd&&(a.playbackRate=P.spd);var o=P.T-sc.t0-NV.L;o>=0&&Math.abs(a.currentTime-o)>.35&&(a.currentTime=o)}},'
 'stop:function(){NV.h++,NV.sc=null,clearTimeout(NV.t),NV.a&&NV.a.pause()}};')
VOICE = [
 ('voice-engine',
  'function speak(s){try{if(!P.voice||!window.speechSynthesis||!s)return;speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(s);u.rate=1,u.pitch=1,speechSynthesis.speak(u)}catch(e){}}function stopVoice(){try{window.speechSynthesis&&speechSynthesis.cancel()}catch(e){}}',
  _NV + 'function speak(s){try{var sc=P.rt&&P.rt.scenes[P.sceneIdx];if(!P.voice||!P.ep||!s||!sc||null==sc.idx)return void NV.stop();NV.prefetch(P.ep),NV.play(sc)}catch(e){}}function stopVoice(){NV.stop()}', 1),
 ('voice-toggle',
  'P.voice=!P.voice,this.classList.toggle("on",P.voice),P.voice?P.sceneIdx=-1:stopVoice()',
  'P.voice=!P.voice,this.classList.toggle("on",P.voice),P.voice?(NV.unlock(),NV.prefetch(P.ep),P.sceneIdx=-1):stopVoice()', 1),
 ('voice-play-unlock',
  'function toggle(){P.play=!P.play,',
  'function toggle(){P.play=!P.play,P.play&&P.voice&&NV.unlock(),', 1),
 ('voice-title',
  '<button id="cine-voice" title="Spoken narration (offline)">',
  '<button id="cine-voice" title="Narration" aria-label="Narration" aria-pressed="false">', 1),
 ('voice-aria',
  'this.classList.toggle("on",P.voice),P.voice?(NV.unlock()',
  'this.classList.toggle("on",P.voice),this.setAttribute("aria-pressed",P.voice?"true":"false"),P.voice?(NV.unlock()', 1),
]
for pid, find, rep, n in VOICE:
    c = out.count(find)
    assert c == n, f'{pid}: expected {n}, found {c}'
    out = out.replace(find, rep)
_cine = out[out.index('var LEAD=3.6,TAIL=3.4'):out.index('var LEAD=3.6,TAIL=3.4') + 60000]
assert 'SpeechSynthesisUtterance' not in _cine and 'speechSynthesis' not in _cine, \
    'the film player still reaches for the synthetic voice'
print('film narration: %d recorded clips (%s KB) slaved to the film clock; speechSynthesis gone from the player'
      % (len(VOICE_FILMS) * 4, sum(os.path.getsize(os.path.join(_vdir, x)) for x in os.listdir(_vdir)) // 1024))


# ------------------------------------------------------------------ Phase-1 architecture (web/app → DLAPP)
sys.path.insert(0, ROOT)
import buildlib.arch as _arch
out = _arch.apply(out)
import buildlib.perps as _perps
out = _perps.apply(out)

# ------------------------------------------------------------------ layers
css = open(os.path.join(ROOT, 'layers', 'v154.css'), encoding='utf-8').read()
layers = sorted(glob.glob(os.path.join(ROOT, 'layers', '*.js')))
blocks = ['<style id="v154css">' + css + '</style>']
early = []   # (anchor, block)
for f in layers:
    body = open(f, encoding='utf-8').read()
    assert '</script' not in body, f'layer {f} contains </script'
    m = re.search(r'//@inject-before:\s*(.+)', body)
    blk = '<script>\n' + body + '\n</script>'
    if m: early.append((m.group(1).strip(), blk))
    else: blocks.append(blk)
for anchor, blk in early:
    j = out.find(anchor)
    assert j > 0 and out.count(anchor) == 1, f'anchor not unique: {anchor}'
    k = out.rfind('<script', 0, j)
    assert k > 0
    out = out[:k] + blk + '\n' + out[k:]
inject = '\n'.join(blocks) + '\n'

i = out.rfind('</body>')
assert i > 0
out = out[:i] + inject + out[i:]

# Phase-1 architecture, late pass: needs the layers' CSS in place
out = _arch.apply_late(out)

# v156 owner-report fixes: canonical brand mark everywhere, chart reading, real history
import buildlib.v156 as _v156
out = _v156.apply(out)

# the Blog: #page-blog, #/blog routes, footer + What's New links (typed half in web/app/src/lib/blog)
import buildlib.blog as _blog
out = _blog.apply(out)

# conditional and algorithmic orders: OCO + TWAP (typed half in web/app/src/{lib/paper-engine,legacy}/algo*)
import buildlib.algo as _algo
out = _algo.apply(out)

# v158 · tidy: the owner's seven screenshots (spotlight week, proof-ledger actions; the rest is layers)
import buildlib.v158 as _v158
out = _v158.apply(out)

# ------------------------------------------------------------------ worker / payload version lock
# Defect 4 of the same audit: nothing forced the worker's version to move when the payload did,
# so a deploy could ship a new index.html behind a worker whose cache name had not changed —
# and the old cache would keep answering. The worker now names the payload it was minted for,
# and that name is PART OF ITS CACHE KEY, so the version cannot fail to change when the payload
# changes. This assert is what makes it true: build the payload, hash it, and refuse to ship if
# dist/sw.js still names a different one.
SW_PATH = os.path.join(OUT_DIR, 'sw.js')
swtxt = open(SW_PATH, encoding='utf-8').read()

def _swconst(name):
    m = re.search(r"const %s\s*=\s*'([^']*)'" % name, swtxt)
    assert m, f'dist/sw.js has no {name} constant'
    return m.group(1)

assert _swconst('SW_BUILD') == RELEASE['build'], \
    "worker version drift: dist/sw.js SW_BUILD is %r but the payload ships %r" % (_swconst('SW_BUILD'), RELEASE['build'])
assert '<meta name="cb:build" content="%s">' % RELEASE['build'] in out, 'the build stamp is not in the payload'
assert "PAYLOAD_SHA.slice(0, 12)" in swtxt and re.search(r"const V\s*=\s*'dl-'\s*\+\s*SW_BUILD", swtxt), \
    'the cache name no longer carries the build and the payload hash — a payload change could go unversioned'

_sha = hashlib.sha256(out.encode('utf-8')).hexdigest()
_lock = _swconst('PAYLOAD_SHA')
if os.environ.get('DL_MINT') == '1' and _lock != _sha:
    # Deliberate re-mint (buildlib/build.sh sets this): point the worker at the payload being built.
    swtxt, _n = re.subn(r"const PAYLOAD_SHA = '[0-9a-f]{64}';", "const PAYLOAD_SHA = '%s';" % _sha, swtxt)
    assert _n == 1, 'PAYLOAD_SHA constant not found exactly once in dist/sw.js'
    open(SW_PATH, 'w', encoding='utf-8', newline='\n').write(swtxt)
    _lock = _sha
    print('worker re-minted for payload', _sha[:12])
assert _lock == _sha, (
    'VERSION-BUMP GATE — dist/index.html changed but dist/sw.js was not re-minted.\n'
    '  payload is now : %s\n'
    '  sw.js names    : %s\n'
    '  Fix: bump SW_REV in dist/sw.js and set PAYLOAD_SHA = %s' % (_sha, _lock, _sha))

# the worker's own strategy, asserted so the cache-first navigation cannot come back
assert "caches.match('./index.html').then((hit) => hit || fetch(req))" not in swtxt, \
    'navigations are cache-first again — returning visitors would stop seeing new builds'
assert 'navigateFirst' in swtxt and 'NAV_TIMEOUT_MS' in swtxt, 'navigations are no longer network-first with a deadline'
# comments stripped, so a comment that merely NAMES skipWaiting cannot satisfy or defeat the check
_swcode = re.sub(r'//[^\n]*', '', re.sub(r'/\*[\s\S]*?\*/', '', swtxt))
_inst = _swcode[_swcode.index("addEventListener('install'"):_swcode.index("addEventListener('activate'")]
assert 'skipWaiting' not in _inst, \
    'install calls skipWaiting again — that is the silent mid-session swap'
assert _swcode.count('self.skipWaiting()') == 1 and "d.dl === 'sw-skip-waiting'" in _swcode, \
    'skipWaiting must exist exactly once, reachable only from the page message'
assert 'function storable' in _swcode and 'async function store(' in _swcode, \
    'the worker has lost its res.ok / content-type gate or its single write choke point'
assert _swcode.count('cache.put(') == 1 and _swcode.count('store(cache') >= 4, \
    'a cache.put() exists outside store() — a write that skips the res.ok / content-type gate'
assert _swcode[_swcode.index('async function store('):].index('cache.put(') < 200, \
    'the one cache.put() is no longer the one inside store()'
assert 'DATA_TTL_MS' in swtxt and 'DATA_MAX' in swtxt and 'async function sweep' in swtxt, \
    'the data cache has lost its TTL or its size bound'
_rev = re.search(r'SW_REV\s*=\s*([0-9]+)', swtxt).group(1)
print(f"worker lock: {_swconst('SW_BUILD')} rev {_rev} minted for payload {_sha[:12]}\u2026 "
      f"\u2014 cache dl-{_swconst('SW_BUILD')}-r{_rev}-{_sha[:12]}")


os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)
open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
sha = hashlib.sha256(out.encode('utf-8')).hexdigest()
print(f'v154 built: {OUT}  bytes={len(out.encode("utf-8"))}  layers={len(layers)}  sha256={sha}')
for f in layers: print('  +', os.path.basename(f), len(open(f,encoding="utf-8").read()), 'chars')
