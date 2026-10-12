// owns: curriculum graph and evidence-based mastery
// reads: DLAPP, DLBOTS, DLCORE, DLDESKS, browser DOM
// emits: DLPATH
/* ============================================================================
   DexLadder — DLPATH · layer 60 · v166 "the path"
   CURRICULUM GRAPH · EVIDENCE-BASED MASTERY · ADAPTIVE SCHEDULING

   The question this desk exists to answer: what should I learn next, and how
   would this app know I had actually learned it?

   The Academy teaches. The desks trade. Until now nothing joined them, so a
   learner could read every lab and still never have held a concentrated
   position through a range break. This layer is the join: a directed graph of
   concepts with prerequisites, each one carrying the lab that explains it AND
   a handoff onto the live desk where the thing is done — and, for each one, an
   EVIDENCE PREDICATE the app can check against its own state.

   A concept is not learned because someone read a lab. It is learned when they
   do the thing on a live surface and the app can see it.

   LAWS OBSERVED
     · NO MONEY. This layer never trades, never quotes, never assigns a
       balance. It reads state and it opens other desks. That is all
     · progress is DERIVED, never stored — the bucket holds evidence ids and
       timestamps only, so a figure cannot be inflated by editing a saved score
     · a missing figure stays missing — null, never 0 wearing a number's clothes
     · deterministic — no random source anywhere; the map layout is computed from
       the graph, the schedule from timestamps
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · every cross-desk call is feature-tested; a desk that is not in this build
       degrades to a NAMED "not in this build" chip, never a dead button
     · nothing is compiled at runtime; the one long-lived hook is a throttled
       DLCORE.onTick observer, declared here because the evidence it collects —
       "the price left your range while you held it" — is only visible while the
       desk is CLOSED. The sheet itself tears down its own listener
     · Day + Night — every rule lives in _v166css/60-path.css, paired
     · the desk never says "certified". It says what evidence exists and what
       is missing
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLPATH && window.DLPATH.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  var EV_CAP = 400, SEEN_CAP = 60, RUN_CAP = 24;
  var DAY_MS = 86400000;

  /* ---------------------------------------------------------- the honesty */

  var ASSUMPTIONS = [
    "Nothing here is a certificate and the desk never uses the word. What it reports is the list of evidence ids it has actually recorded, with the timestamp of each, and the list it has not. A concept with every prerequisite met and no evidence is shown as exactly that.",
    "The evidence is what this app can observe about ITS OWN paper state — positions in the v154 bucket, the Execution desk's route log, the Academy's lesson flags, resting orders, open perps. It cannot see a real wallet, a real fill or a real loss, and it cannot see whether you understood anything. It can only see that you did a specific thing and what came back.",
    "The spaced-repetition schedule is an SM-2 VARIANT with named constants: ease factor starts at 2.50 and is clamped to [1.30, 2.70]; intervals are 1 day, then 6 days, then the previous interval times the ease factor, rounded, capped at 180 days. Recall strength is modelled as a half-life decay, strength = 2^(-elapsed/interval), so a concept is due again when elapsed time reaches one interval and strength reaches 0.50. That decay curve is a MODEL of forgetting, not a measurement of yours.",
    "Repetition count and ease factor are DERIVED from the evidence list every time they are read, never stored. A rep is one distinct evidence atom for the node; the quality score q is 5 when the widened bar is met, 4 when the base bar is met cleanly, and 3 when a near-miss was recorded first. Two people with identical evidence get identical schedules.",
    "Difficulty adapts by moving the EVIDENCE BAR, never by hiding material. Every node shows its full lab list and its full desk handoff at every level. What changes is how much evidence the node asks for: the wide bar is the base bar plus extra atoms, and it engages when your recorded reliability across all nodes is at or above 0.80 and the node already has one confirmation.",
    "Three backtest concepts are checked by a run this desk starts itself, on the Bots engine's own deterministic proof series (a seeded generator, 600 hourly bars, identical on every machine). What is yours in that run is the preset and the costs you chose, not the bars. This is stated on the node rather than dressed up as your own market data.",
    "The 'held it while the price left the range' evidence is collected by a throttled tick observer that runs every 45 seconds while the app is open. If you open a range, leave, and the price crosses and comes back while the tab is closed, the app did not see it and will not claim it did.",
    "Week gates inside a track are ORDERING, not permission. Nothing is locked: you can open any node, any lab and any desk at any time. The gate only decides what the Next tab offers you first."
  ];

  var METHOD = [
    ["The graph", "Nodes are concepts, edges are prerequisites. The shipped graph is checked on load with Kahn's algorithm: every prerequisite id must resolve to a real node, and the queue must drain. If it does not drain, what is left is a cycle and the desk says so on every tab rather than rendering a curriculum it cannot order."],
    ["Mastery", "Each node names a set of evidence atoms. An atom is one observable fact with one timestamp — 'a v3 position existed', 'the spot price was outside its range while it existed', 'that position is gone'. A node is met when every atom in its current bar has a timestamp. Nothing else counts, and reading the lab counts for nothing."],
    ["Derived progress", "The bucket stores a list of {id, t} and a short list of keys last seen, so that a disappearance can be detected. It stores no score, no percentage, no level. Every figure on this desk is recomputed from that list at render time, which is why editing the save file to look further along does not work: there is no field to edit."],
    ["Near misses", "A node that is close says which atom is missing and what it would take, in the words of the lesson. 'You opened it, but the price never left your range — that is the half the lesson is about' is more useful than 3 of 4."],
    ["Scheduling", "Next-node choice is readiness first: a node is a candidate when every prerequisite is met. Among candidates the desk picks the one with the fewest missing atoms, then the shallowest depth in the graph, then id order — no randomness, so the same state always gives the same suggestion. A review outranks new material when an already-met concept is overdue by half an interval or more, because new work resting on a decayed foundation is the expensive kind."],
    ["Intervals", "SM-2 variant. EF starts at 2.50 and updates once per rep by EF + 0.1 - (5-q)(0.08 + 0.02(5-q)), clamped to [1.30, 2.70]. Intervals run 1 day, 6 days, then round(previous x EF), capped at 180 days. At EF 2.50 that is 1, 6, 15, 38, 95, 180. Strength decays as 2^(-elapsed/interval), so the concept is due at strength 0.50."],
    ["Adaptive bar", "Reliability is confirmations divided by confirmations plus recorded near-misses, across every node. At 0.80 and above, nodes with at least one confirmation switch to the wide bar, which asks for the same thing done again under a harder condition — a tighter realised-vs-predicted gap, a second range break, a stop that was actually approached. Below 0.50 the base bar stays and the node surfaces its second lab. No content is ever removed."],
    ["Tracks", "A track is a list of weeks. A week has one outcome written as something you can do, a set of nodes, and a gate — the nodes that must be met before the next week is offered. Weeks are ordering, not locks."],
    ["The map", "Layers are longest-path depths from the roots, computed from the same topological order. Nodes are placed at (depth, index within depth) and the SVG is drawn from those coordinates: no layout library, no image file, and the same graph always draws the same picture."]
  ];

  /* ------------------------------------------------------------ the atoms */
  /* One observable fact, one id, one sentence saying what it means. */

  var ATOMS = {
    "acad.cexdex": ["Academy chapter 'Exchanges and on/off-chain' marked done", "read"],
    "acad.smart": ["Academy chapter 'Smart contracts' marked done", "read"],
    "acad.defi": ["Academy chapter 'DeFi: staking, farming, yield' marked done", "read"],
    "lab.defi": ["DeFi Playground opened", "read"],
    "lab.mev": ["MEV Auction lab opened", "read"],
    "lab.flash": ["Flash loan lab opened", "read"],
    "trade.first": ["at least one paper trade on the book", "did"],
    "trade.ten": ["ten or more paper trades on the book", "did"],
    "order.limit": ["a resting limit order existed", "did"],
    "order.stop": ["a stop order existed", "did"],
    "order.oco": ["an OCO order existed", "did"],
    "order.twap": ["a TWAP working order existed", "did"],
    "sor.sent": ["a route was sent from the Execution desk", "did"],
    "sor.split": ["a sent route had two or more legs", "did"],
    "sor.single": ["the router refused to split and sent one venue instead", "did"],
    "sor.scored": ["a sent route has both a prediction and a realised figure", "did"],
    "sor.tight": ["a sent route's realised all-in came within 25bp of the prediction", "did"],
    "sor.five": ["five or more sent routes are on the ledger", "did"],
    "sor.gas": ["a sent route paid gas on at least one leg", "did"],
    "lp.open": ["a liquidity position existed", "did"],
    "lp.v3": ["a concentrated (v3) position existed", "did"],
    "lp.v3.in": ["a v3 position was observed with spot inside its range", "did"],
    "lp.v3.oor": ["a v3 position was observed with spot OUTSIDE its range", "did"],
    "lp.v3.oor2": ["a v3 position was observed outside its range on two separate days", "did"],
    "lp.closed": ["a v3 position this app had seen is gone — it was closed", "did"],
    "lp.fees": ["a liquidity position had accrued fees above zero", "did"],
    "xp.defi.lp": ["the Liquidity desk recorded your first provision", "did"],
    "xp.defi.swap": ["the Liquidity desk recorded a swap through the curve", "did"],
    "xp.defi.stake": ["the Liquidity desk recorded a stake", "did"],
    "perp.open": ["a leveraged position existed", "did"],
    "perp.lev5": ["a leveraged position at 5x or more existed", "did"],
    "perp.stop": ["a leveraged position carried a stop", "did"],
    "perp.near": ["a leveraged position was observed within 20% of its liquidation price", "did"],
    "perp.stopnear": ["a STOPPED position was observed within 20% of liquidation — the stop was between you and the wick", "did"],
    "perp.closed": ["a leveraged position this app had seen is gone", "did"],
    "perp.fund": ["a leveraged position paid more than $1 of funding", "did"],
    "bt.causal": ["the prefix test ran and the truncated curve matched the full curve exactly", "did"],
    "bt.causal.fail": ["the prefix test ran and the curves DIVERGED — the run saw bars it should not have", "did"],
    "bt.oos": ["the same strategy was run on two disjoint halves of the series", "did"],
    "bt.oos.three": ["the split was run on three or more different presets", "did"],
    "bt.costs": ["the same strategy was run with costs off and with costs on", "did"],
    "bt.costs.bites": ["costs moved the return by a full percentage point or more", "did"],
    "eq.draw": ["your equity history is long enough to have a drawdown in it", "did"],
    "eq.down": ["your equity history contains a peak-to-trough fall of 5% or more", "did"]
  };

  /* -------------------------------------------------------------- the graph */
  /* id, title, the concept in ONE sentence, prerequisites, labs, desk handoff,
     base bar, wide bar, and the sentence for each near miss. */

  var NODES = [
    { id: "mid", t: "The mid", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.83abcd7f6ef2"),
      labs: [{ k: "ch", i: 6, label: window.DLI18N.t("60-path.d6c9ba05cef4") }],
      desk: { mod: "DLSOR", tab: "ticket", label: window.DLI18N.t("60-path.39caee95fac9") },
      base: ["acad.cexdex", "trade.first"], wide: ["trade.ten"],
      miss: { "acad.cexdex": "the chapter that separates an exchange's book from a chain's state is still unread — it is the vocabulary the rest of this track uses.", "trade.first": "no paper trade on the book yet. Send one, any size: the mid only means something once you have paid the distance from it.", "trade.ten": "one trade is an anecdote. Ten is the point at which the average distance from mid stops being noise." } },

    { id: "spread", t: "Spread vs fee", depthHint: 1, req: ["mid"],
      one: window.DLI18N.t("60-path.4f94f45ca76b"),
      labs: [{ k: "ch", i: 6, label: window.DLI18N.t("60-path.d6c9ba05cef4") }],
      desk: { mod: "DLSOR", tab: "compare", label: window.DLI18N.t("60-path.ca08d17e1ba3") },
      base: ["trade.first", "sor.sent"], wide: ["sor.five"],
      miss: { "sor.sent": "the Compare table ranks on all-in, not on headline price, but it only becomes yours once you have sent one and paid both halves.", "sor.five": "five routes is where the fee half and the spread half separate in your own ledger." } },

    { id: "depth", t: "Depth and impact", depthHint: 2, req: ["spread"],
      one: window.DLI18N.t("60-path.20d940e9c2cf"),
      labs: [{ k: "ch", i: 6, label: window.DLI18N.t("60-path.d6c9ba05cef4") }],
      desk: { mod: "DLSOR", tab: "compare", label: window.DLI18N.t("60-path.3f714426da12") },
      base: ["sor.sent", "sor.scored"], wide: ["sor.tight"],
      miss: { "sor.scored": "a route with no realised figure beside it is a prediction nobody checked. Send one and the ledger will score it.", "sor.tight": "the gap between predicted and realised has not yet come inside 25bp. That gap IS the impact model's error bar." } },

    { id: "slip", t: "Slippage tolerance", depthHint: 3, req: ["depth"],
      one: window.DLI18N.t("60-path.afbc87426046"),
      labs: [{ k: "fn", fn: "openMevGame", label: window.DLI18N.t("60-path.a721d024cb57") }],
      desk: { mod: "DLSOR", tab: "ticket", label: window.DLI18N.t("60-path.9e694bec6d5d") },
      base: ["sor.sent", "order.stop"], wide: ["order.oco"],
      miss: { "order.stop": "no stop has ever rested on your book. A tolerance and a stop are the same instinct at two different timescales.", "order.oco": "an OCO is a tolerance with two sides. Place one and this node widens." } },

    { id: "mev", t: "Sandwich risk", depthHint: 4, req: ["slip"],
      one: window.DLI18N.t("60-path.9030e1d2a7d0"),
      labs: [{ k: "fn", fn: "openMevGame", label: window.DLI18N.t("60-path.a721d024cb57") }, { k: "fn", fn: "openFlash", label: window.DLI18N.t("60-path.eaae6e961792") }],
      desk: { mod: "DLSOR", tab: "compare", label: window.DLI18N.t("60-path.3d42ddb0f802") },
      base: ["lab.mev", "sor.sent"], wide: ["lab.flash"],
      miss: { "lab.mev": "the auction lab is where the bot's arithmetic is visible. Until you have run it the MEV column is a number someone told you.", "lab.flash": "flash loans are the funding side of the same trade — the lab shows where the bot's capital comes from." } },

    { id: "route", t: "Splitting an order", depthHint: 4, req: ["depth", "slip"],
      one: window.DLI18N.t("60-path.a7bdf76824f2"),
      labs: [{ k: "ch", i: 6, label: window.DLI18N.t("60-path.d6c9ba05cef4") }],
      desk: { mod: "DLSOR", tab: "route", label: window.DLI18N.t("60-path.0b080dd09a75") },
      base: ["sor.sent", "sor.split"], wide: ["sor.single"],
      miss: { "sor.split": "every route you have sent went to one venue. Raise the size until the marginal cost of the second venue undercuts the first — that is the whole idea.", "sor.single": "you have not yet seen the router REFUSE to split. Shrink the size until gas eats the second leg and it hands you one venue instead. Knowing when not to split is the other half." } },

    { id: "gas", t: "Fixed cost per leg", depthHint: 5, req: ["route"],
      one: window.DLI18N.t("60-path.415a8808bf85"),
      labs: [{ k: "ch", i: 7, label: window.DLI18N.t("60-path.cee83f210857") }],
      desk: { mod: "DLSOR", tab: "route", label: window.DLI18N.t("60-path.d5239963ae58") },
      base: ["sor.split", "sor.gas"], wide: ["sor.single"],
      miss: { "sor.gas": "none of your sent routes has paid gas, so the fixed cost has never been on your bill. Include the AMM venue and send one.", "sor.single": "the pruning pass drops a leg that cannot pay its gas. You have not yet had one dropped." } },

    { id: "chainfee", t: "Settlement cost", depthHint: 6, req: ["gas"],
      one: window.DLI18N.t("60-path.9774bacfb62a"),
      labs: [{ k: "ch", i: 7, label: window.DLI18N.t("60-path.cee83f210857") }],
      desk: { mod: "DLCHAIN", tab: "chains", label: window.DLI18N.t("60-path.f168432b240b") },
      base: ["acad.smart", "sor.gas"], wide: ["lab.flash"],
      miss: { "acad.smart": "the contracts chapter is where a transaction stops being a message and becomes a thing that costs money to attempt.", "sor.gas": "you have not paid network fees on a route yet, so there is nothing to read them against." } },

    { id: "realised", t: "Realised vs predicted", depthHint: 6, req: ["route", "gas"],
      one: window.DLI18N.t("60-path.9acde6a3eb99"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLSOR", tab: "ledger", label: window.DLI18N.t("60-path.37efb0c2c8de") },
      base: ["sor.scored", "sor.five"], wide: ["sor.tight"],
      miss: { "sor.five": "one scored route tells you about one tick. Five is where the gap starts having a sign you can argue with.", "sor.tight": "your gaps are still wider than 25bp. That is fine and it is information — but the wide bar wants one inside it." } },

    { id: "amm", t: "The curve prices you", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.d13d76db26c0"),
      labs: [{ k: "fn", fn: "openDefiLab", label: window.DLI18N.t("60-path.36e4ed2e9332") }, { k: "ch", i: 8, label: window.DLI18N.t("60-path.0a890dbe17b4") }],
      desk: { mod: "DLDEFI", tab: "pool", label: window.DLI18N.t("60-path.0b07ab505109") },
      base: ["lab.defi", "xp.defi.swap"], wide: ["acad.defi"],
      miss: { "xp.defi.swap": "you have read the curve but not moved it. One swap on the Liquidity desk and the reserve ratio is yours.", "acad.defi": "the DeFi chapter is the slow version of the same idea — worth the fifteen minutes before you commit capital to a range." } },

    { id: "v3range", t: "Concentrated range", depthHint: 1, req: ["amm"],
      one: window.DLI18N.t("60-path.49fab8a67be2"),
      labs: [{ k: "fn", fn: "openDefiLab", label: window.DLI18N.t("60-path.36e4ed2e9332") }],
      desk: { mod: "DLDEFI", tab: "range", label: window.DLI18N.t("60-path.c14982a5513b") },
      base: ["lp.v3", "lp.v3.in"], wide: ["lp.fees"],
      miss: { "lp.v3": "no concentrated position on record. A v2 position is a different lesson — this node wants the one with two prices in it.", "lp.v3.in": "the position exists but the app has never seen spot inside your range while it was open. In range is where the fees are; it is worth seeing the meter on.", "lp.fees": "no fees have accrued yet. Fees are the entire compensation for the risk in the next node." } },

    { id: "il", t: "Divergence loss", depthHint: 2, req: ["v3range"],
      one: window.DLI18N.t("60-path.fa5916d17a09"),
      labs: [{ k: "fn", fn: "openDefiLab", label: window.DLI18N.t("60-path.a4ac163944f7") }],
      desk: { mod: "DLDEFI", tab: "il", label: window.DLI18N.t("60-path.0967f30f46d4") },
      base: ["lp.v3", "lp.v3.oor", "lp.closed"], wide: ["lp.v3.oor2"],
      miss: { "lp.v3.oor": "you opened it, but the price never left your range while the app was watching — and leaving the range is the half the lesson is about. Pick a tighter range, or leave the tab open through a move.", "lp.closed": "you have been out of range but have never closed and taken the number. Divergence loss is not a loss until you realise it; closing is how you find out what it was.", "lp.v3.oor2": "one range break is an event. Two on different days is a pattern, which is what the fee-versus-loss question actually needs." } },

    { id: "feeil", t: "Fees against loss", depthHint: 3, req: ["il"],
      one: window.DLI18N.t("60-path.a5a51f8ec583"),
      labs: [{ k: "fn", fn: "openDefiLab", label: window.DLI18N.t("60-path.a4ac163944f7") }],
      desk: { mod: "DLDEFI", tab: "mine", label: window.DLI18N.t("60-path.c758231a6ab6") },
      base: ["lp.fees", "lp.v3.oor", "lp.closed"], wide: ["lp.v3.oor2", "xp.defi.stake"],
      miss: { "lp.fees": "no fee income on record, so there is nothing to weigh the loss against.", "lp.v3.oor": "the price has not left your range while the app was watching, so the fee income has never had to pay for anything.", "lp.closed": "nothing has been closed, so the fee side and the loss side have never been settled against each other in one number.", "xp.defi.stake": "staking is the comparison case — the same capital, a yield with no divergence risk and no fee upside. The wide bar wants you to have held both." } },

    { id: "lev", t: "What leverage changes", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.1db02477c6d8"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: "exp", label: window.DLI18N.t("60-path.041ecf93eb6e") },
      base: ["perp.open", "trade.first"], wide: ["perp.lev5"],
      miss: { "perp.open": "no leveraged position on record. The number this node is about does not exist until there is margin behind it.", "perp.lev5": "everything so far has been gentle. The wide bar wants one at 5x or more, where the distance to liquidation stops being theoretical." } },

    { id: "liq", t: "Where a position dies", depthHint: 1, req: ["lev"],
      one: window.DLI18N.t("60-path.a2ff71231834"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: "stress", label: window.DLI18N.t("60-path.e354ebed9a1b") },
      base: ["perp.open", "perp.near"], wide: ["perp.closed"],
      miss: { "perp.near": "you have held leverage but the mark has never come within 20% of your liquidation price while the app was watching. The number only becomes real at close range.", "perp.closed": "you have not yet closed one and found out what the distance was worth." } },

    { id: "stop", t: "A stop that can fire", depthHint: 2, req: ["liq"],
      one: window.DLI18N.t("60-path.1263e6dc53a2"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: "stress", label: window.DLI18N.t("60-path.fe9fac01b9ac") },
      base: ["perp.stop", "order.stop"], wide: ["perp.stopnear", "perp.closed"],
      miss: { "perp.stop": "no leveraged position has carried a stop. Until one does, the liquidation price is your only stop and it is set by someone else.", "perp.stopnear": "your stopped position has never been tested — the app has not seen it come within 20% of liquidation with the stop still attached. That is the observation this node is named for.", "perp.closed": "the position is still open. Surviving it means it ended." } },

    { id: "size", t: "Position size", depthHint: 3, req: ["stop"],
      one: window.DLI18N.t("60-path.1acb6b6b4c71"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: "exp", label: window.DLI18N.t("60-path.ffca26963089") },
      base: ["perp.stop", "trade.ten"], wide: ["order.oco"],
      miss: { "trade.ten": "ten trades is the smallest sample where a consistent size stops being a coincidence.", "order.oco": "an OCO fixes both ends of the trade before it starts, which is the same discipline written down." } },

    { id: "funding", t: "Renting a position", depthHint: 2, req: ["lev"],
      one: window.DLI18N.t("60-path.71d4f902b600"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: null, label: window.DLI18N.t("60-path.444c3796c242") },
      base: ["perp.open", "perp.fund"], wide: ["perp.near"],
      miss: { "perp.fund": "your positions have not paid a dollar of funding yet, so the rent is still an abstraction. Hold one through a funding interval.", "perp.near": "funding matters most near the edge, because it is the thing quietly moving the edge towards you." } },

    { id: "lend", t: "Borrow and health", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.85b9994bfd63"),
      labs: [{ k: "fn", fn: "openDefiLab", label: window.DLI18N.t("60-path.cdfc75b6955b") }, { k: "ch", i: 8, label: window.DLI18N.t("60-path.0a890dbe17b4") }],
      desk: { mod: "DLLEND", tab: "market", label: window.DLI18N.t("60-path.5fda59e67192") },
      base: ["lab.defi", "acad.defi"], wide: ["xp.defi.stake"],
      miss: { "acad.defi": "the DeFi chapter covers the utilisation curve that sets the rate you will pay.", "xp.defi.stake": "staking is the same capital without the borrow — worth having held before you lever it." } },

    { id: "optiv", t: "Implied volatility", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.0ad4d989b226"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLOPT", tab: "surface", label: window.DLI18N.t("60-path.0eec5b3e2757") },
      base: ["trade.ten"], wide: ["order.oco"],
      miss: { "trade.ten": "ten trades of directional exposure is the cheapest way to understand why anyone pays for convexity instead.", "order.oco": "an OCO is the poor person's straddle exit — knowing that comparison is the point of the wide bar." } },

    { id: "lookahead", t: "Look-ahead bias", depthHint: 0, req: [],
      one: window.DLI18N.t("60-path.926a1e22fdaa"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLREWIND", tab: null, label: window.DLI18N.t("60-path.e03a319f8234") },
      base: ["bt.causal"], wide: ["bt.oos"],
      miss: { "bt.causal": "the prefix test has not been run. Press it on the Next tab: the same strategy is run on the first 300 bars and on all 600, and the first 300 points of both equity curves must match to the digit. If the engine peeked, they will not.", "bt.oos": "causality is the floor. Holding out data is the next step up." } },

    { id: "oos", t: "Holding out data", depthHint: 1, req: ["lookahead"],
      one: window.DLI18N.t("60-path.847712a34235"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLBOTS", tab: null, label: window.DLI18N.t("60-path.d9c022edf68b") },
      base: ["bt.causal", "bt.oos"], wide: ["bt.oos.three"],
      miss: { "bt.oos": "the split has not been run. It runs the same strategy on the first half and the second half of the series and prints both returns side by side.", "bt.oos.three": "one preset can get lucky on one split. Three is where the shape of the gap starts meaning something." } },

    { id: "costsin", t: "Costs inside the test", depthHint: 2, req: ["oos"],
      one: window.DLI18N.t("60-path.03a0baa2ecfa"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLBOTS", tab: null, label: window.DLI18N.t("60-path.ee193117892a") },
      base: ["bt.oos", "bt.costs"], wide: ["bt.costs.bites"],
      miss: { "bt.costs": "the cost run has not been done. It runs your preset twice — once at zero fee and zero slippage, once at 10bp and 5bp — and prints the difference.", "bt.costs.bites": "costs have not yet moved a run by a full percentage point. Pick a preset that trades more often; that is where the lesson lives." } },

    { id: "dd", t: "Drawdown is history", depthHint: 4, req: ["size", "costsin"],
      one: window.DLI18N.t("60-path.134e1a271ebe"),
      labs: [{ k: "ch", i: 10, label: window.DLI18N.t("60-path.eddd3f72e155") }],
      desk: { mod: "DLRISK", tab: "dd", label: window.DLI18N.t("60-path.6c92a3580cfb") },
      base: ["eq.draw", "trade.ten"], wide: ["eq.down", "perp.closed"],
      miss: { "eq.draw": "your equity history is too short to contain a drawdown. Trade through a few sessions and it will.", "eq.down": "nothing in your history has fallen 5% from a peak yet. The number is honest but it has not been tested.", "perp.closed": "closing a leveraged position is where a drawdown stops being a chart and becomes a balance." } }
  ];

  var BY_ID = (function () { var m = {}, i; for (i = 0; i < NODES.length; i++) m[NODES[i].id] = NODES[i]; return m; })();

  /* ------------------------------------------------------------- the tracks */

  var TRACKS = [
    { id: "amm6", name: "Six weeks to trading a real AMM position",
      sub: window.DLI18N.t("60-path.b1877ab2b201"),
      weeks: [
        { n: 1, outcome: "You can look at a pair and say what a fill of your size would cost, before you send it.", nodes: ["mid", "spread"], gate: ["mid"] },
        { n: 2, outcome: "You can send an order the market cannot surprise you with, because the refusal happens first.", nodes: ["depth", "slip"], gate: ["depth"] },
        { n: 3, outcome: "You can split an order across venues and say why each leg is the size it is.", nodes: ["route", "gas"], gate: ["route"] },
        { n: 4, outcome: "You can put capital into a pool and describe exactly what you now own.", nodes: ["amm", "v3range"], gate: ["amm"] },
        { n: 5, outcome: "You have watched the price leave your range, closed the position, and know what it cost.", nodes: ["il", "feeil"], gate: ["il"] },
        { n: 6, outcome: "You can score the desk's prediction against your own fills and argue with the gap.", nodes: ["realised", "chainfee"], gate: ["realised"] }
      ] },
    { id: "risk4", name: "Four weeks on risk",
      sub: window.DLI18N.t("60-path.209624a2bfb8"),
      weeks: [
        { n: 1, outcome: "You can state the price at which a given position stops existing, and why it moves.", nodes: ["lev", "liq"], gate: ["lev"] },
        { n: 2, outcome: "You can place a stop that is capable of firing, and size the trade from its distance.", nodes: ["stop", "size"], gate: ["stop"] },
        { n: 3, outcome: "You can price the three ways of paying for time: funding, borrow rate and implied vol.", nodes: ["funding", "lend", "optiv"], gate: ["funding"] },
        { n: 4, outcome: "You can read your own worst stretch without flinching, and say what caused it.", nodes: ["dd"], gate: ["dd"] }
      ] },
    { id: "bt3", name: "Three weeks on not fooling yourself with a backtest",
      sub: window.DLI18N.t("60-path.85c047ce8f49"),
      weeks: [
        { n: 1, outcome: "You can prove a run never saw a bar before it was finished.", nodes: ["lookahead"], gate: ["lookahead"] },
        { n: 2, outcome: "You can score a strategy on bars it was never tuned on, and accept the number.", nodes: ["oos"], gate: ["oos"] },
        { n: 3, outcome: "You can state an edge with fees and slippage already inside it.", nodes: ["costsin"], gate: ["costsin"] }
      ] }
  ];

  /* -------------------------------------------------------- topological sort */
  /* Kahn. Anything that does not drain is inside a cycle. */

  function topo() {
    var indeg = {}, adj = {}, i, j, n, r, order = [], q = [], missing = [];
    for (i = 0; i < NODES.length; i++) { indeg[NODES[i].id] = 0; adj[NODES[i].id] = []; }
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      for (j = 0; j < n.req.length; j++) {
        r = n.req[j];
        if (!BY_ID[r]) { missing.push([n.id, r]); continue; }
        adj[r].push(n.id);
        indeg[n.id]++;
      }
    }
    for (i = 0; i < NODES.length; i++) if (indeg[NODES[i].id] === 0) q.push(NODES[i].id);
    q.sort();
    while (q.length) {
      var id = q.shift();
      order.push(id);
      var outs = adj[id];
      for (j = 0; j < outs.length; j++) {
        indeg[outs[j]]--;
        if (indeg[outs[j]] === 0) { q.push(outs[j]); q.sort(); }
      }
    }
    var stuck = [];
    for (i = 0; i < NODES.length; i++) if (order.indexOf(NODES[i].id) < 0) stuck.push(NODES[i].id);
    /* longest-path depth, computed over the drained order only */
    var depth = {};
    for (i = 0; i < order.length; i++) {
      n = BY_ID[order[i]];
      var d = 0;
      for (j = 0; j < n.req.length; j++) if (depth[n.req[j]] != null && depth[n.req[j]] + 1 > d) d = depth[n.req[j]] + 1;
      depth[n.id] = d;
    }
    return { order: order, depth: depth, cycle: stuck, missing: missing };
  }

  var TOPO = topo();
  var GRAPH_OK = TOPO.cycle.length === 0 && TOPO.missing.length === 0 && TOPO.order.length === NODES.length;

  function selfTest() {
    return {
      ok: GRAPH_OK, nodes: NODES.length, ordered: TOPO.order.length,
      cycle: TOPO.cycle.slice(), unresolved: TOPO.missing.slice(),
      atomsUndeclared: undeclaredAtoms()
    };
  }
  function undeclaredAtoms() {
    var out = [], i, j, n, a;
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      var all = n.base.concat(n.wide);
      for (j = 0; j < all.length; j++) { a = all[j]; if (!ATOMS[a] && out.indexOf(a) < 0) out.push(a); }
    }
    return out;
  }

  /* -------------------------------------------------------------- the bucket */
  /* {id,t} pairs and a short list of keys last seen. No score. No percentage. */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.path) X.path = { ev: [], seen: {}, runs: [], track: TRACKS[0].id };
    if (!X.path.ev) X.path.ev = [];
    if (!X.path.seen) X.path.seen = {};
    if (!X.path.runs) X.path.runs = [];
    return X.path;
  }

  function evidence() {
    var b = bucket(), out = [], i;
    if (!b) return out;
    for (i = 0; i < b.ev.length; i++) out.push({ id: b.ev[i].id, t: b.ev[i].t });
    return out;
  }

  /* id -> earliest timestamp. Derived, every call. */
  function seenMap() {
    var b = bucket(), m = {}, i, e;
    if (!b) return m;
    for (i = 0; i < b.ev.length; i++) {
      e = b.ev[i];
      if (!e || !e.id) continue;
      if (m[e.id] == null || e.t < m[e.id]) m[e.id] = e.t;
    }
    return m;
  }

  function record(id, t) {
    if (!ATOMS[id]) return false;
    var b = bucket();
    if (!b) return false;
    var i;
    for (i = 0; i < b.ev.length; i++) if (b.ev[i].id === id) return false;
    b.ev.push({ id: id, t: t || (C.now ? C.now() : 0) });
    if (b.ev.length > EV_CAP) b.ev.splice(0, b.ev.length - EV_CAP);
    try { C.save(); } catch (e) {}
    return true;
  }

  /* ------------------------------------------------------------- observers */

  function Sref() { try { return typeof S !== "undefined" ? S : null; } catch (e) { return null; } }
  function XB() { try { return C.X(); } catch (e) { return null; } }
  function px(sym) { try { var c = C.coin(sym); var v = c && +c.price; return v > 0 ? v : null; } catch (e) { return null; } }

  function ctx() {
    var s = Sref(), x = XB();
    return {
      S: s, X: x,
      stats: (s && s.stats) || null,
      acad: (s && s.acadDone) || [],
      simXP: (s && s.simXP) || {},
      orders: (s && s.orders) || [],
      perps: (s && s.dlsim && s.dlsim.perps) || [],
      eq: (s && s.equityHist) || [],
      lp: (x && x.defi && x.defi.lp) || [],
      xp: (x && x.xp) || {},
      sor: (x && x.sor && x.sor.log) || []
    };
  }

  function has(list, v) { return list && list.indexOf(v) >= 0; }

  /* Every observer returns true when its fact is true RIGHT NOW. */
  var OBS = [
    ["acad.cexdex", function (k) { return has(k.acad, 6); }],
    ["acad.smart", function (k) { return has(k.acad, 7); }],
    ["acad.defi", function (k) { return has(k.acad, 8); }],
    ["lab.defi", function (k) { return !!k.simXP.defi; }],
    ["lab.mev", function (k) { return !!k.simXP.mev; }],
    ["lab.flash", function (k) { return !!k.simXP.flash; }],
    ["trade.first", function (k) { return !!(k.stats && k.stats.trades >= 1); }],
    ["trade.ten", function (k) { return !!(k.stats && k.stats.trades >= 10); }],
    ["order.limit", function (k) { return anyOrder(k, "limit"); }],
    ["order.stop", function (k) { return anyOrder(k, "stop"); }],
    ["order.oco", function (k) { return anyOrder(k, "oco"); }],
    ["order.twap", function (k) { return anyOrder(k, "twap"); }],
    ["sor.sent", function (k) { return k.sor.length >= 1; }],
    ["sor.five", function (k) { return k.sor.length >= 5; }],
    ["sor.split", function (k) { return sorAny(k, function (e) { return okFills(e) >= 2; }); }],
    ["sor.single", function (k) { return sorAny(k, function (e) { return okFills(e) === 1 && e.predicted && e.predicted.bestSingle; }); }],
    ["sor.scored", function (k) { return sorAny(k, function (e) { return e.predicted && e.realised && e.predicted.allInQuote != null && e.realised.allInQuote != null; }); }],
    ["sor.tight", function (k) { return sorAny(k, tightGap); }],
    ["sor.gas", function (k) { return sorAny(k, function (e) { return +e.gasQuote > 0; }); }],
    ["lp.open", function (k) { return k.lp.length >= 1; }],
    ["lp.v3", function (k) { return lpAny(k, function (p) { return p.kind === "v3"; }); }],
    ["lp.fees", function (k) { return lpAny(k, function (p) { return +p.fees > 0; }); }],
    ["lp.v3.in", function (k) { return lpAny(k, function (p) { return rangeState(p) === "in"; }); }],
    ["lp.v3.oor", function (k) { return lpAny(k, function (p) { return rangeState(p) === "out"; }); }],
    ["xp.defi.lp", function (k) { return !!k.xp["defi.lp"]; }],
    ["xp.defi.swap", function (k) { return !!k.xp["defi.swap"]; }],
    ["xp.defi.stake", function (k) { return !!k.xp["defi.stake"]; }],
    ["perp.open", function (k) { return k.perps.length >= 1; }],
    ["perp.lev5", function (k) { return perpAny(k, function (p) { return +p.lev >= 5; }); }],
    ["perp.stop", function (k) { return perpAny(k, function (p) { return +p.sl > 0; }); }],
    ["perp.near", function (k) { return perpAny(k, function (p) { return nearLiq(p) === true; }); }],
    ["perp.stopnear", function (k) { return perpAny(k, function (p) { return +p.sl > 0 && nearLiq(p) === true; }); }],
    ["perp.fund", function (k) { return perpAny(k, function (p) { return Math.abs(+p.fund || 0) > 1; }); }],
    ["eq.draw", function (k) { return k.eq.length >= 8; }],
    ["eq.down", function (k) { return drawdownPct(k.eq) >= 5; }]
  ];

  function anyOrder(k, type) {
    var i;
    for (i = 0; i < k.orders.length; i++) if (String(k.orders[i].type || "").toLowerCase() === type) return true;
    return false;
  }
  function sorAny(k, fn) { var i; for (i = 0; i < k.sor.length; i++) { try { if (fn(k.sor[i])) return true; } catch (e) {} } return false; }
  function lpAny(k, fn) { var i; for (i = 0; i < k.lp.length; i++) { try { if (fn(k.lp[i])) return true; } catch (e) {} } return false; }
  function perpAny(k, fn) { var i; for (i = 0; i < k.perps.length; i++) { try { if (fn(k.perps[i])) return true; } catch (e) {} } return false; }
  function okFills(e) { var n = 0, i, f = e && e.fills; if (!f) return 0; for (i = 0; i < f.length; i++) if (f[i] && f[i].ok) n++; return n; }
  function tightGap(e) {
    if (!e || !e.predicted || !e.realised) return false;
    var p = e.predicted.allInQuote, r = e.realised.allInQuote;
    if (p == null || r == null || !isFinite(p) || !isFinite(r) || Math.abs(p) < 1e-9) return false;
    return Math.abs(r - p) / Math.abs(p) * 1e4 <= 25;
  }

  /* null when we cannot price it — a missing price is not "in range". */
  function rangeState(p) {
    if (!p || p.kind !== "v3") return null;
    var now = px(p.sym);
    if (now == null || !(+p.lo > 0) || !(+p.hi > 0)) return null;
    return (now >= +p.lo && now <= +p.hi) ? "in" : "out";
  }
  function nearLiq(p) {
    var liq = +(p && (p.liq != null ? p.liq : p.liqPx));
    var mark = p && p.sym ? px(p.sym) : null;
    if (!(liq > 0) || mark == null || !(mark > 0)) return null;
    return Math.abs(mark - liq) / mark <= 0.20;
  }
  function drawdownPct(eq) {
    if (!eq || eq.length < 2) return 0;
    var peak = null, worst = 0, i, v;
    for (i = 0; i < eq.length; i++) {
      v = +(eq[i] && eq[i].v != null ? eq[i].v : (eq[i] && eq[i][1] != null ? eq[i][1] : eq[i]));
      if (!(v > 0)) continue;
      if (peak == null || v > peak) peak = v;
      if (peak > 0) { var d = (peak - v) / peak * 100; if (d > worst) worst = d; }
    }
    return worst;
  }

  /* Disappearance: a key we recorded last scan and cannot find now was closed. */
  function lpKey(p) { return String(p.kind || "") + ":" + String(p.sym || "") + ":" + String(p.t || 0); }
  function perpKey(p) { return String(p.sym || "") + ":" + String(p.t || p.at || 0) + ":" + String(p.side || p.dir || ""); }

  function trackDisappearance(k) {
    var b = bucket();
    if (!b) return;
    var i, keys, prev;

    keys = [];
    for (i = 0; i < k.lp.length; i++) if (k.lp[i] && k.lp[i].kind === "v3") keys.push(lpKey(k.lp[i]));
    prev = b.seen.lpv3 || [];
    for (i = 0; i < prev.length; i++) if (keys.indexOf(prev[i]) < 0) { record("lp.closed"); break; }
    b.seen.lpv3 = keys.slice(0, SEEN_CAP);

    keys = [];
    for (i = 0; i < k.perps.length; i++) keys.push(perpKey(k.perps[i]));
    prev = b.seen.perp || [];
    for (i = 0; i < prev.length; i++) if (keys.indexOf(prev[i]) < 0) { record("perp.closed"); break; }
    b.seen.perp = keys.slice(0, SEEN_CAP);
  }

  /* A second range break, on a different calendar day from the first. */
  function trackSecondBreak(k) {
    var b = bucket();
    if (!b) return;
    var out = lpAny(k, function (p) { return rangeState(p) === "out"; });
    if (!out) return;
    var d = dayKey(C.now ? C.now() : 0);
    var days = b.seen.oorDays || [];
    if (days.indexOf(d) < 0) { days.push(d); b.seen.oorDays = days.slice(-8); }
    if ((b.seen.oorDays || []).length >= 2) record("lp.v3.oor2");
  }
  function dayKey(t) {
    if (!(t > 0)) return "0";
    try { return new Date(t).toISOString().slice(0, 10); } catch (e) { return "0"; }
  }

  var lastScan = 0;
  function scan(force) {
    var now = C.now ? C.now() : 0;
    if (!force && now - lastScan < 45000) return 0;
    lastScan = now;
    var k = ctx(), n = 0, i;
    for (i = 0; i < OBS.length; i++) {
      try { if (OBS[i][1](k) === true && record(OBS[i][0], now)) n++; } catch (e) {}
    }
    try { trackDisappearance(k); } catch (e) {}
    try { trackSecondBreak(k); } catch (e) {}
    if (n) { try { C.save(); } catch (e) {} }
    return n;
  }

  /* ------------------------------------------------ the three backtest runs */
  /* These are the live surface for the backtest nodes: the desk starts a real
     run on the Bots engine and records what came back, numbers and all. */

  function bots() { try { return window.DLAPP && window.DLAPP.bots; } catch (e) { return null; } }
  function proofBars(n) {
    try { if (window.DLBOTS && typeof window.DLBOTS.btBars === "function") return window.DLBOTS.btBars(n); } catch (e) {}
    return null;
  }
  function presetStrategy(id) {
    var B = bots();
    try { var p = B.preset(id); return p && p.strategy; } catch (e) { return null; }
  }
  function curveOf(r) { try { return (r && r.curve) || []; } catch (e) { return []; } }
  function retOf(r) { try { var v = r && r.score && r.score.returnPct; return v == null || !isFinite(v) ? null : +v; } catch (e) { return null; } }

  function pushRun(run) {
    var b = bucket();
    if (!b) return;
    b.runs.unshift(run);
    if (b.runs.length > RUN_CAP) b.runs.length = RUN_CAP;
    try { C.save(); } catch (e) {}
  }
  function runs() { var b = bucket(); return b ? b.runs.slice() : []; }

  /* The causality test: run the SAME strategy on the first half and on the
     whole series. If the engine never reads a bar before it closes, the first
     half of the full run's equity curve is IDENTICAL to the short run's. */
  function checkCausal(presetId) {
    var B = bots(), bars = proofBars(600), strat = presetStrategy(presetId || "rsi");
    if (!B || !bars || !bars.length || !strat) return { ok: false, reason: "the Bots engine is not in this build, so the prefix test cannot run" };
    var half = Math.floor(bars.length / 2);
    var full, part;
    try {
      full = B.runStrategy(strat, bars, 10000, 0, { slipBps: 0 });
      part = B.runStrategy(strat, bars.slice(0, half), 10000, 0, { slipBps: 0 });
    } catch (e) { return { ok: false, reason: "the run threw: " + ((e && e.message) || e) }; }
    var a = curveOf(part), c = curveOf(full), n = Math.min(a.length, c.length), i, bad = -1;
    for (i = 0; i < n; i++) {
      if (!same(a[i], c[i])) { bad = i; break; }
    }
    var ok = bad < 0 && n > 0;
    var run = { kind: "causal", t: C.now ? C.now() : 0, preset: presetId || "rsi", bars: bars.length, compared: n, firstDiff: bad, ok: ok };
    pushRun(run);
    record(ok ? "bt.causal" : "bt.causal.fail");
    return { ok: ok, run: run, reason: ok ? null : "the curves diverged at point " + bad + " — the shorter run and the longer run disagree about a bar they both had" };
  }
  function same(x, y) {
    if (x == null || y == null) return false;
    var xv = x.length != null ? x[1] : x, yv = y.length != null ? y[1] : y;
    return +xv === +yv;
  }

  /* Held-out data: the same strategy on two disjoint halves. */
  function checkOOS(presetId) {
    var B = bots(), bars = proofBars(600), strat = presetStrategy(presetId || "rsi");
    if (!B || !bars || !bars.length || !strat) return { ok: false, reason: "the Bots engine is not in this build, so the split cannot run" };
    var h = Math.floor(bars.length / 2), a, b2;
    try {
      a = B.runStrategy(strat, bars.slice(0, h), 10000, 0.001, { slipBps: 5 });
      b2 = B.runStrategy(strat, bars.slice(h), 10000, 0.001, { slipBps: 5 });
    } catch (e) { return { ok: false, reason: "the run threw: " + ((e && e.message) || e) }; }
    var inP = retOf(a), outP = retOf(b2);
    var run = { kind: "oos", t: C.now ? C.now() : 0, preset: presetId || "rsi", inPct: inP, outPct: outP, gap: (inP == null || outP == null) ? null : inP - outP };
    pushRun(run);
    record("bt.oos");
    var seen = {}, list = runs(), i, n = 0;
    for (i = 0; i < list.length; i++) if (list[i].kind === "oos" && !seen[list[i].preset]) { seen[list[i].preset] = 1; n++; }
    if (n >= 3) record("bt.oos.three");
    return { ok: true, run: run, presets: n };
  }

  /* Costs: the same strategy, free and charged. */
  function checkCosts(presetId) {
    var B = bots(), bars = proofBars(600), strat = presetStrategy(presetId || "rsi");
    if (!B || !bars || !bars.length || !strat) return { ok: false, reason: "the Bots engine is not in this build, so the cost run cannot happen" };
    var free, paid;
    try {
      free = B.runStrategy(strat, bars, 10000, 0, { slipBps: 0 });
      paid = B.runStrategy(strat, bars, 10000, 0.001, { slipBps: 5 });
    } catch (e) { return { ok: false, reason: "the run threw: " + ((e && e.message) || e) }; }
    var f = retOf(free), p = retOf(paid);
    var delta = (f == null || p == null) ? null : f - p;
    var run = { kind: "costs", t: C.now ? C.now() : 0, preset: presetId || "rsi", freePct: f, paidPct: p, deltaPct: delta, trades: (paid.score && paid.score.trades) || null };
    pushRun(run);
    record("bt.costs");
    if (delta != null && Math.abs(delta) >= 1) record("bt.costs.bites");
    return { ok: true, run: run };
  }

  /* --------------------------------------------------------- the evidence bar */

  function reliability() {
    var m = seenMap(), i, j, n, conf = 0, near = 0;
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      for (j = 0; j < n.base.length; j++) { if (m[n.base[j]] != null) conf++; else near++; }
    }
    if (m["bt.causal.fail"] != null) near += 2;
    var tot = conf + near;
    return tot > 0 ? conf / tot : 0;
  }

  var WIDE_AT = 0.80, NARROW_UNDER = 0.50;

  function barFor(id) {
    var n = BY_ID[id];
    if (!n) return null;
    var m = seenMap(), i, have = 0;
    for (i = 0; i < n.base.length; i++) if (m[n.base[i]] != null) have++;
    var rel = reliability();
    var wide = rel >= WIDE_AT && have >= 1 && n.wide.length > 0;
    var need = n.base.slice();
    if (wide) for (i = 0; i < n.wide.length; i++) if (need.indexOf(n.wide[i]) < 0) need.push(n.wide[i]);
    return {
      level: wide ? "wide" : (rel < NARROW_UNDER ? "base-scaffold" : "base"),
      need: need, base: n.base.slice(), extra: n.wide.slice(), reliability: rel,
      why: wide
        ? "your recorded reliability is " + rel.toFixed(2) + ", at or above " + WIDE_AT.toFixed(2) + ", and this node already has one confirmation — so it is asking for the harder version of the same evidence."
        : (rel < NARROW_UNDER
          ? "your recorded reliability is " + rel.toFixed(2) + ", under " + NARROW_UNDER.toFixed(2) + " — the bar stays at base and this node surfaces every lab it has. Nothing is hidden either way."
          : "base bar. It widens at a reliability of " + WIDE_AT.toFixed(2) + " once this node has one confirmation.")
    };
  }

  function mastery(id) {
    var n = BY_ID[id];
    if (!n) return null;
    var m = seenMap(), bar = barFor(id), i, a;
    var have = [], missing = [], last = 0, first = null;
    for (i = 0; i < bar.need.length; i++) {
      a = bar.need[i];
      if (m[a] != null) {
        have.push({ id: a, t: m[a] });
        if (m[a] > last) last = m[a];
        if (first == null || m[a] < first) first = m[a];
      } else missing.push({ id: a, label: ATOMS[a] ? ATOMS[a][0] : a, why: missWhy(n, a, m) });
    }
    var met = missing.length === 0 && bar.need.length > 0;
    /* reps: one per distinct atom recorded across base AND wide, capped */
    var reps = 0, all = n.base.concat(n.wide);
    for (i = 0; i < all.length; i++) if (m[all[i]] != null) reps++;
    if (reps > 8) reps = 8;
    var wideMet = n.wide.length > 0;
    for (i = 0; i < n.wide.length; i++) if (m[n.wide[i]] == null) wideMet = false;
    var nearMissed = m["bt.causal.fail"] != null && (id === "lookahead" || id === "oos");
    var q = !met ? 0 : (wideMet ? 5 : (nearMissed ? 3 : 4));
    return {
      id: id, title: n.t, met: met, have: have, missing: missing,
      reps: reps, q: q, firstAt: first, lastAt: last || null,
      bar: bar, ready: ready(id), locked: !ready(id)
    };
  }

  /* A near miss is more useful than a fraction, and a check that RAN and failed
     deserves a different sentence from one that was never pressed. */
  function missWhy(n, a, m) {
    if (a === "bt.causal" && m["bt.causal.fail"] != null) {
      return "the prefix test ran and it FAILED: the 300-bar run and the 600-bar run disagreed about a bar they both had. That is a real finding about this build, not a mistake of yours \u2014 the run row below says where they parted.";
    }
    if (a === "lp.closed" && m["lp.v3"] != null && m["lp.v3.oor"] == null) {
      return "the position is still open and has never been out of range while the app was watching, so closing it now would settle nothing this node is about.";
    }
    if (a === "sor.tight" && m["sor.scored"] != null) {
      return "you have scored routes, but none has come inside 25bp of its prediction yet. That is information about the model, not a failure \u2014 the wide bar simply wants one.";
    }
    return (n.miss && n.miss[a]) || "no evidence recorded for this yet.";
  }

  function ready(id) {
    var n = BY_ID[id];
    if (!n) return false;
    var i;
    for (i = 0; i < n.req.length; i++) {
      var mm = BY_ID[n.req[i]] ? mastery(n.req[i]) : null;
      if (!mm || !mm.met) return false;
    }
    return true;
  }

  /* --------------------------------------------- SM-2 variant, all derived */

  var EF0 = 2.5, EF_MIN = 1.3, EF_MAX = 2.7, I1 = 1, I2 = 6, I_CAP = 180;

  function easeFor(reps, q) {
    var ef = EF0, i, d;
    for (i = 0; i < reps; i++) {
      d = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
      ef = ef + d;
      if (ef < EF_MIN) ef = EF_MIN;
      if (ef > EF_MAX) ef = EF_MAX;
    }
    return ef;
  }

  function intervalFor(reps, ef) {
    if (reps <= 0) return 0;
    if (reps === 1) return I1;
    if (reps === 2) return I2;
    var iv = I2, i;
    for (i = 3; i <= reps; i++) {
      iv = Math.round(iv * ef);
      if (iv > I_CAP) { iv = I_CAP; break; }
    }
    return iv > I_CAP ? I_CAP : iv;
  }

  /* Half-life decay with the half-life set to the current interval, so a
     concept is due exactly when strength reaches 0.5. */
  function strengthAt(elapsedDays, intervalDays) {
    if (!(intervalDays > 0)) return 0;
    return Math.pow(2, -elapsedDays / intervalDays);
  }

  function schedule(id) {
    var mm = mastery(id);
    if (!mm) return null;
    if (!mm.met) return { id: id, met: false, reps: mm.reps, ef: null, intervalDays: null, elapsedDays: null, strength: null, due: false, overdue: 0 };
    var ef = easeFor(mm.reps, mm.q);
    var iv = intervalFor(mm.reps, ef);
    var now = C.now ? C.now() : 0;
    var elapsed = mm.lastAt ? (now - mm.lastAt) / DAY_MS : 0;
    var st = strengthAt(elapsed, iv);
    return {
      id: id, met: true, reps: mm.reps, q: mm.q, ef: ef, intervalDays: iv,
      elapsedDays: elapsed, strength: st, due: elapsed >= iv,
      overdue: iv > 0 ? elapsed / iv : 0
    };
  }

  function due() {
    var out = [], i, s;
    for (i = 0; i < NODES.length; i++) {
      s = schedule(NODES[i].id);
      if (s && s.met && s.due) out.push(s);
    }
    out.sort(function (a, b) { return b.overdue - a.overdue || (a.id < b.id ? -1 : 1); });
    return out;
  }

  /* ----------------------------------------------------------- progress */
  /* Derived, every call. There is no stored figure to disagree with this. */

  function progress(trackId) {
    var i, n, mm, met = 0, total = 0, readyN = 0, list = [];
    var ids = trackId ? trackNodeIds(trackId) : null;
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      if (ids && ids.indexOf(n.id) < 0) continue;
      total++;
      mm = mastery(n.id);
      if (mm.met) met++; else if (mm.ready) readyN++;
      list.push({ id: n.id, met: mm.met, ready: mm.ready, missing: mm.missing.length });
    }
    return { total: total, met: met, ready: readyN, pct: total ? met / total : null, nodes: list, reliability: reliability() };
  }

  function trackNodeIds(id) {
    var t = trackById(id), out = [], i, j;
    if (!t) return [];
    for (i = 0; i < t.weeks.length; i++) for (j = 0; j < t.weeks[i].nodes.length; j++) if (out.indexOf(t.weeks[i].nodes[j]) < 0) out.push(t.weeks[i].nodes[j]);
    return out;
  }
  function trackById(id) { var i; for (i = 0; i < TRACKS.length; i++) if (TRACKS[i].id === id) return TRACKS[i]; return null; }

  function currentTrack() {
    var b = bucket();
    var id = (b && b.track) || TRACKS[0].id;
    return trackById(id) || TRACKS[0];
  }
  function setTrack(id) {
    var b = bucket();
    if (!b || !trackById(id)) return false;
    b.track = id;
    try { C.save(); } catch (e) {}
    return true;
  }

  function weekOf(trackId) {
    var t = trackById(trackId) || currentTrack(), i, j, gateMet;
    for (i = 0; i < t.weeks.length; i++) {
      gateMet = true;
      for (j = 0; j < t.weeks[i].gate.length; j++) {
        var mm = mastery(t.weeks[i].gate[j]);
        if (!mm || !mm.met) { gateMet = false; break; }
      }
      if (!gateMet) return { track: t, week: t.weeks[i], index: i, done: false };
    }
    return { track: t, week: t.weeks[t.weeks.length - 1], index: t.weeks.length - 1, done: true };
  }

  /* -------------------------------------------------------------- next() */

  var REVIEW_AT = 1.5;

  function next(trackId) {
    if (!GRAPH_OK) return { kind: "broken", why: "the shipped curriculum graph does not sort — see the Map tab.", node: null };
    var d = due();
    if (d.length && d[0].overdue >= REVIEW_AT) {
      return { kind: "review", node: BY_ID[d[0].id], schedule: d[0],
        why: "you met this " + fmtDays(d[0].elapsedDays) + " ago and its interval is " + d[0].intervalDays + " days, so modelled recall is down to " + d[0].strength.toFixed(2) + ". New work on a decayed foundation is the expensive kind." };
    }
    var w = weekOf(trackId || currentTrack().id);
    var pool = w.week ? w.week.nodes.slice() : [];
    var pick = choose(pool);
    if (pick) return { kind: "learn", node: BY_ID[pick.id], mastery: pick, week: w, why: "every prerequisite is met and it is the fewest-missing node in week " + w.week.n + "." };
    /* the week's nodes are all done or all blocked — widen to the whole graph */
    var all = [], i;
    for (i = 0; i < NODES.length; i++) all.push(NODES[i].id);
    pick = choose(all);
    if (pick) return { kind: "learn", node: BY_ID[pick.id], mastery: pick, week: w, why: "this track's current week has nothing open, so the choice widened to the whole graph." };
    if (d.length) return { kind: "review", node: BY_ID[d[0].id], schedule: d[0], why: "nothing new is ready, and this one is due." };
    var blocked = blockedList();
    if (blocked.length) return { kind: "blocked", node: BY_ID[blocked[0]], why: "nothing is ready: every remaining node is waiting on a prerequisite. The nearest is " + blocked[0] + "." };
    return { kind: "done", node: null, why: "every node in the shipped graph has its evidence. That is not a certificate — it is a list of things this app watched you do." };
  }

  function choose(ids) {
    var best = null, i, mm;
    for (i = 0; i < ids.length; i++) {
      if (!BY_ID[ids[i]]) continue;
      mm = mastery(ids[i]);
      if (mm.met || !mm.ready) continue;
      if (!best) { best = mm; continue; }
      var a = mm.missing.length, b = best.missing.length;
      if (a < b) { best = mm; continue; }
      if (a > b) continue;
      var da = TOPO.depth[mm.id] == null ? 99 : TOPO.depth[mm.id];
      var db = TOPO.depth[best.id] == null ? 99 : TOPO.depth[best.id];
      if (da < db) { best = mm; continue; }
      if (da > db) continue;
      if (mm.id < best.id) best = mm;
    }
    return best;
  }
  function blockedList() {
    var out = [], i, mm;
    for (i = 0; i < TOPO.order.length; i++) {
      mm = mastery(TOPO.order[i]);
      if (!mm.met && !mm.ready) out.push(mm.id);
    }
    return out;
  }

  /* --------------------------------------------------------- the handoffs */

  var DESKS = {
    DLSOR: "Execution", DLDEFI: "Liquidity", DLREWIND: "Rewind", DLBOTS: "Bots",
    DLCHAIN: "Chain", DLRISK: "Risk", DLLEND: "Lending", DLOPT: "Options"
  };

  function deskLive(mod) {
    try { var m = window[mod]; return !!(m && typeof m.open === "function"); } catch (e) { return false; }
  }
  function handoff(id) {
    var n = BY_ID[id];
    if (!n || !n.desk) return null;
    var live = deskLive(n.desk.mod);
    return {
      mod: n.desk.mod, tab: n.desk.tab, label: n.desk.label,
      deskName: DESKS[n.desk.mod] || n.desk.mod, live: live,
      state: live ? "ready" : "absent",
      note: live ? null : (DESKS[n.desk.mod] || n.desk.mod) + " desk is not in this build"
    };
  }
  function jump(id) {
    var h = handoff(id);
    if (!h || !h.live) return false;
    try { window[h.mod].open(h.tab || undefined); return true; } catch (e) { return false; }
  }

  function labLive(l) {
    try {
      if (l.k === "fn") return typeof window[l.fn] === "function";
      if (l.k === "ch") return typeof window.enterLesson === "function" && typeof window.nav === "function";
    } catch (e) {}
    return false;
  }
  function labGo(nodeId, idx) {
    var n = BY_ID[nodeId];
    if (!n || !n.labs[idx]) return false;
    var l = n.labs[idx];
    if (!labLive(l)) return false;
    try {
      if (l.k === "fn") { window[l.fn](); return true; }
      window.nav("learn");
      setTimeout(function () { try { window.enterLesson(l.i); } catch (e) {} }, 380);
      try { C.close && C.close("dlPath"); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------- the map */
  /* Layout is computed from the topological depth. Same graph, same picture. */

  var NW = 146, NH = 40, COLW = 196, ROWH = 58, PADX = 14, PADY = 20;

  function layout() {
    var cols = {}, i, id, d, maxD = 0;
    for (i = 0; i < TOPO.order.length; i++) {
      id = TOPO.order[i];
      d = TOPO.depth[id] || 0;
      if (!cols[d]) cols[d] = [];
      cols[d].push(id);
      if (d > maxD) maxD = d;
    }
    var pos = {}, maxRows = 0, k;
    for (d = 0; d <= maxD; d++) {
      var col = cols[d] || [];
      if (col.length > maxRows) maxRows = col.length;
      for (k = 0; k < col.length; k++) {
        pos[col[k]] = { x: PADX + d * COLW, y: PADY + k * ROWH, d: d, r: k };
      }
    }
    return {
      pos: pos, cols: cols, maxDepth: maxD, maxRows: maxRows,
      w: PADX * 2 + maxD * COLW + NW, h: PADY * 2 + Math.max(1, maxRows) * ROWH
    };
  }

  function mapSVG() {
    var L = layout(), i, j, n, p, q, h = "";
    var W = L.w, H = L.h;
    h += '<svg class="pth-map" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="curriculum graph: concepts and prerequisites">';
    /* edges first so nodes sit on top */
    h += '<g class="pth-edges">';
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      q = L.pos[n.id];
      if (!q) continue;
      for (j = 0; j < n.req.length; j++) {
        p = L.pos[n.req[j]];
        if (!p) continue;
        var x1 = p.x + NW, y1 = p.y + NH / 2, x2 = q.x, y2 = q.y + NH / 2;
        var mx = (x1 + x2) / 2;
        var met = mastery(n.req[j]).met;
        h += '<path class="pth-e' + (met ? " is-met" : "") + '" d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2 + '"/>';
      }
    }
    h += '</g><g class="pth-nodes">';
    for (i = 0; i < NODES.length; i++) {
      n = NODES[i];
      q = L.pos[n.id];
      if (!q) continue;
      var mm = mastery(n.id), sc = schedule(n.id);
      var cls = mm.met ? (sc && sc.due ? "is-due" : "is-met") : (mm.ready ? "is-ready" : "is-locked");
      h += '<g class="pth-n ' + cls + '" data-node="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.t + " — " + (mm.met ? "evidence recorded" : mm.ready ? "ready, no evidence" : "waiting on a prerequisite")) + '">';
      h += '<rect x="' + q.x + '" y="' + q.y + '" width="' + NW + '" height="' + NH + '" rx="9"/>';
      h += '<text x="' + (q.x + 11) + '" y="' + (q.y + 17) + '">' + esc(clip(n.t, 19)) + '</text>';
      h += '<text class="pth-nsub" x="' + (q.x + 11) + '" y="' + (q.y + 31) + '">' + esc(mm.met ? (mm.have.length + "/" + mm.bar.need.length + " evidence") : (mm.ready ? (mm.have.length + "/" + mm.bar.need.length + " evidence") : "locked")) + '</text>';
      h += "</g>";
    }
    h += "</g></svg>";
    return h;
  }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  /* ------------------------------------------------------------ formatting */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fmtDays(d) {
    if (d == null || !isFinite(d)) return "an unknown time";
    if (d < 1) return Math.max(1, Math.round(d * 24)) + "h";
    return d.toFixed(d < 10 ? 1 : 0) + "d";
  }
  function when(t) {
    if (!(t > 0)) return "—";
    try { return new Date(t).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; }
  }
  function pctTxt(v) { return v == null ? "—" : (v * 100).toFixed(0) + "%"; }
  function num(v, dp) { return v == null || !isFinite(v) ? "—" : (+v).toFixed(dp == null ? 2 : dp); }

  /* ------------------------------------------------------------------ the UI */

  function brokenPane() {
    var st = selfTest();
    return ('<div class="pth-warn"><b>' + window.DLI18N.t("60-path.33e72a3fd00c") + '</b> ') +
      (st.cycle.length ? "These nodes are inside a cycle and cannot be ordered: " + esc(st.cycle.join(", ")) + ". " : "") +
      (st.unresolved.length ? "These prerequisites name a node that does not exist: " + esc(st.unresolved.join(" / ")) + ". " : "") +
      ('' + window.DLI18N.t("60-path.f9604e82070b") + '</div>');
  }

  function paneTrack() {
    if (!GRAPH_OK) return brokenPane();
    var t = currentTrack(), w = weekOf(t.id), pr = progress(t.id), h = "", i, j;
    h += ('<div class="pth-note">' + window.DLI18N.t("60-path.0047772aaf2e") + '</div>');
    h += '<div class="dl-chips pth-tracks">';
    for (i = 0; i < TRACKS.length; i++) h += '<button class="dl-chip' + (TRACKS[i].id === t.id ? " on" : "") + '" data-track="' + esc(TRACKS[i].id) + '">' + esc(TRACKS[i].name) + "</button>";
    h += "</div>";
    h += '<div class="pth-thead"><b>' + esc(t.name) + "</b><span>" + esc(t.sub) + "</span></div>";
    h += '<div class="pth-stat"><span>' + pr.met + " of " + pr.total + ('' + window.DLI18N.t("60-path.91e6c9d30ec8") + '</span><span>') + pr.ready + (window.DLI18N.t("60-path.bce25e79d731") + "</span><span>" + window.DLI18N.t("60-path.a73b78bb46f6")) + num(pr.reliability, 2) + "</span></div>";
    h += ('<div class="pth-hon">' + window.DLI18N.t("60-path.1e70d9b57708") + '</div>');

    for (i = 0; i < t.weeks.length; i++) {
      var wk = t.weeks[i], gateMet = true;
      for (j = 0; j < wk.gate.length; j++) if (!mastery(wk.gate[j]).met) gateMet = false;
      h += '<div class="pth-week' + (i === w.index && !w.done ? " is-now" : "") + (gateMet ? " is-open" : "") + '">';
      h += ('<div class="pth-wk">' + window.DLI18N.t("60-path.88fb6deff149") + '') + wk.n + (i === w.index && !w.done ? " · current" : "") + "</div>";
      h += '<div class="pth-wo">' + esc(wk.outcome) + "</div>";
      h += '<div class="pth-wn">';
      for (j = 0; j < wk.nodes.length; j++) {
        var mm = mastery(wk.nodes[j]);
        h += '<button class="pth-chip ' + (mm.met ? "is-met" : mm.ready ? "is-ready" : "is-locked") + '" data-node="' + esc(wk.nodes[j]) + '">' + esc(mm.title) + '<span>' + mm.have.length + "/" + mm.bar.need.length + "</span></button>";
      }
      h += "</div>";
      h += ('<div class="pth-gate">' + window.DLI18N.t("60-path.fee733dc5dc2") + '') + (wk.n + 1) + ": " + esc(gateLabel(wk.gate)) + " — " + (gateMet ? "met" : "not met") + ".</div>";
      h += "</div>";
    }
    return h;
  }
  function gateLabel(gate) {
    var out = [], i;
    for (i = 0; i < gate.length; i++) out.push(BY_ID[gate[i]] ? BY_ID[gate[i]].t : gate[i]);
    return out.join(" and ");
  }

  function paneNext() {
    if (!GRAPH_OK) return brokenPane();
    scan(true);
    var nx = next(), h = "";
    if (!nx.node) return '<div class="pth-empty">' + esc(nx.why) + "</div>";
    var n = nx.node, mm = mastery(n.id), sc = schedule(n.id), bar = mm.bar, i;

    h += '<div class="pth-kind">' + esc(nx.kind === "review" ? "Review" : nx.kind === "blocked" ? "Blocked" : "Next") + "</div>";
    h += '<div class="pth-title">' + esc(n.t) + "</div>";
    h += '<div class="pth-one">' + esc(n.one) + "</div>";
    h += '<div class="pth-why">' + esc(nx.why) + "</div>";

    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.f1b0012be62d") + '</div>');
    h += '<div class="pth-barnote">' + esc(bar.why) + "</div>";
    h += '<ul class="pth-ev">';
    for (i = 0; i < mm.have.length; i++) {
      h += ('<li class="is-have"><b>' + window.DLI18N.t("60-path.193c45b52819") + '</b> ') + esc(ATOMS[mm.have[i].id] ? ATOMS[mm.have[i].id][0] : mm.have[i].id) + ' <span>' + esc(when(mm.have[i].t)) + "</span></li>";
    }
    for (i = 0; i < mm.missing.length; i++) {
      h += ('<li class="is-miss"><b>' + window.DLI18N.t("60-path.ffa63583dfa6") + '</b> ') + esc(mm.missing[i].label) + '<span class="pth-miss">' + esc(mm.missing[i].why) + "</span></li>";
    }
    h += "</ul>";

    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.844675f9a66a") + '</div><div class="pth-acts">');
    for (i = 0; i < n.labs.length; i++) {
      var live = labLive(n.labs[i]);
      h += live
        ? '<button class="dl-b" data-lab="' + esc(n.id) + '" data-i="' + i + '">' + esc(n.labs[i].label) + "</button>"
        : '<span class="dl-dis pth-dead">' + esc(n.labs[i].label) + (window.DLI18N.t("60-path.54f4d8fcbe42") + "</span>");
    }
    h += "</div>";

    var ho = handoff(n.id);
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.1ccff2b8a90a") + '</div><div class="pth-acts">');
    if (ho && ho.live) h += '<button class="go" data-desk="' + esc(n.id) + '">' + esc(ho.deskName + " · " + ho.label) + "</button>";
    else if (ho) h += '<span class="dl-dis pth-dead">' + esc(ho.deskName + " · " + ho.label) + " — " + esc(ho.note) + "</span>";
    else h += ('<span class="dl-dis pth-dead">' + window.DLI18N.t("60-path.d66617d98b5a") + '</span>');
    h += "</div>";

    if (n.id === "lookahead" || n.id === "oos" || n.id === "costsin") h += paneChecks(n.id);

    if (sc && sc.met) {
      h += ('<div class="pth-sched">' + window.DLI18N.t("60-path.c710c7970ad8") + '') + sc.reps + " rep" + (sc.reps === 1 ? "" : "s") + ", quality " + sc.q + ", ease " + num(sc.ef, 2) +
        ", interval " + sc.intervalDays + "d. Last evidence " + fmtDays(sc.elapsedDays) + " ago, so modelled recall strength is " + num(sc.strength, 2) +
        (sc.due ? " — due." : " — not due yet.") + "</div>";
    }
    return h;
  }

  function paneChecks(id) {
    var h = ('<div class="pth-sub">' + window.DLI18N.t("60-path.15733b2efdee") + '</div>');
    var live = !!bots() && !!proofBars(8);
    if (!live) return h + ('<div class="pth-dead dl-dis">' + window.DLI18N.t("60-path.85f624ca3e02") + '</div>');
    h += ('<div class="pth-note">' + window.DLI18N.t("60-path.0d267cd3af42") + '</div>');
    h += '<div class="pth-acts">';
    h += ('<select class="dl-inp pth-preset" id="pthPreset" aria-label="' + window.DLI18N.t("60-path.7252e7ce0085") + '"><option value="rsi">' + window.DLI18N.t("60-path.f0f8270db484") + '</option><option value="sma">' + window.DLI18N.t("60-path.e4d00226255e") + '</option><option value="ema">' + window.DLI18N.t("60-path.8c15a763882d") + '</option><option value="macd">' + window.DLI18N.t("60-path.ed9760edaeb4") + '</option></select>');
    if (id === "lookahead") h += ('<button class="go" data-run="causal">' + window.DLI18N.t("60-path.1219d3203be0") + '</button>');
    if (id === "oos") h += ('<button class="go" data-run="oos">' + window.DLI18N.t("60-path.4dcf93dd069b") + '</button>');
    if (id === "costsin") h += ('<button class="go" data-run="costs">' + window.DLI18N.t("60-path.16b583315ef9") + '</button>');
    h += "</div>";
    var rs = runs(), i, r, shown = 0;
    if (rs.length) {
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("60-path.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("60-path.00d60e31a4e6") + '</th><th>' + window.DLI18N.t("60-path.7252e7ce0085") + '</th><th>' + window.DLI18N.t("60-path.6e7d50e84f47") + '</th></tr></thead><tbody>');
      for (i = 0; i < rs.length && shown < 8; i++) {
        r = rs[i];
        shown++;
        h += "<tr><td>" + esc(when(r.t)) + "</td><td>" + esc(r.kind) + "</td><td>" + esc(r.preset) + "</td><td>" + esc(runTxt(r)) + "</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    return h;
  }
  function runTxt(r) {
    if (r.kind === "causal") return r.ok ? "first " + r.compared + " curve points identical — no bar was read before it closed" : "diverged at point " + r.firstDiff;
    if (r.kind === "oos") return "in " + num(r.inPct, 2) + "% / out " + num(r.outPct, 2) + "% · gap " + num(r.gap, 2) + "pp";
    if (r.kind === "costs") return "free " + num(r.freePct, 2) + "% / costed " + num(r.paidPct, 2) + "% · costs took " + num(r.deltaPct, 2) + "pp over " + (r.trades == null ? "?" : r.trades) + " trades";
    return "—";
  }

  function paneMap() {
    if (!GRAPH_OK) return brokenPane();
    /* The column count belongs to the LAYOUT, not to the topological sort, and
       reading it off TOPO put the literal word "undefined" on the screen. Take
       it from the same layout the picture is drawn from, and print a named
       fallback rather than a bare concatenation if it is ever missing. */
    var L = layout();
    var cols = num0(L.maxDepth == null ? null : L.maxDepth + 1);
    var h = ('<div class="pth-note">' + window.DLI18N.t("60-path.98e5210bb046") + '</div>');
    h += ('<div class="pth-legend"><span class="pth-key is-met">' + window.DLI18N.t("60-path.a2049acd5c7b") + '</span><span class="pth-key is-due">' + window.DLI18N.t("60-path.efeeb2bfa2fb") + '</span><span class="pth-key is-ready">' + window.DLI18N.t("60-path.93b3823e5571") + '</span><span class="pth-key is-locked">' + window.DLI18N.t("60-path.207a203fb168") + '</span></div>');
    h += '<div class="pth-mapw">' + mapSVG() + "</div>";
    h += '<div class="pth-note">' + num0(NODES.length) + " nodes, " + num0(edgeCount()) + " prerequisite edges, " + cols + (window.DLI18N.t("60-path.b8076ea4bc3e") + "</div>");
    return h;
  }
  /* A whole number for the screen. A missing count is named, never concatenated
     into a sentence as undefined or NaN. */
  function num0(v) { return (v == null || !isFinite(v)) ? "an unknown number of" : String(Math.round(v)); }
  function edgeCount() { var n = 0, i; for (i = 0; i < NODES.length; i++) n += NODES[i].req.length; return n; }

  function paneEvidence() {
    if (!GRAPH_OK) return brokenPane();
    scan(true);
    var m = seenMap(), keys = [], k, i, h = "";
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) keys.push(k);
    keys.sort(function (a, b) { return m[b] - m[a]; });
    h += ('<div class="pth-note">' + window.DLI18N.t("60-path.0255998bcda1") + '</div>');
    if (!keys.length) h += ('<div class="pth-empty">' + window.DLI18N.t("60-path.95679816fdf3") + '</div>');
    else {
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("60-path.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("60-path.03867aea70ac") + '</th><th>' + window.DLI18N.t("60-path.f5387f9bb6ed") + '</th></tr></thead><tbody>');
      for (i = 0; i < keys.length; i++) {
        var a = ATOMS[keys[i]];
        h += "<tr><td>" + esc(when(m[keys[i]])) + "</td><td>" + esc(a ? a[0] : keys[i]) + "</td><td>" + esc(a ? (a[1] === "read" ? "read it" : "did it") : "—") + "</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.ab23e7f0c238") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("60-path.54287be80625") + '</th><th>' + window.DLI18N.t("60-path.c6bef7a2b524") + '</th><th>' + window.DLI18N.t("60-path.6be36ca49ee8") + '</th><th>' + window.DLI18N.t("60-path.a3b50c476732") + '</th></tr></thead><tbody>');
    for (i = 0; i < TOPO.order.length; i++) {
      var mm = mastery(TOPO.order[i]);
      var missTxt = [];
      for (k = 0; k < mm.missing.length; k++) missTxt.push(mm.missing[k].label);
      h += "<tr><td>" + esc(mm.title) + "</td><td>" + mm.have.length + "</td><td>" + esc(missTxt.length ? missTxt.join("; ") : "—") + "</td><td>" +
        esc(mm.met ? "evidence recorded" : mm.ready ? "ready" : "waiting on a prerequisite") + "</td></tr>";
    }
    h += "</tbody></table></div>";
    h += ('<div class="pth-hon">' + window.DLI18N.t("60-path.f92954b21191") + '</div>');
    return h;
  }

  function paneMethod() {
    var h = ('<div class="pth-note">' + window.DLI18N.t("60-path.1683ab59ec85") + '</div><div class="pth-method">');
    var i;
    for (i = 0; i < METHOD.length; i++) h += '<div class="pth-mrow"><b>' + esc(METHOD[i][0]) + "</b><span>" + esc(METHOD[i][1]) + "</span></div>";
    h += "</div>";
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.ea796159feee") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("60-path.339ed15a4092") + '</th><th>' + window.DLI18N.t("60-path.27482e2f353b") + '</th><th>' + window.DLI18N.t("60-path.b16ff7ff1efb") + '</th></tr></thead><tbody>');
    for (i = 1; i <= 6; i++) h += "<tr><td>" + i + "</td><td>" + intervalFor(i, EF0) + (window.DLI18N.t("60-path.a26bdd6b8bf9") + "</td><td>0.50</td></tr>");
    h += "</tbody></table></div>";
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.72575be9ba5c") + '</div><ul class="pth-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += "<li>" + esc(ASSUMPTIONS[i]) + "</li>";
    h += "</ul>";
    return h;
  }

  function paneNode(id) {
    var n = BY_ID[id];
    if (!n) return paneNext();
    var mm = mastery(id), sc = schedule(id), i, h = "";
    h += ('<div class="pth-kind">' + window.DLI18N.t("60-path.54287be80625") + '</div><div class="pth-title">') + esc(n.t) + "</div>";
    h += '<div class="pth-one">' + esc(n.one) + "</div>";
    if (n.req.length) {
      h += ('<div class="pth-why">' + window.DLI18N.t("60-path.bb08fe81f15d") + '');
      var rl = [];
      for (i = 0; i < n.req.length; i++) rl.push((BY_ID[n.req[i]] ? BY_ID[n.req[i]].t : n.req[i]) + (mastery(n.req[i]).met ? " (met)" : " (not met)"));
      h += esc(rl.join(", ")) + "</div>";
    }
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.03867aea70ac") + '</div><div class="pth-barnote">') + esc(mm.bar.why) + '</div><ul class="pth-ev">';
    for (i = 0; i < mm.have.length; i++) h += ('<li class="is-have"><b>' + window.DLI18N.t("60-path.193c45b52819") + '</b> ') + esc(ATOMS[mm.have[i].id] ? ATOMS[mm.have[i].id][0] : mm.have[i].id) + " <span>" + esc(when(mm.have[i].t)) + "</span></li>";
    for (i = 0; i < mm.missing.length; i++) h += ('<li class="is-miss"><b>' + window.DLI18N.t("60-path.ffa63583dfa6") + '</b> ') + esc(mm.missing[i].label) + '<span class="pth-miss">' + esc(mm.missing[i].why) + "</span></li>";
    h += "</ul>";
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.844675f9a66a") + '</div><div class="pth-acts">');
    for (i = 0; i < n.labs.length; i++) {
      h += labLive(n.labs[i])
        ? '<button class="dl-b" data-lab="' + esc(n.id) + '" data-i="' + i + '">' + esc(n.labs[i].label) + "</button>"
        : '<span class="dl-dis pth-dead">' + esc(n.labs[i].label) + (window.DLI18N.t("60-path.54f4d8fcbe42") + "</span>");
    }
    h += "</div>";
    var ho = handoff(id);
    h += ('<div class="pth-sub">' + window.DLI18N.t("60-path.1ccff2b8a90a") + '</div><div class="pth-acts">');
    if (ho && ho.live) h += '<button class="go" data-desk="' + esc(id) + '">' + esc(ho.deskName + " · " + ho.label) + "</button>";
    else if (ho) h += '<span class="dl-dis pth-dead">' + esc(ho.deskName + " · " + ho.label) + " — " + esc(ho.note) + "</span>";
    h += "</div>";
    if (id === "lookahead" || id === "oos" || id === "costsin") h += paneChecks(id);
    if (sc && sc.met) h += ('<div class="pth-sched">' + window.DLI18N.t("60-path.c710c7970ad8") + '') + sc.reps + " reps, ease " + num(sc.ef, 2) + ", interval " + sc.intervalDays + "d, strength " + num(sc.strength, 2) + (sc.due ? " — due." : ".") + "</div>";
    h += ('<div class="pth-acts"><button class="dl-b" data-back="1">' + window.DLI18N.t("60-path.7a03979ccb4e") + '</button></div>');
    return h;
  }

  /* -------------------------------------------------------------- wiring */

  var FOCUS = null;

  function bodyFor(tab) {
    if (FOCUS && (tab === "next")) { var s = paneNode(FOCUS); return s; }
    if (tab === "next") return paneNext();
    if (tab === "map") return paneMap();
    if (tab === "evidence") return paneEvidence();
    if (tab === "method") return paneMethod();
    return paneTrack();
  }

  function repaint(tab) {
    var el = document.getElementById("dlPath");
    if (!el) return;
    var body = el.querySelector(".dls-body");
    if (!body) return;
    var t = tab || el.dataset.tab || "track";
    body.innerHTML = bodyFor(t);
  }

  function presetVal() {
    var el = document.getElementById("pthPreset");
    return el && el.value ? String(el.value) : "rsi";
  }

  function onClick(ev) {
    var t = ev.target, b = null;
    try { b = t && t.closest ? t.closest("[data-track],[data-node],[data-lab],[data-desk],[data-run],[data-back]") : null; } catch (e) { b = null; }
    if (!b) return;
    var v;
    if ((v = b.getAttribute("data-track"))) { setTrack(v); repaint("track"); return; }
    if ((v = b.getAttribute("data-back"))) { FOCUS = null; repaint("next"); return; }
    if ((v = b.getAttribute("data-lab"))) { labGo(v, +b.getAttribute("data-i") || 0); return; }
    if ((v = b.getAttribute("data-desk"))) {
      if (!jump(v)) { try { C.toast && C.toast("warn", "Desk not in this build", (handoff(v) || {}).note || "that desk is not present"); } catch (e) {} }
      return;
    }
    if ((v = b.getAttribute("data-run"))) {
      var p = presetVal(), res = null;
      if (v === "causal") res = checkCausal(p);
      else if (v === "oos") res = checkOOS(p);
      else if (v === "costs") res = checkCosts(p);
      if (res && res.ok === false) { try { C.toast && C.toast("bad", "Run did not complete", res.reason); } catch (e) {} }
      repaint();
      return;
    }
    if ((v = b.getAttribute("data-node"))) { FOCUS = v; repaint("next"); setTab("next"); return; }
  }

  function setTab(id) {
    var el = document.getElementById("dlPath");
    if (!el) return;
    el.dataset.tab = id;
    try {
      var bs = el.querySelectorAll(".dls-tabs button"), i;
      for (i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-t") === id);
    } catch (e) {}
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); } catch (e) {}
      wired = false;
      FOCUS = null;
    };
  }

  function open(tab) {
    scan(true);
    if (tab !== "next") FOCUS = null;
    var el = null;
    try {
      el = C.open("dlPath", {
        title: window.DLI18N.t("60-path.d3fa4c192760"),
        sub: window.DLI18N.t("60-path.9a5d0932f5bf"),
        tabs: [["track", "Track"], ["next", "Next"], ["map", "Map"], ["evidence", "Evidence"], ["method", "Method"]],
        onTab: function (t, body) { body.innerHTML = bodyFor(t); }
      }, tab || "track");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlPath")); } catch (e) {}
    return el;
  }

  /* The one long-lived hook: evidence like "the price left your range while you
     held it" is only visible while this desk is closed. Throttled to 45s. */
  try { C.onTick && C.onTick(function () { try { scan(false); } catch (e) {} }); } catch (e) {}

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("path", "◇", "Path", "what to learn next, and what evidence would show you had", function () { open("track"); }); } catch (e) {}
  try { C.cmd && C.cmd("Path", "Path — curriculum graph and evidence", "◇", function () { open("track"); }); } catch (e) {}

  window.DLPATH = {
    __v: 166,
    open: open,
    NODES: NODES,
    TRACKS: TRACKS,
    ATOMS: ATOMS,
    topo: topo,
    order: function () { return TOPO.order.slice(); },
    depth: function () { var o = {}, k; for (k in TOPO.depth) if (Object.prototype.hasOwnProperty.call(TOPO.depth, k)) o[k] = TOPO.depth[k]; return o; },
    acyclic: function () { return GRAPH_OK; },
    selfTest: selfTest,
    layout: layout,
    scan: scan,
    evidence: evidence,
    record: record,
    mastery: mastery,
    barFor: barFor,
    reliability: reliability,
    ready: ready,
    schedule: schedule,
    easeFor: easeFor,
    intervalFor: intervalFor,
    strengthAt: strengthAt,
    due: due,
    progress: progress,
    next: next,
    weekOf: weekOf,
    track: currentTrack,
    setTrack: setTrack,
    handoff: handoff,
    jump: jump,
    runs: runs,
    checkCausal: checkCausal,
    checkOOS: checkOOS,
    checkCosts: checkCosts,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
