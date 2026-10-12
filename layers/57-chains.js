// owns: cross-chain execution and fee models
// reads: DLAPP, DLCORE, DLDESKS, browser DOM
// emits: DLCHAIN
/* ============================================================================
   DexLadder — DLCHAIN · layer 57 · v166 "the other chains"
   CROSS-CHAIN EXECUTION · CONCENTRATED-LIQUIDITY TICK MATH · L2 FEE ANATOMY

   The question this desk exists to answer: this same trade, on six chains —
   what does it actually cost to get there, fill, and get back, and who has to
   be honest for the money to arrive?

   Three gaps this closes, all of them named in 53-sor.js's own ASSUMPTIONS:
     · the app's AMM swap was a SINGLE-RANGE step with no tick data. This layer
       carries real concentrated-liquidity arithmetic — Q64.96 sqrt price, the
       whitepaper's amount formulas, Uniswap's own computeSwapStep, and a
       multi-tick walk that applies liquidityNet at every crossing and accrues
       fee growth per unit of liquidity. Orca Whirlpool and Raydium CLMM use
       the same maths, so one implementation serves all three.
     · everything was priced as if Ethereum L1 were the only chain. Here an
       OP-stack fee, an Arbitrum Nitro fee, a validity-rollup fee and a Solana
       lamport/compute-unit fee are each COMPUTED from their published formula,
       component by component, not asserted as a round number.
     · there was no bridge anywhere. Here there is one, with its failure modes
       as arithmetic in their own right and a trust column that says, in one sentence
       per route, what must stay honest.

   WHAT IS MEASURED AND WHAT IS MODELLED — the short version; the Method tab
   carries the long one. The TICK ARITHMETIC is exact: given a liquidity
   distribution, every number below follows from it with no fudge. The tick
   liquidity DISTRIBUTION is modelled — built deterministically from the app's
   own depth inputs by an FNV hash of the request, never from a pool feed,
   because this build has none. No bridge, no L2 and no Solana RPC is queried
   live. The single exception is the fork node: connect one and its real pool
   joins the Ticks tab as the one row backed by an actual chain.

   LAWS OBSERVED
     · this layer never trades. It quotes. It calls neither of the engine's
       two money-moving entry points, and it makes no assignment to any balance — money does not move here
     · deterministic — no random source of any kind. Every jitter is an FNV-1a hash of the
       inputs, so two adjacent quotes cannot disagree
     · a missing figure stays missing — null, never 0 wearing a price's clothes
     · no storage key of its own — the ticket lives in the v154 bucket via X()
     · nothing compiled at runtime, no timer, no socket, no observer
     · Day and Night — every rule lives in _v166css/57-chains.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLCHAIN && window.DLCHAIN.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function LP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.paper; } catch (e) { return null; } }

  var EPS = 1e-12;

  /* ==================================================================
     0 · THE HONESTY BLOCK
     ================================================================== */

  var ASSUMPTIONS = [
    "Gas, blob and priority prices are the app's own signals, named per row. The L1 base fee is backed out of the engine's live gas estimate when the session has one and falls back to FALLBACK_GWEI = 5 gwei when it does not; the blob base fee is COMPUTED from a modelled excess-blob-gas level (floor 0, busy 5.0e7, spike 8.5e7 blob gas) through EIP-4844's own fake_exponential, not read from a beacon node; L2 base fees are fixed modelling constants per chain (Base and OP 0.005 gwei, Arbitrum 0.01 gwei which is its published floor, the validity rollup 0.02 gwei); the Solana priority fee is a modelled 20000 micro-lamports per compute unit. Every table prints the source beside the number.",
    "The TICK LIQUIDITY DISTRIBUTION IS MODELLED. The ARITHMETIC OVER IT IS EXACT. There is no pool feed in this build, so the ladder of per-tick liquidity is synthesised: 40 slots each side of the current tick, each about 60 ticks wide, a Gaussian envelope with sigma = 8 slots, and a per-slot jitter of 0.70 to 1.30 drawn from an FNV-1a hash of symbol, quote, chain and fee tier — never from a random source, so it is reproducible. The whole ladder is then scaled so the value locked across it equals the pool TVL the engine already models for this symbol. Everything downstream of that ladder — sqrt prices, liquidity from amounts, the swap step, the tick crossings, fee growth — is the published arithmetic with no fudge factor in it. Read a tick chart here as a demonstration of the mechanism, not as a claim about what is in the pool today.",
    "Pool TVL per chain is the engine's own poolSpec TVL for the symbol multiplied by a FIXED per-chain liquidity share: Ethereum 1.00, Solana 0.35, Arbitrum 0.22, Base 0.18, OP Mainnet 0.07, the validity rollup 0.03. Those six numbers are an assumption about where liquidity sits, not a measurement of it. Read the ranking between two L2s as a fee-and-bridge comparison, not a depth comparison.",
    "NO BRIDGE AND NO L2 IS QUERIED LIVE IN THIS BUILD. Bridge fees, capacities, relayer failure rates and attestation quorums are modelling constants declared in one table in this layer and printed with every figure they produce: liquidity-bridge LP fee 4 bp, rebalancing premium 30 bp per unit of destination-inventory utilisation, destination inventory 2.5m USD on Arbitrum and Base and less elsewhere, relayer failure 0.4%, attestation quorum 2-of-3 for the burn-mint route. A real bridge quote comes from a real bridge.",
    "Time to finality is the protocol's own parameter where one exists and a modelled constant where it does not. The seven-day optimistic challenge window is 604800 seconds because that is what the OP-stack contracts are configured with; the validity-rollup proof latency of three hours and the liquidity-bridge 90 seconds are modelled cadences, not measurements of any particular operator today.",
    "THE ONLY REAL-CHAIN ROW ON THIS DESK IS THE FORK NODE WHEN CONNECTED. Point the Fork Sandbox at an anvil or Hardhat node and the Ticks tab gains a row with that pool's actual price and actual in-range liquidity. Every other number on every other tab is computed from the models above.",
    "Transaction sizes are modelled: a swap is 320 raw calldata bytes with 96 of them zero, which is a plausible single-hop exactInputSingle and not a measurement of your transaction; Brotli compression on the Arbitrum batch is modelled at 0.40 of raw. The byte counts are printed so you can substitute your own.",
    "This desk moves no money. There is no send button anywhere on it, it calls neither of the engine's two money-moving entry points, and nothing here touches the paper account. It is a quoting surface only."
  ];

  var METHOD = [
    ["Tick space", "A concentrated-liquidity pool does not store a price. It stores the square root of one, as a Q64.96 fixed-point number, and an integer tick with price = 1.0001^tick. The square root is what is stored because both amount formulas are linear in it, which is what makes a swap inside a tick a closed form rather than an iteration. tick to sqrtPrice is 1.0001^(tick/2); the inverse is 2*ln(sqrtPrice)/ln(1.0001), floored. Ticks run from -887272 to 887272, which is the range where 1.0001^tick stays inside a uint160 sqrt price. Uniswap v3, Orca Whirlpool and Raydium CLMM all use this same tick space, which is why one implementation serves the three of them."],
    ["Liquidity and amounts", "For a position over [Pa, Pb] with liquidity L, the whitepaper's equations 6.29 and 6.30 give the token amounts: dx = L*(1/sqrt(Pa) - 1/sqrt(Pb)) and dy = L*(sqrt(Pb) - sqrt(Pa)). Inverting them gives L from an amount: L = x*sqrt(Pa)*sqrt(Pb)/(sqrt(Pb) - sqrt(Pa)) from the base side, L = y/(sqrt(Pb) - sqrt(Pa)) from the quote side. When the price is inside the range you take the smaller of the two, because the position is limited by whichever token runs out first. Worked check, from the Uniswap v3 development book: at price 5000 with a range 4545 to 5500, one unit of base gives L = 1519.437308 and 5000 units of quote give L = 1517.882344, so the position is quote-limited. The gate re-derives both of those independently."],
    ["One swap step", "Inside a tick the liquidity is constant, so the step is exact. Selling base (price falls) the next sqrt price is L*sqrt(P)/(L + dx*sqrt(P)); selling quote (price rises) it is sqrt(P) + dy/L. The step first asks how much input the tick can absorb before the price hits the next initialised tick: if the order is smaller it ends inside the tick and the fee is the remainder of what was offered, and if the order is larger the step is capped at the tick boundary and the fee is amountIn*f/(1-f) on what actually went in. That asymmetry is Uniswap's own computeSwapStep and it is why the fee on a capped step is charged ON TOP of the input rather than out of it."],
    ["Crossing ticks", "This is the part the rest of the app did not have. When the price reaches an initialised tick the swap does not stop — it crosses. Each initialised tick carries liquidityNet, the change in active liquidity when it is crossed upward. Going up, L = L + net; going down, L = L - net. The walk then takes another step with the new L, and repeats until the order is filled or the ladder runs out. Every crossing is recorded with the tick, the price either side, the liquidity before and after, and the amounts that leg moved. A large order therefore prints as a sequence of segments at different depths, which is exactly what a real CLMM swap is and what a single-range approximation cannot show."],
    ["Fee growth", "Fees do not go to the pool, they go to the positions that were in range when they were earned, which means the pool has to track fees per unit of liquidity rather than in absolute terms. Each step adds feeAmount/L to a global accumulator. Each initialised tick stores feeGrowthOutside, and flips it to global - feeGrowthOutside every time it is crossed. Fees inside a range are then global minus the part below minus the part above, which is the standard three-term identity. The Ticks tab prints the accumulator's path across the walk so you can see fee growth accruing faster where liquidity is thin, which is the mechanism that pays a concentrated position more per dollar and also exposes it to more inventory risk."],
    ["Solana is not Ethereum with different branding", "A Solana fee has two parts and neither is an auction. The base fee is 5000 lamports per signature, fixed. The priority fee is computeUnitLimit * microLamportsPerCU / 1e6 lamports, rounded up. That is a bid for scheduling position inside the leader's queue, not a bid against other bidders for a slot in a block that the highest bidder wins: there is no first-price gas auction, the fee does not change with network load on its own, and a transaction that is not scheduled simply is not included rather than sitting in a mempool being outbid. The consequence that actually costs traders money is different again: Whirlpool holds ticks in TICK ARRAYS of 88 ticks, and a swap instruction can reference at most three of them. That is 264 tick spacings of travel in one transaction — on a 1-spacing stable pool that is a 2.67% price move, and a swap that needs more than that FAILS rather than merely costing more. On Ethereum the same order is expensive. On Solana it reverts."],
    ["OP-stack fees", "Two components, both computed here. L2 execution is l2GasUsed * (l2BaseFee + l2PriorityFee), which is ordinary EIP-1559 arithmetic on a chain whose base fee is a few thousandths of a gwei. L1 data is the Ecotone formula: l1GasUsed = 4*zeroBytes + 16*nonZeroBytes, and l1Fee = l1GasUsed * (baseFeeScalar*16*l1BaseFee + blobBaseFeeScalar*blobBaseFee) / 16e6. The blob-versus-calldata branch is inside that expression: the two scalar terms are the two posting routes, and the batcher uses whichever is cheaper. Their crossover is where blobBaseFeeScalar*blobBaseFee equals 16*baseFeeScalar*l1BaseFee, which the desk prints in gwei so you can see how far the blob market has to move before calldata comes back. The blob base fee itself is not quoted anywhere — it is derived from excess blob gas through EIP-4844's fake_exponential, MIN_BASE_FEE_PER_BLOB_GAS * exp(excessBlobGas / BLOB_BASE_FEE_UPDATE_FRACTION), with the Cancun update fraction 3338477."],
    ["Arbitrum Nitro fees", "Nitro charges the poster's L1 cost as EXTRA GAS rather than as a separate line, which is why an Arbitrum receipt shows one gas number that is much larger than the compute the transaction did. The arithmetic: the batch poster compresses the transaction with Brotli, is charged for the compressed bytes on L1, and the ArbGasInfo precompile converts that cost back into L2 gas units at the current L2 gas price. So posterGas = compressedBytes*16*l1BaseFee / l2GasPrice before 4844 and compressedBytes*blobBaseFee / l2GasPrice after it, totalGas = l2ComputeGas + posterGas, and the bill is totalGas * l2GasPrice — which is identically l2ComputeGas*l2GasPrice + the poster's actual L1 outlay. The desk prints both sides of that identity, because the conversion through gas units is where the intuition usually breaks. The batch's own fixed overhead is amortised over the batch in the same pass."],
    ["Validity rollups amortise a proof", "A validity rollup's L1 cost is dominated by one thing that does not depend on how many transactions are in the batch: verifying the proof. A verifier call is a few hundred thousand gas whether it attests to one transaction or a hundred thousand. So cost per transaction = l2Execution + (proofVerifyGas + batchOverheadGas)*l1BaseFee/batchSize + stateDiffBytes*blobBaseFee, and the curve falls as 1/batchSize toward an asymptote that is the L2 execution plus that transaction's own state diff. The Chains tab plots it. The lesson transfers past this desk: on a validity rollup you are paying for company, and a quiet chain is an expensive chain."],
    ["Bridging, and what it costs when it works", "Five mechanisms, priced separately, and a route that is simply absent where it does not exist: THERE IS NO CANONICAL BRIDGE BETWEEN ETHEREUM AND SOLANA and there will not be one, because neither chain verifies the other, so the canonical rows do not appear on that pair at all. Where one does exist: A canonical lock-mint deposit is an L1 transaction plus the destination's derivation lag — minutes, and the fee is simply the L1 gas. A canonical burn-mint withdrawal is the same in reverse plus the finality wait, and on an optimistic rollup that wait is the 604800-second challenge window with a prove transaction and a finalise transaction on L1 at either end of it. A liquidity bridge does not wait: an LP on the destination fronts you the asset and is repaid by the canonical path later, so you pay an LP fee, a rebalancing premium that rises with how much of that LP's inventory you have just consumed, and you are capped by that inventory. A message-passing route burns on the source, waits for an attestation quorum, and mints on the destination. An atomic swap has no bridge in it at all — two counterparties lock behind one hash on two chains — which is why it is the only route that works between ecosystems that cannot verify each other, and also why it cannot carry size."],
    ["Bridging, and what it costs when it does not", "Four failure modes, each with its own arithmetic and its own remedy, because a bridge that is quoted only on its happy path is quoted wrong. A STUCK MESSAGE is attested but never executed: the source cost is already sunk and the remedy is a manual execute on the destination, so the expected cost is the relayer failure rate times the destination gas. INSUFFICIENT DESTINATION GAS is the same shape with a sharper edge: the gas was bought at source-time prices with a buffer, the destination price moved, and the shortfall is the difference — the funds are not lost, they are parked until someone tops it up. DESTINATION SLIPPAGE is the price moving during the transit window: the expected absolute drift over t seconds is sigma*sqrt(t/year)*sqrt(2/pi) of notional, and the probability that it breaches your minimum-out floor is the two-sided normal tail. The REFUND PATH is what is left when the floor is breached: principal back on the source chain, minus the source gas, minus the destination gas already burned, minus the refund fee, after the refund delay. That number is almost never zero and it is almost never mentioned."],
    ["The trust column", "This is the part that actually matters and it is deliberately not a score. NATIVELY VERIFIED means the destination chain verifies the source chain's state itself, in a contract, with no outside party: a canonical rollup bridge. EXTERNALLY VERIFIED means an outside validator set signs, and m of n of them must be honest — so the honest set is a number you can read, and a colluding m takes everything. OPTIMISTICALLY VERIFIED means a claim is assumed true unless someone disputes it inside a window, so what must exist is one honest watcher with the funds and the will to post a bond. LOCALLY VERIFIED means only the two counterparties can affect the outcome, which cannot be stolen from but can be stranded until a timelock expires. The taxonomy is the interoperability-trilemma one from Connext's Arjun Bhuptani, and every route on this desk is labelled with the one sentence that says what has to hold."],
    ["The route comparison", "The same trade, on every chain, all-in and unfolded. Swap impact comes from the real multi-tick walk on that chain's modelled pool. Swap fee comes from the tier. Gas is computed by that chain's own fee model — Ecotone, Nitro, proof amortisation or lamports — not by a shared approximation. Bridge fee is the cheapest route that can actually carry the size, with a partial fill named where the destination inventory cannot. Then three columns sit beside the total and are never folded into it: time to finality, the trust model, and what could not be filled. A single score would allow a seven-day withdrawal and a two-minute deposit to average into one number, and there is no honest weight between them — that weight is yours."]
  ];

  /* ==================================================================
     1 · DETERMINISM — FNV-1a, the engine's own, with a local fallback
     ================================================================== */

  function hash32(s) {
    try { var p = P(); if (p && typeof p.hash32 === "function") return p.hash32(String(s)) >>> 0; } catch (e) {}
    var h = 2166136261 >>> 0, i;
    s = String(s);
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  /* a uniform in [0,1) from a string. No random source anywhere in this layer. */
  function hash01(s) { return hash32(s) / 4294967296; }

  /* ==================================================================
     2 · TICK MATH — Uniswap v3 / Orca Whirlpool / Raydium CLMM
     All three use tick i <-> price 1.0001^i and a Q64.96 sqrt price, so
     one implementation serves the three of them.
     ================================================================== */

  var LN_1_0001 = Math.log(1.0001);
  var MIN_TICK = -887272, MAX_TICK = 887272;
  var Q96 = 79228162514264337593543950336;   /* 2^96, the Q64.96 scale */

  /* fee tier (in hundredths of a bp, the on-chain unit) -> tick spacing.
     Uniswap v3 mainnet: 100/1, 500/10, 3000/60, 10000/200.
     Orca Whirlpool and Raydium CLMM publish their own spacings per tier;
     the two extra rows below are Whirlpool's common stable and volatile ones. */
  var TICK_SPACING = { 100: 1, 500: 10, 3000: 60, 10000: 200, 400: 8, 1600: 64, 6500: 128 };

  function tickSpacing(feePips) {
    var s = TICK_SPACING[feePips];
    return s > 0 ? s : null;                       /* unknown tier stays missing */
  }
  function feeRateOf(feePips) { return feePips > 0 ? feePips / 1e6 : null; }

  function tickToSqrtPrice(t) {
    if (!(t >= MIN_TICK && t <= MAX_TICK)) return null;
    return Math.exp(t * LN_1_0001 / 2);
  }
  function tickToPrice(t) { var s = tickToSqrtPrice(t); return s == null ? null : s * s; }
  function sqrtPriceToTick(sq) {
    if (!(sq > 0)) return null;
    return Math.floor(2 * Math.log(sq) / LN_1_0001 + 1e-9);
  }
  function priceToTick(p) { return p > 0 ? sqrtPriceToTick(Math.sqrt(p)) : null; }
  /* The on-chain representation. In double precision this carries about 15
     significant figures, not the full 160 bits — it is shown to make the
     encoding legible, and every swap below runs on the float sqrt price. */
  function sqrtPriceX96(sq) { return sq > 0 ? sq * Q96 : null; }
  function x96ToSqrtPrice(x) { return x > 0 ? x / Q96 : null; }
  function alignTick(t, sp) { if (!(sp > 0)) return t; return Math.floor(t / sp) * sp; }

  /* whitepaper 6.29: dx = L (1/sqrt(Pa) - 1/sqrt(Pb)) */
  function amount0For(L, sqa, sqb) {
    var z;
    if (sqa > sqb) { z = sqa; sqa = sqb; sqb = z; }
    if (!(sqa > 0) || !(L > 0)) return 0;
    return L * (sqb - sqa) / (sqa * sqb);
  }
  /* whitepaper 6.30: dy = L (sqrt(Pb) - sqrt(Pa)) */
  function amount1For(L, sqa, sqb) {
    var z;
    if (sqa > sqb) { z = sqa; sqa = sqb; sqb = z; }
    if (!(L > 0)) return 0;
    return L * (sqb - sqa);
  }
  function liquidityFromAmount0(x, sqa, sqb) {
    var z;
    if (sqa > sqb) { z = sqa; sqa = sqb; sqb = z; }
    if (!(sqb - sqa > 0)) return 0;
    return x * (sqa * sqb) / (sqb - sqa);
  }
  function liquidityFromAmount1(y, sqa, sqb) {
    var z;
    if (sqa > sqb) { z = sqa; sqa = sqb; sqb = z; }
    if (!(sqb - sqa > 0)) return 0;
    return y / (sqb - sqa);
  }
  /* The three branches: below the range the position is all base, above it all
     quote, inside it whichever token runs out first sets L. */
  function liquidityFromAmounts(x, y, sq, sqa, sqb) {
    var z;
    if (sqa > sqb) { z = sqa; sqa = sqb; sqb = z; }
    if (sq <= sqa) return liquidityFromAmount0(x, sqa, sqb);
    if (sq >= sqb) return liquidityFromAmount1(y, sqa, sqb);
    return Math.min(liquidityFromAmount0(x, sq, sqb), liquidityFromAmount1(y, sqa, sq));
  }
  /* base in, price falls */
  function nextSqrtFromAmount0In(sq, L, dx) {
    if (!(dx > 0) || !(L > 0)) return sq;
    return L * sq / (L + dx * sq);
  }
  /* quote in, price rises */
  function nextSqrtFromAmount1In(sq, L, dy) {
    if (!(dy > 0) || !(L > 0)) return sq;
    return sq + dy / L;
  }

  /* Uniswap SwapMath.computeSwapStep, exact-input branch, in doubles.
     Returns the amounts this step moved and the fee it charged. The two fee
     branches are the whole point: a step that ends INSIDE the tick has already
     had its fee taken out of what was offered, so the fee is the remainder; a
     step CAPPED at the tick boundary charges amountIn*f/(1-f) on top. */
  function swapStep(sq, sqTarget, L, amountRemaining, fee) {
    if (!(L > 0) || !(sq > 0) || !(sqTarget > 0)) return null;
    var zeroForOne = sqTarget <= sq;
    var lessFee = amountRemaining * (1 - fee);
    var amountIn, amountOut, sqNext, feeAmount, maxed;
    amountIn = zeroForOne ? amount0For(L, sqTarget, sq) : amount1For(L, sq, sqTarget);
    if (lessFee >= amountIn) sqNext = sqTarget;
    else sqNext = zeroForOne ? nextSqrtFromAmount0In(sq, L, lessFee) : nextSqrtFromAmount1In(sq, L, lessFee);
    maxed = (sqNext === sqTarget);
    if (zeroForOne) {
      if (!maxed) amountIn = amount0For(L, sqNext, sq);
      amountOut = amount1For(L, sqNext, sq);
    } else {
      if (!maxed) amountIn = amount1For(L, sq, sqNext);
      amountOut = amount0For(L, sq, sqNext);
    }
    feeAmount = maxed ? amountIn * fee / (1 - fee) : (amountRemaining - amountIn);
    return {
      sqNext: sqNext, amountIn: amountIn, amountOut: amountOut,
      feeAmount: feeAmount, maxed: maxed, zeroForOne: zeroForOne
    };
  }

  /* fees earned inside [lower, upper]: global minus the part below minus the
     part above, each read off the tick's feeGrowthOutside depending on which
     side of the range the current tick is. Uniswap v3 core, Tick.sol. */
  function feeGrowthInside(lower, upper, tickCur, global, outLo, outHi) {
    var below = tickCur >= lower ? outLo : global - outLo;
    var above = tickCur < upper ? outHi : global - outHi;
    return global - below - above;
  }

  /* ------------------------------------------------------------------
     The tick ladder. MODELLED — see ASSUMPTIONS. Deterministic: every
     jitter is an FNV hash of (seed, slot), so the same request always
     builds the same pool.
     ------------------------------------------------------------------ */

  var LADDER_SLOTS = 40;        /* per side */
  var LADDER_SIGMA = 8;         /* slots — the Gaussian envelope's width */
  var LADDER_JITTER = 0.30;     /* +/- 30% per slot */
  var LADDER_TARGET_WIDTH = 60; /* ticks per slot, before spacing alignment */

  function buildTicks(opts) {
    opts = opts || {};
    var price = +opts.price, tvlQuote = +opts.tvlQuote;
    var feePips = +opts.feePips || 3000;
    var sp = tickSpacing(feePips);
    var seed = String(opts.seed || "dlchain");
    if (!(price > 0) || !(tvlQuote > 0) || !(sp > 0)) return null;

    var slotTicks = Math.max(sp, Math.round(LADDER_TARGET_WIDTH / sp) * sp) || sp;
    var sqCur = Math.sqrt(price);
    var tickCur = sqrtPriceToTick(sqCur);
    var base = alignTick(tickCur, slotTicks);

    var slots = [], k, i, u, w, lo, hi, dist;
    for (k = -LADDER_SLOTS; k < LADDER_SLOTS; k++) {
      lo = base + k * slotTicks;
      hi = lo + slotTicks;
      if (lo < MIN_TICK || hi > MAX_TICK) continue;
      dist = k + 0.5;                       /* slot centre, in slots from base */
      u = hash01(seed + "|slot|" + k);
      w = Math.exp(-0.5 * (dist / LADDER_SIGMA) * (dist / LADDER_SIGMA)) *
        (1 - LADDER_JITTER + 2 * LADDER_JITTER * u);
      slots.push({ lo: lo, hi: hi, L: w, sqLo: tickToSqrtPrice(lo), sqHi: tickToSqrtPrice(hi) });
    }
    if (!slots.length) return null;

    /* Scale the whole ladder so the value it locks equals the TVL the engine
       already models for this symbol. Value of a slot = base held * price +
       quote held, with the current price clamped into the slot. */
    var value = 0;
    for (i = 0; i < slots.length; i++) {
      var s = slots[i];
      /* A slot wholly below the current price holds only quote; one wholly
         above holds only base. Clamping without that test credits a slot with
         a token it cannot be holding and inflates the pool sixfold. */
      var a0 = s.sqHi <= sqCur ? 0 : amount0For(s.L, Math.max(sqCur, s.sqLo), s.sqHi);
      var a1 = s.sqLo >= sqCur ? 0 : amount1For(s.L, s.sqLo, Math.min(sqCur, s.sqHi));
      value += a0 * price + a1;
    }
    if (!(value > 0)) return null;
    var scale = tvlQuote / value;
    for (i = 0; i < slots.length; i++) slots[i].L *= scale;

    /* liquidityNet at each boundary: the change in active liquidity when the
       tick is crossed UPWARD. Outside the ladder the pool is empty. */
    var ticks = [], prevL = 0;
    for (i = 0; i < slots.length; i++) {
      ticks.push({ tick: slots[i].lo, net: slots[i].L - prevL, feeGrowthOutside: 0 });
      prevL = slots[i].L;
    }
    ticks.push({ tick: slots[slots.length - 1].hi, net: -prevL, feeGrowthOutside: 0 });

    /* active liquidity at the current price */
    var Lcur = 0;
    for (i = 0; i < slots.length; i++) if (tickCur >= slots[i].lo && tickCur < slots[i].hi) Lcur = slots[i].L;

    return {
      modelled: true, feePips: feePips, fee: feeRateOf(feePips), spacing: sp, slotTicks: slotTicks,
      price: price, sqrtP: sqCur, sqrtPriceX96: sqrtPriceX96(sqCur), tick: tickCur,
      L: Lcur, tvlQuote: tvlQuote, slots: slots, ticks: ticks,
      feeGrowthGlobal0: 0, feeGrowthGlobal1: 0, seed: seed
    };
  }

  /* ------------------------------------------------------------------
     THE MULTI-TICK WALK. This is what the rest of the build does not have.
     zeroForOne = selling base for quote = the price falls.
     ------------------------------------------------------------------ */

  function nextInitialised(pool, tick, zeroForOne) {
    var i, best = null;
    for (i = 0; i < pool.ticks.length; i++) {
      var t = pool.ticks[i].tick;
      if (zeroForOne) { if (t <= tick && (best === null || t > best)) best = t; }
      else { if (t > tick && (best === null || t < best)) best = t; }
    }
    return best;
  }
  function tickAt(pool, t) {
    var i;
    for (i = 0; i < pool.ticks.length; i++) if (pool.ticks[i].tick === t) return pool.ticks[i];
    return null;
  }

  function swapWalk(pool, zeroForOne, amountIn, opts) {
    opts = opts || {};
    if (!pool || !(amountIn > 0)) return null;
    var maxSteps = opts.maxSteps > 0 ? opts.maxSteps : 512;
    var sq = pool.sqrtP, L = pool.L, tick = pool.tick, fee = pool.fee;
    var remaining = amountIn, outTotal = 0, inTotal = 0, feeTotal = 0;
    var fgGlobal = 0, steps = [], crossings = 0, guard = 0;
    var outside = {}, i;
    for (i = 0; i < pool.ticks.length; i++) outside[pool.ticks[i].tick] = pool.ticks[i].feeGrowthOutside || 0;

    while (remaining > amountIn * 1e-12 && guard++ < maxSteps) {
      var nt = nextInitialised(pool, zeroForOne ? tick : tick, zeroForOne);
      if (nt === null) break;                                  /* ladder exhausted */
      var sqTarget = tickToSqrtPrice(nt);
      if (zeroForOne && !(sqTarget < sq)) {                    /* already at the boundary */
        nt = nextInitialised(pool, nt - 1, true);
        if (nt === null) break;
        sqTarget = tickToSqrtPrice(nt);
      }
      if (!(L > 0)) {
        /* a gap in the ladder: jump the price to the next initialised tick with
           no trade, exactly as the pool does, and pick up its liquidity */
        var gapT = tickAt(pool, nt);
        sq = sqTarget;
        if (gapT) L += zeroForOne ? -gapT.net : gapT.net;
        tick = zeroForOne ? nt - 1 : nt;
        crossings++;
        continue;
      }
      var st = swapStep(sq, sqTarget, L, remaining, fee);
      if (!st) break;
      var used = st.amountIn + st.feeAmount;
      if (!(used > 0)) break;
      remaining -= used;
      inTotal += st.amountIn;
      feeTotal += st.feeAmount;
      outTotal += st.amountOut;
      if (L > 0) fgGlobal += st.feeAmount / L;
      var lBefore = L, sqBefore = sq;
      sq = st.sqNext;
      var crossed = false;
      if (st.maxed) {
        var tk = tickAt(pool, nt);
        if (tk) {
          L += zeroForOne ? -tk.net : tk.net;
          if (L < 0) L = 0;
          outside[nt] = fgGlobal - (outside[nt] || 0);         /* flip on crossing */
          crossed = true;
          crossings++;
        }
        tick = zeroForOne ? nt - 1 : nt;
      } else {
        tick = sqrtPriceToTick(sq);
      }
      steps.push({
        tickTarget: nt, crossed: crossed,
        sqFrom: sqBefore, sqTo: sq,
        priceFrom: sqBefore * sqBefore, priceTo: sq * sq,
        L: lBefore, LAfter: L,
        amountIn: st.amountIn, amountOut: st.amountOut, feeAmount: st.feeAmount,
        feeGrowthGlobal: fgGlobal
      });
      if (!st.maxed) break;                                    /* order finished inside the tick */
    }

    var filledIn = inTotal + feeTotal;
    var avg = outTotal > 0 && inTotal > 0
      ? (zeroForOne ? outTotal / filledIn : filledIn / outTotal) : null;
    return {
      zeroForOne: zeroForOne,
      amountIn: amountIn, amountInUsed: filledIn, amountInUnfilled: Math.max(0, amountIn - filledIn),
      amountInNet: inTotal, amountOut: outTotal, feePaid: feeTotal,
      sqrtPStart: pool.sqrtP, sqrtPEnd: sq,
      priceStart: pool.price, priceEnd: sq * sq,
      tickStart: pool.tick, tickEnd: tick,
      LStart: pool.L, LEnd: L,
      crossings: crossings, steps: steps, feeGrowthGlobal: fgGlobal,
      exhausted: (amountIn - filledIn) > amountIn * 1e-9,
      avgPrice: avg,
      /* execution against the pre-trade price, in bp, fee excluded */
      impactBps: (function () {
        if (!(outTotal > 0) || !(inTotal > 0) || !(pool.price > 0)) return null;
        var ex = zeroForOne ? (outTotal / inTotal) : (inTotal / outTotal);
        return zeroForOne ? (1 - ex / pool.price) * 1e4 : (ex / pool.price - 1) * 1e4;
      })()
    };
  }

  /* ==================================================================
     3 · FEE MODELS, ONE PER EXECUTION ENVIRONMENT
     Every constant below is a MODELLING CONSTANT and is named where it
     is used. Nothing here is fetched.
     ================================================================== */

  /* ---- the modelled transaction ---- */
  var TX_BYTES = 320;          /* a single-hop exactInputSingle, raw calldata */
  var TX_ZERO_BYTES = 96;      /* of which zero — addresses and padding */
  var BROTLI_RATIO = 0.40;     /* Arbitrum batch compression, modelled */

  /* ---- EIP-4844 ---- */
  var MIN_BLOB_BASE_FEE = 1;                  /* wei, EIP-4844 */
  var BLOB_BASE_FEE_UPDATE_FRACTION = 3338477; /* Cancun */
  var GAS_PER_BLOB = 131072;                  /* 2^17 blob gas per blob */
  var EXCESS_BLOB_GAS = { floor: 0, busy: 5.0e7, spike: 8.5e7 };

  /* ---- OP-stack Ecotone scalars (modelled, of the order the OP-stack
         chains have actually run with since 4844) ---- */
  var OP_BASE_FEE_SCALAR = 1368;
  var OP_BLOB_BASE_FEE_SCALAR = 810949;

  /* ---- Arbitrum Nitro ---- */
  var ARB_L1_BYTE_GAS = 16;        /* the poster is charged 16 gas per byte */
  var ARB_BATCH_OVERHEAD_GAS = 21000 + 30000;  /* the batch tx itself */

  /* ---- a validity rollup ---- */
  var ZK_PROOF_VERIFY_GAS = 500000;   /* one verifier call, per batch */
  var ZK_BATCH_OVERHEAD_GAS = 150000; /* commit + state root, per batch */
  var ZK_STATE_DIFF_BYTES = 40;       /* per transaction, posted as blob data */

  /* ---- Solana ---- */
  var SOL_LAMPORTS = 1e9;
  var SOL_BASE_FEE_LAMPORTS = 5000;          /* per signature, fixed */
  var SOL_MICRO_LAMPORTS_PER_CU = 20000;     /* modelled priority bid */
  var SOL_CU_TX_OVERHEAD = 30000;
  var SOL_CU_SWAP = 45000;
  var SOL_CU_PER_TICK_ARRAY = 15000;
  var SOL_CU_PER_CROSS = 1200;
  var SOL_CU_TX_LIMIT = 1400000;             /* per-transaction ceiling */
  var WHIRLPOOL_TICKS_PER_ARRAY = 88;
  var WHIRLPOOL_ARRAYS_PER_SWAP = 3;

  /* ------------------------------------------------------------------
     EIP-4844 fake_exponential, the spec's own Taylor loop, in doubles.
     blobBaseFee = MIN_BASE_FEE_PER_BLOB_GAS * e^(excessBlobGas / UPDATE)
     ------------------------------------------------------------------ */
  function fakeExponential(factor, numerator, denominator) {
    if (!(denominator > 0)) return null;
    var i = 1, output = 0, accum = factor * denominator, guard = 0;
    while (accum > 0 && guard++ < 4096) {
      output += accum;
      accum = accum * numerator / (denominator * i);
      i++;
      if (accum < output * 1e-18) break;
    }
    return output / denominator;
  }
  function blobBaseFeeWei(excessBlobGas) {
    if (!(excessBlobGas >= 0)) return null;
    return fakeExponential(MIN_BLOB_BASE_FEE, excessBlobGas, BLOB_BASE_FEE_UPDATE_FRACTION);
  }

  function calldataGas(bytes, zeroBytes) {
    var z = Math.min(bytes, Math.max(0, zeroBytes));
    return 4 * z + 16 * (bytes - z);
  }

  /* ------------------------------------------------------------------
     OP stack, post-Ecotone. Two components, both computed.
     l1Fee = l1GasUsed * (baseFeeScalar*16*l1BaseFee + blobScalar*blobBaseFee) / 16e6
     ------------------------------------------------------------------ */
  function opStackFee(o) {
    o = o || {};
    var l2Gas = +o.l2Gas, l2BaseFeeWei = +o.l2BaseFeeWei, l2PrioWei = +o.l2PriorityFeeWei || 0;
    var l1BaseFee = +o.l1BaseFeeWei, blobFee = +o.blobBaseFeeWei;
    var bytes = o.bytes > 0 ? +o.bytes : TX_BYTES, zb = o.zeroBytes >= 0 ? +o.zeroBytes : TX_ZERO_BYTES;
    if (!(l2Gas > 0) || !(l2BaseFeeWei >= 0) || !(l1BaseFee >= 0) || !(blobFee >= 0)) return null;
    var bfs = o.baseFeeScalar > 0 ? +o.baseFeeScalar : OP_BASE_FEE_SCALAR;
    var bbs = o.blobBaseFeeScalar > 0 ? +o.blobBaseFeeScalar : OP_BLOB_BASE_FEE_SCALAR;
    var l1GasUsed = calldataGas(bytes, zb);
    var calldataTerm = l1GasUsed * (bfs * 16 * l1BaseFee) / 16e6;
    var blobTerm = l1GasUsed * (bbs * blobFee) / 16e6;
    var l1Fee = calldataTerm + blobTerm;
    var l2Fee = l2Gas * (l2BaseFeeWei + l2PrioWei);
    /* the branch, stated as the number at which it flips */
    var crossover = bbs > 0 ? (16 * bfs * l1BaseFee) / bbs : null;
    return {
      chainKind: "opstack",
      l1GasUsed: l1GasUsed, bytes: bytes, zeroBytes: zb,
      baseFeeScalar: bfs, blobBaseFeeScalar: bbs,
      calldataTermWei: calldataTerm, blobTermWei: blobTerm,
      l1FeeWei: l1Fee, l2FeeWei: l2Fee, totalWei: l1Fee + l2Fee,
      l1SharePct: (l1Fee + l2Fee) > 0 ? l1Fee / (l1Fee + l2Fee) * 100 : null,
      posting: blobTerm > calldataTerm ? "blob" : "calldata",
      crossoverBlobBaseFeeWei: crossover,
      blobBaseFeeWei: blobFee, l1BaseFeeWei: l1BaseFee,
      parts: [
        ["L2 execution", l2Fee, l2Gas + " gas x " + gwei(l2BaseFeeWei + l2PrioWei) + " gwei"],
        ["L1 data, calldata term", calldataTerm, l1GasUsed + " l1 gas x 16 x " + gwei(l1BaseFee) + " gwei x " + bfs + " / 16e6"],
        ["L1 data, blob term", blobTerm, l1GasUsed + " l1 gas x " + bbs + " x " + wei(blobFee) + " wei / 16e6"]
      ]
    };
  }

  /* ------------------------------------------------------------------
     Arbitrum Nitro. The poster's L1 cost is charged as EXTRA L2 GAS, which
     is why one Arbitrum gas figure is much larger than the compute done.
     ------------------------------------------------------------------ */
  function arbitrumFee(o) {
    o = o || {};
    var l2Gas = +o.l2Gas, l2GasPriceWei = +o.l2GasPriceWei;
    var l1BaseFee = +o.l1BaseFeeWei, blobFee = +o.blobBaseFeeWei;
    var bytes = o.bytes > 0 ? +o.bytes : TX_BYTES;
    var ratio = o.compression > 0 ? +o.compression : BROTLI_RATIO;
    var batchSize = o.batchSize > 0 ? +o.batchSize : 400;
    var useBlobs = o.useBlobs === false ? false : true;
    if (!(l2Gas > 0) || !(l2GasPriceWei > 0) || !(l1BaseFee >= 0) || !(blobFee >= 0)) return null;
    var comp = bytes * ratio;
    /* post-4844 a Nitro batch goes in a blob at 1 wei of blob gas per byte;
       before it, as calldata at 16 gas per byte. Both are computed. */
    var posterCalldataWei = comp * ARB_L1_BYTE_GAS * l1BaseFee;
    var posterBlobWei = comp * blobFee;
    var posterWei = useBlobs ? Math.min(posterCalldataWei, posterBlobWei) : posterCalldataWei;
    var overheadWei = ARB_BATCH_OVERHEAD_GAS * l1BaseFee / batchSize;
    var posterGas = l2GasPriceWei > 0 ? (posterWei + overheadWei) / l2GasPriceWei : null;
    var totalGas = l2Gas + posterGas;
    var totalWei = totalGas * l2GasPriceWei;
    return {
      chainKind: "nitro",
      rawBytes: bytes, compressedBytes: comp, compression: ratio, batchSize: batchSize,
      posterCalldataWei: posterCalldataWei, posterBlobWei: posterBlobWei,
      posting: (useBlobs && posterBlobWei < posterCalldataWei) ? "blob" : "calldata",
      posterWei: posterWei, batchOverheadWei: overheadWei,
      posterGas: posterGas, l2ComputeGas: l2Gas, totalGas: totalGas,
      l2FeeWei: l2Gas * l2GasPriceWei, l1FeeWei: posterWei + overheadWei, totalWei: totalWei,
      /* the identity the desk prints: gas x price == compute + the poster's outlay */
      identityResidual: Math.abs(totalWei - (l2Gas * l2GasPriceWei + posterWei + overheadWei)),
      l1SharePct: totalWei > 0 ? (posterWei + overheadWei) / totalWei * 100 : null,
      parts: [
        ["L2 compute", l2Gas * l2GasPriceWei, l2Gas + " gas x " + gwei(l2GasPriceWei) + " gwei"],
        ["Poster's L1 charge", posterWei, comp.toFixed(0) + " compressed bytes, posted as " + ((useBlobs && posterBlobWei < posterCalldataWei) ? "a blob" : "calldata")],
        ["Batch overhead, amortised", overheadWei, ARB_BATCH_OVERHEAD_GAS + " gas / " + batchSize + " tx in the batch"]
      ]
    };
  }

  /* ------------------------------------------------------------------
     A validity rollup. The proof does not care how many transactions it
     attests to, so cost per transaction falls as 1/batchSize.
     ------------------------------------------------------------------ */
  function validityFee(o) {
    o = o || {};
    var l2Gas = +o.l2Gas, l2GasPriceWei = +o.l2GasPriceWei;
    var l1BaseFee = +o.l1BaseFeeWei, blobFee = +o.blobBaseFeeWei;
    var batchSize = o.batchSize > 0 ? +o.batchSize : 2000;
    var diff = o.stateDiffBytes > 0 ? +o.stateDiffBytes : ZK_STATE_DIFF_BYTES;
    if (!(l2Gas > 0) || !(l2GasPriceWei > 0) || !(l1BaseFee >= 0) || !(blobFee >= 0)) return null;
    var proofWei = ZK_PROOF_VERIFY_GAS * l1BaseFee;
    var overheadWei = ZK_BATCH_OVERHEAD_GAS * l1BaseFee;
    var perTxProof = (proofWei + overheadWei) / batchSize;
    var perTxData = diff * blobFee;                 /* 1 wei of blob gas per byte */
    var l2Fee = l2Gas * l2GasPriceWei;
    var total = l2Fee + perTxProof + perTxData;
    return {
      chainKind: "validity", batchSize: batchSize, stateDiffBytes: diff,
      proofVerifyGas: ZK_PROOF_VERIFY_GAS, proofWei: proofWei, batchOverheadWei: overheadWei,
      perTxProofWei: perTxProof, perTxDataWei: perTxData,
      l2FeeWei: l2Fee, l1FeeWei: perTxProof + perTxData, totalWei: total,
      asymptoteWei: l2Fee + perTxData,
      l1SharePct: total > 0 ? (perTxProof + perTxData) / total * 100 : null,
      parts: [
        ["L2 execution", l2Fee, l2Gas + " gas x " + gwei(l2GasPriceWei) + " gwei"],
        ["Proof, amortised", perTxProof, "(" + ZK_PROOF_VERIFY_GAS + " + " + ZK_BATCH_OVERHEAD_GAS + ") gas x " + gwei(l1BaseFee) + " gwei / " + batchSize + " tx"],
        ["State diff", perTxData, diff + " bytes x " + wei(blobFee) + " wei of blob gas"]
      ]
    };
  }
  /* the curve, for the chart: cost per tx against batch size */
  function validityCurve(o, sizes) {
    var list = sizes && sizes.length ? sizes : [1, 10, 100, 1000, 10000, 100000];
    var out = [], i, r;
    for (i = 0; i < list.length; i++) {
      r = validityFee({
        l2Gas: o.l2Gas, l2GasPriceWei: o.l2GasPriceWei, l1BaseFeeWei: o.l1BaseFeeWei,
        blobBaseFeeWei: o.blobBaseFeeWei, batchSize: list[i], stateDiffBytes: o.stateDiffBytes
      });
      if (r) out.push({ batchSize: list[i], totalWei: r.totalWei, asymptoteWei: r.asymptoteWei });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Solana. Two parts, neither of them an auction.
     ------------------------------------------------------------------ */
  function solanaFee(o) {
    o = o || {};
    var sigs = o.signatures > 0 ? +o.signatures : 1;
    var cu = +o.computeUnits;
    var micro = o.microLamportsPerCU >= 0 ? +o.microLamportsPerCU : SOL_MICRO_LAMPORTS_PER_CU;
    if (!(cu > 0)) return null;
    var capped = Math.min(cu, SOL_CU_TX_LIMIT);
    var base = SOL_BASE_FEE_LAMPORTS * sigs;
    var prio = Math.ceil(capped * micro / 1e6);
    return {
      chainKind: "svm",
      signatures: sigs, computeUnits: cu, computeUnitsCharged: capped,
      overLimit: cu > SOL_CU_TX_LIMIT, cuLimit: SOL_CU_TX_LIMIT,
      baseLamports: base, priorityLamports: prio, totalLamports: base + prio,
      totalSol: (base + prio) / SOL_LAMPORTS,
      microLamportsPerCU: micro,
      parts: [
        ["Base fee", base, sigs + " signature x " + SOL_BASE_FEE_LAMPORTS + " lamports, fixed"],
        ["Priority fee", prio, "ceil(" + capped + " CU x " + micro + " micro-lamports / 1e6)"]
      ],
      noAuction: "There is no first-price gas auction here. The priority fee buys scheduling position in the leader's queue; it is not a bid the highest bidder wins, it does not move with load by itself, and an unscheduled transaction is simply not included rather than sitting in a mempool being outbid."
    };
  }

  /* Whirlpool's tick arrays: 88 ticks each, at most 3 referenced by one swap.
     This is why a big swap FAILS on Solana where it merely costs more on an
     EVM chain — the instruction cannot reach the liquidity. */
  function solanaTickArrays(spacing, ticksTravelled) {
    if (!(spacing > 0)) return null;
    var spacingsTravelled = Math.abs(ticksTravelled) / spacing;
    var arraysNeeded = Math.max(1, Math.ceil(spacingsTravelled / WHIRLPOOL_TICKS_PER_ARRAY));
    var maxSpacings = WHIRLPOOL_ARRAYS_PER_SWAP * WHIRLPOOL_TICKS_PER_ARRAY;
    var maxTicks = maxSpacings * spacing;
    return {
      spacing: spacing, ticksPerArray: WHIRLPOOL_TICKS_PER_ARRAY, arraysPerSwap: WHIRLPOOL_ARRAYS_PER_SWAP,
      ticksTravelled: Math.abs(ticksTravelled), spacingsTravelled: spacingsTravelled,
      arraysNeeded: arraysNeeded, arraysAvailable: WHIRLPOOL_ARRAYS_PER_SWAP,
      maxTicksPerSwap: maxTicks,
      maxPriceRatio: Math.pow(1.0001, maxTicks),
      maxMovePct: (Math.pow(1.0001, maxTicks) - 1) * 100,
      fits: arraysNeeded <= WHIRLPOOL_ARRAYS_PER_SWAP,
      remedy: "Split the order into " + Math.ceil(arraysNeeded / WHIRLPOOL_ARRAYS_PER_SWAP) + " transactions, each landing inside three tick arrays. On an EVM chain the same order is expensive; here it reverts."
    };
  }
  function solanaComputeUnits(crossings, arrays) {
    return SOL_CU_TX_OVERHEAD + SOL_CU_SWAP +
      SOL_CU_PER_TICK_ARRAY * Math.max(1, arrays || 1) +
      SOL_CU_PER_CROSS * Math.max(0, crossings || 0);
  }

  function gwei(w) { return w == null ? "—" : (w / 1e9 < 0.001 ? (w / 1e9).toExponential(2) : (w / 1e9).toFixed(4)); }
  function wei(w) { return w == null ? "—" : (w >= 1e6 ? w.toExponential(3) : w.toFixed(2)); }

  /* ==================================================================
     4 · BRIDGING — the mechanisms, the failures, and who must be honest
     ================================================================== */

  /* the interoperability-trilemma taxonomy (Connext / Arjun Bhuptani).
     This is a RISK STATEMENT, not a rating: there is no ordering here. */
  var TRUST = {
    native: {
      key: "native", label: "natively verified",
      one: "The destination chain verifies the source chain's state itself, in a contract, with no outside party — what must hold is the source chain's consensus and the bridge contract's code."
    },
    external: {
      key: "external", label: "externally verified (m-of-n)",
      one: "An outside validator set signs the transfer — m of n of them must stay honest, and any m that collude can mint what was never burned."
    },
    optimistic: {
      key: "optimistic", label: "optimistically verified",
      one: "The claim is assumed true unless someone disputes it inside the window — what must exist is at least one honest watcher with the capital and the will to post a bond in time."
    },
    local: {
      key: "local", label: "locally verified",
      one: "Only you and your counterparty can affect the outcome — nobody can take the funds, but the counterparty can strand them until the timelock expires and you pay the gas to unwind."
    },
    /* not a fifth kind of bridge — the absence of one. Kept separate so the
       taxonomy above stays the four-way taxonomy it is. */
    none: {
      key: "none", label: "no bridge",
      one: "The funds are already on this chain, so nothing outside it has to be honest — only the chain's own consensus and the pool contract."
    }
  };

  /* ---- modelling constants, every one of them named where it is used ---- */
  var LIQ_LP_FEE_BPS = 4;
  var LIQ_PREMIUM_BPS_PER_UTIL = 30;
  var LIQ_START_UTIL = 0.35;
  var LIQ_ETA_SEC = 90;
  var RELAY_FAIL_RATE = 0.004;
  var ATTEST_QUORUM_M = 2, ATTEST_QUORUM_N = 3;
  var ATTEST_FEE_USD = 0.50;
  var MSG_ETA_SEC = 840;               /* two epochs of Ethereum finality, plus relay */
  var CANON_IN_ETA_SEC = 180;
  var OPTIMISTIC_CHALLENGE_SEC = 604800;   /* the OP-stack seven days */
  var ZK_PROOF_ETA_SEC = 10800;
  var DEST_GAS_BUFFER = 1.25;
  var DEST_GAS_SPIKE = 2.0;            /* the modelled adverse move in destination gas */
  var REFUND_DELAY_SEC = 3600;
  var REFUND_FEE_BPS = 10;
  var L1_FINALITY_SEC = 780;
  var HTLC_SPREAD_BPS = 25;            /* what a counterparty charges to take the other side */
  var HTLC_ETA_SEC = 1800;             /* modelled: half of a conservative timelock */
  var HTLC_MAX_USD = 2.5e5;            /* what one counterparty will realistically take */
  var SIGMA_FLOOR = 0.30, SIGMA_CAP = 2.5;
  var YEAR_SEC = 31557600;

  /* destination inventory a fast bridge can actually front, in USD. Modelled. */
  var LIQ_INVENTORY_USD = {
    ethereum: 5.0e6, arbitrum: 2.5e6, base: 2.5e6, optimism: 1.2e6, zkrollup: 4.0e5, solana: 1.8e6
  };

  /* ------------------------------------------------------------------
     A liquidity ("fast") bridge. The LP on the destination fronts the
     asset and is repaid over the canonical path later, so you pay a flat
     LP fee plus a rebalancing premium that rises with how much of that
     inventory you have just consumed — and you are CAPPED by it.
     ------------------------------------------------------------------ */
  function bridgeLiquidity(o) {
    o = o || {};
    var amount = +o.amountUSD, inv = +o.inventoryUSD;
    var u0 = o.utilisation >= 0 ? +o.utilisation : LIQ_START_UTIL;
    var lp = o.lpFeeBps >= 0 ? +o.lpFeeBps : LIQ_LP_FEE_BPS;
    var k = o.premiumBpsPerUtil >= 0 ? +o.premiumBpsPerUtil : LIQ_PREMIUM_BPS_PER_UTIL;
    if (!(amount > 0) || !(inv > 0)) return null;
    var free = inv * (1 - u0);
    var filled = Math.min(amount, free);
    var u1 = inv > 0 ? u0 + filled / inv : u0;
    /* the premium is linear in utilisation, so its average over the fill is
       the midpoint — the integral, not the endpoint */
    var premiumBps = k * (u0 + u1) / 2;
    var feeUSD = filled * (lp + premiumBps) / 1e4;
    return {
      amountUSD: amount, inventoryUSD: inv, utilisationBefore: u0, utilisationAfter: u1,
      capacityUSD: free, filledUSD: filled, unfilledUSD: amount - filled,
      partial: amount - filled > amount * 1e-9,
      lpFeeBps: lp, premiumBps: premiumBps, allInBps: lp + premiumBps, feeUSD: feeUSD,
      note: amount > free
        ? "The destination LP can front " + Math.round(free).toLocaleString() + " USD of this. The rest does not fail quietly — it either waits for the LP to rebalance or falls back to the canonical route, which is slower and is priced as its own row."
        : "Inside the destination LP's inventory, so it fills in one go."
    };
  }

  /* ------------------------------------------------------------------
     Normal CDF — Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. Used only
     for the slippage-breach probability on the Bridges tab.
     ------------------------------------------------------------------ */
  function erfApprox(x) {
    var sign = x < 0 ? -1 : 1, ax = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * ax);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
  }
  function normalCdf(z) { return 0.5 * (1 + erfApprox(z / Math.SQRT2)); }

  /* ------------------------------------------------------------------
     THE FOUR FAILURE MODES. Each carries its own arithmetic and its own
     remedy, because a bridge quoted only on its happy path is quoted wrong.
     ------------------------------------------------------------------ */
  function failureModes(o) {
    o = o || {};
    var principal = +o.principalUSD || 0;
    var srcGas = +o.srcGasUSD || 0;
    var dstGas = +o.dstGasUSD || 0;
    var bridgeFee = +o.bridgeFeeUSD || 0;
    var etaSec = +o.etaSec || 0;
    var sigma = +o.sigmaAnnual > 0 ? +o.sigmaAnnual : SIGMA_FLOOR;
    var tolPct = +o.tolerancePct > 0 ? +o.tolerancePct : 0.5;
    var out = [];

    /* 1 · stuck message — attested but never executed on the destination */
    var stuckRemedy = dstGas;
    out.push({
      id: "stuck",
      label: "Stuck message",
      what: "The source burn or lock happened and the attestation exists, but no relayer executed it on the destination. Nothing is lost; nothing has arrived either.",
      probability: RELAY_FAIL_RATE,
      sunkUSD: srcGas + bridgeFee,
      remedy: "Call the destination executor yourself against the same attestation. Anyone can, which is the point of the design.",
      remedyCostUSD: stuckRemedy,
      expectedCostUSD: RELAY_FAIL_RATE * stuckRemedy,
      arithmetic: "sunk = source gas " + usd(srcGas) + " + bridge fee " + usd(bridgeFee) + " = " + usd(srcGas + bridgeFee) + "; remedy = one destination transaction at " + usd(dstGas) + "; expected = " + (RELAY_FAIL_RATE * 100).toFixed(2) + "% x " + usd(stuckRemedy) + " = " + usd(RELAY_FAIL_RATE * stuckRemedy) + " (relayer failure rate is a modelling constant, " + RELAY_FAIL_RATE + ")"
    });

    /* 2 · insufficient destination gas */
    var quoted = dstGas * DEST_GAS_BUFFER;
    var required = dstGas * DEST_GAS_SPIKE;
    var shortfall = Math.max(0, required - quoted);
    out.push({
      id: "dstgas",
      label: "Insufficient destination gas",
      what: "The destination execution was paid for at source-time prices with a buffer. The destination base fee moved past it, the call reverted on gas, and the funds are sitting in the bridge's escrow.",
      probability: null,
      sunkUSD: srcGas + bridgeFee,
      remedy: "Top up the destination gas and re-execute. The principal is not at risk; the delay and the extra transaction are.",
      remedyCostUSD: shortfall + dstGas,
      expectedCostUSD: null,
      arithmetic: "quoted = destination gas " + usd(dstGas) + " x buffer " + DEST_GAS_BUFFER + " = " + usd(quoted) + "; required after a " + DEST_GAS_SPIKE + "x move = " + usd(required) + "; shortfall = " + usd(shortfall) + "; re-execute costs that plus one more destination transaction, " + usd(shortfall + dstGas) + " in total (the " + DEST_GAS_SPIKE + "x move is a modelled adverse case, not a forecast)"
    });

    /* 3 · destination slippage over the transit window */
    var tYears = etaSec > 0 ? etaSec / YEAR_SEC : 0;
    var sigmaT = sigma * Math.sqrt(tYears);
    var expDriftPct = sigmaT * Math.sqrt(2 / Math.PI) * 100;
    var breach = sigmaT > 0 ? 2 * (1 - normalCdf((tolPct / 100) / sigmaT)) : 0;
    out.push({
      id: "slippage",
      label: "Destination slippage",
      what: "You were quoted at source time and you execute after the transit window. Over that window the price moves, and if it moves past your minimum-out the destination swap reverts rather than filling badly.",
      probability: breach,
      sunkUSD: srcGas + bridgeFee,
      remedy: "Set the minimum-out against the transit window rather than against a spot quote, or take a route whose window is short enough that the window stops mattering.",
      remedyCostUSD: null,
      expectedCostUSD: principal * expDriftPct / 100,
      arithmetic: "window " + fmtSec(etaSec) + "; sigma " + (sigma * 100).toFixed(0) + "%/yr annualised from this symbol's own 24h move, floored at " + (SIGMA_FLOOR * 100) + "% and capped at " + (SIGMA_CAP * 100) + "%; sigma over the window = " + (sigmaT * 100).toFixed(3) + "%; expected absolute drift = sigma x sqrt(2/pi) = " + expDriftPct.toFixed(3) + "% = " + usd(principal * expDriftPct / 100) + "; probability of breaching a " + tolPct + "% floor = 2(1 - Phi(" + (sigmaT > 0 ? ((tolPct / 100) / sigmaT).toFixed(2) : "—") + ")) = " + (breach * 100).toFixed(2) + "%"
    });

    /* 4 · the refund path */
    var refundFee = principal * REFUND_FEE_BPS / 1e4;
    var recovered = Math.max(0, principal - srcGas - dstGas - refundFee);
    out.push({
      id: "refund",
      label: "The refund path",
      what: "The floor was breached, or the destination call reverted for good, and the bridge returns the principal on the source chain instead. This is the branch nobody quotes.",
      probability: null,
      sunkUSD: srcGas + dstGas + refundFee,
      remedy: "None. The refund is the remedy, and it is not whole.",
      remedyCostUSD: null,
      expectedCostUSD: principal - recovered,
      arithmetic: "principal " + usd(principal) + " - source gas " + usd(srcGas) + " - destination gas already burned " + usd(dstGas) + " - refund fee " + REFUND_FEE_BPS + "bp = " + usd(refundFee) + " -> recovered " + usd(recovered) + ", a loss of " + usd(principal - recovered) + " after " + fmtSec(REFUND_DELAY_SEC) + " (refund fee and delay are modelling constants)"
    });
    return out;
  }

  /* ------------------------------------------------------------------
     The route table. Every route carries its mechanism, its cost parts,
     its time to finality and its trust statement.
     ------------------------------------------------------------------ */
  function bridgeRoutes(o) {
    o = o || {};
    var to = String(o.to || "arbitrum");
    var amount = +o.amountUSD || 0;
    var srcGasUSD = +o.srcGasUSD || 0;      /* one L1 transaction */
    var dstGasUSD = +o.dstGasUSD || 0;      /* one destination transaction */
    var optimistic = o.optimistic !== false;
    var from = String(o.from || "ethereum");
    var inv = LIQ_INVENTORY_USD[to] > 0 ? LIQ_INVENTORY_USD[to] : 5.0e5;
    var rows = [];

    /* A canonical bridge exists only between a rollup and ITS settlement layer.
       There is no canonical Ethereum-to-Solana bridge and there never will be:
       neither chain verifies the other. Offering one would be the single most
       misleading row this desk could print, so the route simply is not there. */
    var toCh = chainById(to), frCh = chainById(from);
    var hasCanonical = !!((frCh && frCh.id === "ethereum" && toCh && toCh.canonical) ||
      (toCh && toCh.id === "ethereum" && frCh && frCh.canonical));

    /* 1 · canonical lock-mint, L1 -> L2 */
    if (hasCanonical) rows.push({
      id: "canonical-in", name: "Canonical bridge (lock-mint)", dir: "L1 to L2",
      mechanism: "Deposit locks on L1 and the destination's derivation pipeline mints the representation. One L1 transaction; the destination side is paid for by the deposit.",
      feeUSD: srcGasUSD, feeParts: [["L1 deposit gas", srcGasUSD, "one L1 transaction at the session's gas signal"]],
      filledUSD: amount, unfilledUSD: 0, partial: false,
      etaSec: CANON_IN_ETA_SEC, etaNote: "sequencer inclusion plus the derivation lag",
      trust: TRUST.native, honestSet: null,
      capacityUSD: null
    });

    /* 2 · canonical burn-mint, L2 -> L1 */
    if (hasCanonical) rows.push({
      id: "canonical-out", name: "Canonical withdrawal (burn-mint)", dir: "L2 to L1",
      mechanism: optimistic
        ? "Burn on L2, prove the withdrawal against a published output root on L1, wait out the challenge window, then finalise. Three transactions and a week."
        : "Burn on L2, wait for the next validity proof to land on L1, then finalise. Two transactions and a few hours.",
      feeUSD: dstGasUSD + srcGasUSD * 2,
      feeParts: [
        ["L2 burn", dstGasUSD, "one destination transaction"],
        ["L1 prove", srcGasUSD, "one L1 transaction against the output root"],
        ["L1 finalise", srcGasUSD, "one L1 transaction after the wait"]
      ],
      filledUSD: amount, unfilledUSD: 0, partial: false,
      etaSec: optimistic ? OPTIMISTIC_CHALLENGE_SEC : ZK_PROOF_ETA_SEC,
      etaNote: optimistic
        ? "the seven-day challenge window, 604800 seconds, as the OP-stack contracts are configured"
        : "the modelled proof cadence, three hours",
      trust: optimistic ? TRUST.optimistic : TRUST.native, honestSet: null,
      capacityUSD: null
    });

    /* 3 · liquidity (fast) bridge */
    var liq = bridgeLiquidity({ amountUSD: amount, inventoryUSD: inv });
    if (liq) {
      rows.push({
        id: "liquidity", name: "Liquidity bridge (fast)", dir: "either way",
        mechanism: "An LP on the destination fronts the asset immediately and is repaid over the canonical path later. You are buying their patience, and you are capped by their inventory.",
        feeUSD: liq.feeUSD + srcGasUSD + dstGasUSD,
        feeParts: [
          ["LP fee", liq.filledUSD * liq.lpFeeBps / 1e4, liq.lpFeeBps + "bp of the filled amount"],
          ["Rebalancing premium", liq.filledUSD * liq.premiumBps / 1e4, liq.premiumBps.toFixed(2) + "bp — " + LIQ_PREMIUM_BPS_PER_UTIL + "bp per unit of inventory utilisation, averaged from " + (liq.utilisationBefore * 100).toFixed(0) + "% to " + (liq.utilisationAfter * 100).toFixed(0) + "%"],
          ["Source gas", srcGasUSD, "one source transaction"],
          ["Destination gas", dstGasUSD, "one destination transaction"]
        ],
        filledUSD: liq.filledUSD, unfilledUSD: liq.unfilledUSD, partial: liq.partial,
        etaSec: LIQ_ETA_SEC, etaNote: "modelled LP settlement, 90 seconds",
        trust: TRUST.external, honestSet: "the bridge's own validator set — a fast bridge that fronts you an asset has already decided the source event happened before the source chain is final",
        capacityUSD: liq.capacityUSD, liq: liq
      });
    }

    /* 4 · message passing with an attestation quorum */
    rows.push({
      id: "message", name: "Message passing (burn + attest + mint)", dir: "either way",
      mechanism: "Burn on the source, an off-chain attester set observes it and signs, and the destination contract mints against " + ATTEST_QUORUM_M + " of " + ATTEST_QUORUM_N + " signatures. No pooled liquidity, so no capacity limit — and no canonical proof either.",
      feeUSD: srcGasUSD + dstGasUSD + ATTEST_FEE_USD,
      feeParts: [
        ["Source burn gas", srcGasUSD, "one source transaction"],
        ["Attestation fee", ATTEST_FEE_USD, "modelled flat fee for the signing service"],
        ["Destination mint gas", dstGasUSD, "one destination transaction"]
      ],
      filledUSD: amount, unfilledUSD: 0, partial: false,
      etaSec: MSG_ETA_SEC, etaNote: "source finality (two Ethereum epochs, " + L1_FINALITY_SEC + "s) plus the attester round",
      trust: TRUST.external,
      honestSet: ATTEST_QUORUM_M + " of " + ATTEST_QUORUM_N + " attesters must stay honest; any " + ATTEST_QUORUM_M + " that collude can mint on the destination without a burn on the source",
      capacityUSD: null
    });

    /* 5 · atomic swap. The only locally verified route, and the only one that
       works between two ecosystems that cannot verify each other at all. */
    var htlcFill = Math.min(amount, HTLC_MAX_USD);
    rows.push({
      id: "htlc", name: "Atomic swap (hash timelock)", dir: "either way",
      mechanism: "You and a counterparty lock funds on both chains behind the same hash, and whoever claims first reveals the preimage that lets the other claim. No bridge contract, no validator set, no pooled liquidity — and no way to move more than one counterparty will take.",
      feeUSD: htlcFill * HTLC_SPREAD_BPS / 1e4 + srcGasUSD * 2 + dstGasUSD * 2,
      feeParts: [
        ["Counterparty spread", htlcFill * HTLC_SPREAD_BPS / 1e4, HTLC_SPREAD_BPS + "bp — what the other side charges to take the risk of the timelock (modelled)"],
        ["Source lock + claim", srcGasUSD * 2, "two source transactions"],
        ["Destination lock + claim", dstGasUSD * 2, "two destination transactions"]
      ],
      filledUSD: htlcFill, unfilledUSD: amount - htlcFill, partial: amount - htlcFill > amount * 1e-9,
      etaSec: HTLC_ETA_SEC, etaNote: "modelled — half a conservative timelock, and the whole timelock if the counterparty walks",
      trust: TRUST.local,
      honestSet: "nobody has to be honest; the counterparty can only strand you until the timelock expires, and unwinding costs you the gas on both sides",
      capacityUSD: HTLC_MAX_USD
    });

    for (var i = 0; i < rows.length; i++) {
      rows[i].to = to;
      rows[i].hasCanonical = hasCanonical;
      rows[i].failures = failureModes({
        principalUSD: amount, srcGasUSD: srcGasUSD, dstGasUSD: dstGasUSD,
        bridgeFeeUSD: rows[i].feeUSD, etaSec: rows[i].etaSec,
        sigmaAnnual: o.sigmaAnnual, tolerancePct: o.tolerancePct
      });
    }
    return rows;
  }

  /* the cheapest route that can actually carry the size */
  function bestRoute(rows, wantWhole) {
    var best = null, i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.id === "canonical-out") continue;          /* not an inbound route */
      if (wantWhole && r.partial) continue;
      if (!best || r.feeUSD < best.feeUSD) best = r;
    }
    if (!best) for (i = 0; i < rows.length; i++) if (rows[i].id !== "canonical-out" && (!best || rows[i].feeUSD < best.feeUSD)) best = rows[i];
    return best;
  }

  /* ==================================================================
     5 · THE CHAINS, THE SIGNALS, AND THE COMPARISON
     ================================================================== */

  var CHAINS = [
    { id: "ethereum", name: "Ethereum", kind: "l1", native: "ETH", dex: "Uniswap v3", feePips: 3000, liqShare: 1.00, l2BaseFeeGwei: null, blockSec: 12, finalitySec: L1_FINALITY_SEC, optimistic: false, canonical: false },
    { id: "arbitrum", canonical: true, name: "Arbitrum One", kind: "nitro", native: "ETH", dex: "Uniswap v3", feePips: 500, liqShare: 0.22, l2BaseFeeGwei: 0.01, blockSec: 0.25, finalitySec: OPTIMISTIC_CHALLENGE_SEC, optimistic: true },
    { id: "base", canonical: true, name: "Base", kind: "opstack", native: "ETH", dex: "Uniswap v3", feePips: 500, liqShare: 0.18, l2BaseFeeGwei: 0.005, blockSec: 2, finalitySec: OPTIMISTIC_CHALLENGE_SEC, optimistic: true },
    { id: "optimism", canonical: true, name: "OP Mainnet", kind: "opstack", native: "ETH", dex: "Uniswap v3", feePips: 3000, liqShare: 0.07, l2BaseFeeGwei: 0.005, blockSec: 2, finalitySec: OPTIMISTIC_CHALLENGE_SEC, optimistic: true },
    { id: "zkrollup", canonical: true, name: "Validity rollup", kind: "validity", native: "ETH", dex: "Uniswap v3 fork", feePips: 500, liqShare: 0.03, l2BaseFeeGwei: 0.02, blockSec: 1, finalitySec: ZK_PROOF_ETA_SEC, optimistic: false },
    { id: "solana", name: "Solana", kind: "svm", native: "SOL", dex: "Orca Whirlpool", feePips: 1600, liqShare: 0.35, l2BaseFeeGwei: null, blockSec: 0.4, finalitySec: 13, optimistic: false, canonical: false }
  ];
  function chainById(id) { var i; for (i = 0; i < CHAINS.length; i++) if (CHAINS[i].id === id) return CHAINS[i]; return null; }

  /* ---- the signals. Resolved OFF the quote path and cached, so two
     adjacent quotes cannot disagree — the same discipline as 53-sor.js. ---- */
  var SIG = {
    l1Gwei: 5, l1Src: "fallback", cong: "calm",
    blobLevel: "floor", excessBlobGas: 0, blobWei: 1,
    ethUSD: null, solUSD: null, at: 0
  };

  function ethUSD() { try { var c = C.coin("ETH"); return (c && +c.price) > 0 ? +c.price : null; } catch (e) { return null; } }
  function solUSD() { try { var c = C.coin("SOL"); return (c && +c.price) > 0 ? +c.price : null; } catch (e) { return null; } }
  function unitsSwap() { try { return P().GAS_UNITS.swap; } catch (e) { return 150000; } }
  function tierMult(t) { try { var m = P().TIER_MULT; return m[t] || m.medium || 1; } catch (e) { return 1; } }

  function refreshSignals(blobLevel) {
    var p = P();
    SIG.l1Src = "fallback";
    try { if (p && p.FALLBACK_GWEI > 0) SIG.l1Gwei = p.FALLBACK_GWEI; } catch (e) {}
    /* Prefer the session's live estimate and say so. gasEstimate carries the
       account's tier multiplier, so backing out a raw gwei divides it out
       again — otherwise every gas figure here is wrong by TIER_MULT. */
    try {
      var lp = LP();
      if (lp && typeof lp.gasEstimate === "function") {
        var usdv = lp.gasEstimate("USDT"), eth = ethUSD(), units = unitsSwap(), acct = 1;
        try { acct = tierMult(String(lp.tierOf(S))); } catch (e) { acct = 1; }
        if (!(acct > 0)) acct = 1;
        if (usdv > 0 && eth > 0 && units > 0) { SIG.l1Gwei = usdv / (units * 1e-9 * eth) / acct; SIG.l1Src = "live"; }
      }
    } catch (e) {}
    try {
      var sig = p && p.signal ? p.signal(SIG.l1Gwei, [], 0, SIG.l1Src) : null;
      if (sig && p.congestion) SIG.cong = String(p.congestion(sig) || "calm");
    } catch (e) { SIG.cong = "calm"; }
    if (blobLevel && EXCESS_BLOB_GAS[blobLevel] != null) SIG.blobLevel = blobLevel;
    SIG.excessBlobGas = EXCESS_BLOB_GAS[SIG.blobLevel];
    SIG.blobWei = blobBaseFeeWei(SIG.excessBlobGas);
    SIG.ethUSD = ethUSD();
    SIG.solUSD = solUSD();
    SIG.at = C.now ? C.now() : 0;
    return SIG;
  }

  /* ---- one transaction's fee on one chain, in USD, with its decomposition ---- */
  function chainGas(chain, o) {
    o = o || {};
    var l2Gas = o.gasUnits > 0 ? +o.gasUnits : unitsSwap();
    var l1Wei = SIG.l1Gwei * 1e9;
    var eth = SIG.ethUSD, sol = SIG.solUSD;
    var batchSize = o.batchSize > 0 ? +o.batchSize : null;
    if (chain.kind === "svm") {
      if (!(sol > 0)) return null;                  /* a missing price stays missing */
      var cu = o.computeUnits > 0 ? +o.computeUnits : solanaComputeUnits(o.crossings || 0, o.arrays || 1);
      var f = solanaFee({ computeUnits: cu, signatures: 1 });
      if (!f) return null;
      return { chain: chain.id, model: f, usd: f.totalSol * sol, native: "SOL", unit: "lamports", srcLabel: "5000 lamports/sig fixed + " + SOL_MICRO_LAMPORTS_PER_CU + " micro-lamports/CU (modelled)" };
    }
    if (!(eth > 0)) return null;
    if (chain.kind === "l1") {
      var wei1 = l2Gas * l1Wei;
      return {
        chain: chain.id, native: "ETH", unit: "wei", usd: wei1 / 1e18 * eth,
        model: {
          chainKind: "l1", l2FeeWei: wei1, l1FeeWei: 0, totalWei: wei1, l1SharePct: 0,
          parts: [["L1 execution", wei1, l2Gas + " gas x " + SIG.l1Gwei.toFixed(2) + " gwei"]]
        },
        srcLabel: "L1 base fee " + SIG.l1Gwei.toFixed(2) + " gwei (" + SIG.l1Src + ", " + SIG.cong + ")"
      };
    }
    if (chain.kind === "opstack") {
      var m = opStackFee({
        l2Gas: l2Gas, l2BaseFeeWei: chain.l2BaseFeeGwei * 1e9, l2PriorityFeeWei: 0,
        l1BaseFeeWei: l1Wei, blobBaseFeeWei: SIG.blobWei
      });
      return m ? { chain: chain.id, native: "ETH", unit: "wei", usd: m.totalWei / 1e18 * eth, model: m, srcLabel: "L2 base fee " + chain.l2BaseFeeGwei + " gwei (modelled) · L1 " + SIG.l1Gwei.toFixed(2) + " gwei (" + SIG.l1Src + ") · blob " + wei(SIG.blobWei) + " wei (" + SIG.blobLevel + ", computed)" } : null;
    }
    if (chain.kind === "nitro") {
      var a = arbitrumFee({
        l2Gas: l2Gas, l2GasPriceWei: chain.l2BaseFeeGwei * 1e9,
        l1BaseFeeWei: l1Wei, blobBaseFeeWei: SIG.blobWei, batchSize: batchSize || 400
      });
      return a ? { chain: chain.id, native: "ETH", unit: "wei", usd: a.totalWei / 1e18 * eth, model: a, srcLabel: "L2 gas price " + chain.l2BaseFeeGwei + " gwei (its published floor) · L1 " + SIG.l1Gwei.toFixed(2) + " gwei (" + SIG.l1Src + ") · blob " + wei(SIG.blobWei) + " wei (" + SIG.blobLevel + ", computed)" } : null;
    }
    if (chain.kind === "validity") {
      var v = validityFee({
        l2Gas: l2Gas, l2GasPriceWei: chain.l2BaseFeeGwei * 1e9,
        l1BaseFeeWei: l1Wei, blobBaseFeeWei: SIG.blobWei, batchSize: batchSize || 2000
      });
      return v ? { chain: chain.id, native: "ETH", unit: "wei", usd: v.totalWei / 1e18 * eth, model: v, srcLabel: "L2 gas price " + chain.l2BaseFeeGwei + " gwei (modelled) · L1 " + SIG.l1Gwei.toFixed(2) + " gwei (" + SIG.l1Src + ") · batch " + (batchSize || 2000) + " tx (modelled)" } : null;
    }
    return null;
  }

  /* ---- market primitives, from the app's own signals ---- */
  function statsOf(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    if (!c || !(+c.price > 0)) return null;
    return { vol24: +c.vol || 0, mcap: +c.mcap || 0, chg24: +c.c24 || 0, price: +c.price };
  }
  function quoteUSD(sym) {
    if (!sym || sym === "USDT" || sym === "USD") return 1;
    try { var c = C.coin(sym), v = c && +c.price; return v > 0 ? v : null; } catch (e) { return null; }
  }
  function midOf(sym, q) {
    var s = statsOf(sym);
    if (!s) return null;
    var qp = quoteUSD(q);
    return qp > 0 ? s.price / qp : null;
  }
  /* annualised vol from the symbol's own 24h move — an app signal, floored
     and capped, and named as modelled wherever it is used */
  function sigmaOf(sym) {
    var s = statsOf(sym);
    if (!s) return SIGMA_FLOOR;
    var d = Math.abs(+s.chg24 || 0) / 100;
    var a = d * Math.sqrt(365);
    return Math.max(SIGMA_FLOOR, Math.min(SIGMA_CAP, a));
  }
  /* the engine's own pool TVL for this symbol, scaled by the chain's share */
  function tvlQuoteFor(st, q, share) {
    var p = P();
    if (!p) return null;
    try {
      var spec = p.poolSpec(st, "dexamm", null);
      if (!spec || !(spec.tvlUSD > 0)) return null;
      var qp = quoteUSD(q);
      if (!(qp > 0)) return null;
      return spec.tvlUSD * share / qp;
    } catch (e) { return null; }
  }

  function forkPool() {
    try {
      var fk = window.DLAPP && window.DLAPP.fork;
      var pool = fk && fk.pool ? fk.pool() : null;
      if (!pool) return null;
      var fv = fk.routed ? fk.routed() : null;
      return { name: (fv && fv.n) || "Forked pool", feeRate: (fv && fv.feeRate != null) ? fv.feeRate : 0.003, pool: pool };
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------
     ticksFor(sym, quote, chainId) — the modelled ladder for one chain.
     ------------------------------------------------------------------ */
  function ticksFor(sym, q, chainId) {
    var ch = chainById(chainId) || CHAINS[0];
    var st = statsOf(sym), mid = midOf(sym, q);
    if (!st || !(mid > 0)) return null;
    var tvl = tvlQuoteFor(st, q, ch.liqShare);
    if (!(tvl > 0)) return null;
    var pool = buildTicks({
      price: mid, tvlQuote: tvl, feePips: ch.feePips,
      seed: sym + "|" + q + "|" + ch.id + "|" + ch.feePips
    });
    if (pool) { pool.chain = ch.id; pool.chainName = ch.name; pool.dex = ch.dex; }
    return pool;
  }

  /* ------------------------------------------------------------------
     compare() — the same trade, every chain, all-in, nothing folded.
     PURE: no clock inside the maths, no random, no balance written.
     ------------------------------------------------------------------ */
  function compare(req) {
    req = req || {};
    var sym = String(req.sym || "BTC").toUpperCase();
    var q = String(req.quote || "USDT").toUpperCase();
    var side = req.side === "sell" ? "sell" : "buy";
    var base = +req.base;
    var from = String(req.from || "ethereum");
    var tolPct = +req.tolerancePct > 0 ? +req.tolerancePct : 0.5;
    var batchSize = +req.batchSize > 0 ? +req.batchSize : null;

    /* The signals are resolved OFF the quote path and cached, so two adjacent
       quotes cannot disagree. But compare() must not depend on the UI having
       been opened first: resolve them ONCE here if nothing ever has, and never
       again from inside the maths. */
    if (!SIG.at) refreshSignals(null);

    var st = statsOf(sym), mid = midOf(sym, q), qp = quoteUSD(q);
    if (!st || !(mid > 0)) return { sym: sym, quote: q, side: side, base: base > 0 ? base : null, mid: null, rows: [], note: "No market for " + sym + "/" + q + " — nothing to quote. A missing market stays missing here; it does not become a zero." };
    if (!(base > 0)) return { sym: sym, quote: q, side: side, base: null, mid: mid, rows: [], note: "Enter a size greater than zero." };

    var notionalQuote = base * mid;
    var notionalUSD = qp > 0 ? notionalQuote * qp : null;
    var sigma = sigmaOf(sym);
    var rows = [], i;

    for (i = 0; i < CHAINS.length; i++) {
      var ch = CHAINS[i];
      var pool = ticksFor(sym, q, ch.id);
      if (!pool) continue;
      var zeroForOne = (side === "sell");
      var amountIn = zeroForOne ? base : notionalQuote;
      var w = swapWalk(pool, zeroForOne, amountIn);
      if (!w) continue;

      /* Solana's tick arrays decide whether this order can be ONE transaction */
      var arrays = null, txCount = 1;
      if (ch.kind === "svm") {
        arrays = solanaTickArrays(pool.spacing, Math.abs(w.tickEnd - w.tickStart));
        if (arrays && !arrays.fits) txCount = Math.ceil(arrays.arraysNeeded / WHIRLPOOL_ARRAYS_PER_SWAP);
      }

      /* gas on the destination chain, for the swap itself */
      var g = chainGas(ch, {
        crossings: w.crossings, arrays: arrays ? Math.min(arrays.arraysNeeded, WHIRLPOOL_ARRAYS_PER_SWAP) : 1,
        batchSize: batchSize
      });
      var gasUSD = g && g.usd != null ? g.usd * txCount : null;

      /* bridging, if this is not the chain the money is already on */
      var bridge = null, bridgeRows = null, bridgeUSD = 0, etaSec = 0, trust = TRUST.none, unbridgedUSD = 0;
      if (ch.id !== from) {
        var srcChain = chainById(from) || CHAINS[0];
        var gSrc = chainGas(srcChain, { batchSize: batchSize });
        bridgeRows = bridgeRoutes({
          to: ch.id, from: from, amountUSD: notionalUSD || 0,
          srcGasUSD: gSrc ? gSrc.usd : 0, dstGasUSD: g ? g.usd : 0,
          optimistic: ch.optimistic, sigmaAnnual: sigma, tolerancePct: tolPct
        });
        bridge = bestRoute(bridgeRows, true) || bestRoute(bridgeRows, false);
        if (bridge) {
          bridgeUSD = bridge.feeUSD;
          etaSec = bridge.etaSec;
          trust = bridge.trust;
          unbridgedUSD = bridge.unfilledUSD || 0;
        }
      } else {
        etaSec = ch.blockSec * 2;
        trust = TRUST.none;
      }

      /* all-in, in quote units, with nothing folded together */
      var bridgeQuoteUnits = qp > 0 ? bridgeUSD / qp : null;
      var gasQuoteUnits = (gasUSD != null && qp > 0) ? gasUSD / qp : null;
      var swapFee = w.feePaid;                       /* in the input token */
      var swapFeeQuote = zeroForOne ? swapFee * mid : swapFee;
      var allInQuote = null, unitCost = null, baseOut = null, quoteOut = null;

      if (zeroForOne) {
        baseOut = null; quoteOut = w.amountOut;
        if (gasQuoteUnits != null && bridgeQuoteUnits != null) {
          allInQuote = w.amountOut - gasQuoteUnits - bridgeQuoteUnits;
          unitCost = w.amountInUsed > 0 ? allInQuote / w.amountInUsed : null;
        }
      } else {
        baseOut = w.amountOut; quoteOut = null;
        if (gasQuoteUnits != null && bridgeQuoteUnits != null) {
          allInQuote = w.amountInUsed + gasQuoteUnits + bridgeQuoteUnits;
          unitCost = w.amountOut > 0 ? allInQuote / w.amountOut : null;
        }
      }
      var vsMidBps = (unitCost != null && mid > 0) ? (side === "buy" ? (unitCost / mid - 1) : (1 - unitCost / mid)) * 1e4 : null;

      rows.push({
        chain: ch.id, name: ch.name, kind: ch.kind, dex: ch.dex, native: ch.native,
        feePips: ch.feePips, feeRate: pool.fee, spacing: pool.spacing, liqShare: ch.liqShare,
        pool: pool, walk: w,
        impactBps: w.impactBps, crossings: w.crossings,
        swapFee: swapFee, swapFeeQuote: swapFeeQuote,
        gasUSD: gasUSD, gas: g, txCount: txCount, arrays: arrays,
        bridge: bridge, bridgeRoutes: bridgeRows, bridgeUSD: bridgeUSD,
        unbridgedUSD: unbridgedUSD,
        etaSec: etaSec, trust: trust,
        baseOut: baseOut, quoteOut: quoteOut,
        allInQuote: allInQuote, unitCost: unitCost, vsMidBps: vsMidBps,
        exhausted: w.exhausted, unfilledIn: w.amountInUnfilled,
        blocked: !!(arrays && !arrays.fits),
        rank: null
      });
    }

    /* rank on all-in cost ALONE. Time and trust sit beside it and are never
       folded in — there is no honest weight between a week and two minutes. */
    var sortable = [];
    for (i = 0; i < rows.length; i++) if (rows[i].unitCost != null) sortable.push(rows[i]);
    sortable.sort(function (a, b) { return side === "buy" ? a.unitCost - b.unitCost : b.unitCost - a.unitCost; });
    for (i = 0; i < sortable.length; i++) sortable[i].rank = i + 1;

    return {
      sym: sym, quote: q, side: side, base: base, mid: mid, from: from,
      notionalQuote: notionalQuote, notionalUSD: notionalUSD, sigmaAnnual: sigma,
      tolerancePct: tolPct, batchSize: batchSize,
      signals: { l1Gwei: SIG.l1Gwei, l1Src: SIG.l1Src, congestion: SIG.cong, blobLevel: SIG.blobLevel, blobWei: SIG.blobWei, ethUSD: SIG.ethUSD, solUSD: SIG.solUSD },
      rows: rows, best: sortable.length ? sortable[0] : null,
      note: sortable.length ? "" : "Nothing could be priced — the app has no ETH or SOL price this session, and a missing figure stays missing here."
    };
  }

  /* ==================================================================
     6 · FORMATTING
     ================================================================== */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function usd(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000) return "$" + n.toFixed(0);
    if (a >= 1) return "$" + n.toFixed(2);
    if (a >= 0.01) return "$" + n.toFixed(4);
    if (a === 0) return "$0";
    return "$" + n.toFixed(8);
  }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (a >= 1000) return n.toFixed(0);
    if (a >= 1) return n.toFixed(2);
    if (a >= 0.01) return n.toFixed(4);
    return n.toFixed(8);
  }
  function fmtQuote(n, q) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money && (q === "USDT" || q === "USD")) return C.money(n); } catch (e) {}
    return fmtNum(n) + " " + (q || "");
  }
  function fmtBps(n) { return n == null || !isFinite(n) ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + " bp"; }
  function fmtSec(n) {
    if (!(n > 0)) return "instant";
    if (n < 90) return n.toFixed(n < 10 ? 1 : 0) + "s";
    if (n < 5400) return (n / 60).toFixed(1) + "m";
    if (n < 172800) return (n / 3600).toFixed(1) + "h";
    return (n / 86400).toFixed(1) + "d";
  }
  function fmtEth(w) {
    if (w == null || !isFinite(w)) return "—";
    if (w === 0) return "0";
    var e = w / 1e18;
    return e >= 1e-6 ? e.toFixed(9) + " ETH" : w.toExponential(3) + " wei";
  }

  /* ==================================================================
     7 · STATE — the v154 bucket, namespaced. No storage key of our own.
     ================================================================== */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.chains) X.chains = { ticket: null };
    return X.chains;
  }
  function ticket(patch) {
    var b = bucket();
    var dflt = {
      sym: "BTC", quote: "USDT", side: "buy", base: 1, tolerancePct: 0.5,
      from: "ethereum", chain: "ethereum", blobLevel: "floor", batchSize: 2000, dest: "arbitrum"
    };
    if (!b) return patch ? merge(dflt, patch) : dflt;
    if (!b.ticket) b.ticket = dflt;
    if (patch) { b.ticket = merge(b.ticket, patch); try { C.save(); } catch (e) {} }
    return b.ticket;
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ==================================================================
     8 · THE UI
     ================================================================== */

  var LAST = { cmp: null, req: null };

  function currentCompare() {
    var t = ticket();
    refreshSignals(t.blobLevel);
    var req = {
      sym: t.sym, quote: t.quote, side: t.side, base: +t.base,
      from: t.from, tolerancePct: +t.tolerancePct, batchSize: +t.batchSize
    };
    LAST.req = req;
    LAST.cmp = compare(req);
    return LAST.cmp;
  }

  function field(label, inner) { return '<label class="ch-f"><span class="ch-fl">' + esc(label) + '</span>' + inner + '</label>'; }
  function opts(list, cur) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + esc(list[i][0]) + '"' + (String(cur) === String(list[i][0]) ? " selected" : "") + '>' + esc(list[i][1]) + '</option>';
    return h;
  }
  function chainOpts() { var o = [], i; for (i = 0; i < CHAINS.length; i++) o.push([CHAINS[i].id, CHAINS[i].name]); return o; }

  function ticketStrip() {
    var t = ticket();
    var h = '<div class="dl-2 ch-form">';
    h += field("Symbol", '<input id="chSym" class="dl-inp" type="text" value="' + esc(t.sym) + '" autocomplete="off" spellcheck="false" aria-label="Symbol">');
    h += field("Side", '<select id="chSide" class="dl-inp" aria-label="Side">' + opts([["buy", "Buy"], ["sell", "Sell"]], t.side) + '</select>');
    h += field("Size (base)", '<input id="chBase" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.base) + '" aria-label="Size in base units">');
    h += field("Funds start on", '<select id="chFrom" class="dl-inp" aria-label="Source chain">' + opts(chainOpts(), t.from) + '</select>');
    h += field("Blob market", '<select id="chBlob" class="dl-inp" aria-label="Blob market level">' + opts([["floor", "floor (excess 0)"], ["busy", "busy (excess 5.0e7)"], ["spike", "spike (excess 8.5e7)"]], t.blobLevel) + '</select>');
    h += field("Tolerance", '<select id="chTol" class="dl-inp" aria-label="Slippage tolerance">' + opts([[0.1, "0.1%"], [0.5, "0.5%"], [1, "1%"], [2, "2%"], [5, "5%"]], t.tolerancePct) + '</select>');
    h += '</div><div class="ch-actions"><button class="go" id="chGo">Quote it on every chain</button></div>';
    return h;
  }

  function signalStrip(cmp) {
    var s = cmp && cmp.signals;
    if (!s) return "";
    return '<div class="ch-sig">L1 base fee <b>' + (s.l1Gwei != null ? s.l1Gwei.toFixed(2) : "—") + ' gwei</b> (' + esc(s.l1Src) + ', ' + esc(s.congestion) + ') · blob base fee <b>' + wei(s.blobWei) + ' wei</b> (computed from excess blob gas ' + SIG.excessBlobGas + ' through EIP-4844 fake_exponential, level "' + esc(s.blobLevel) + '") · ETH ' + usd(s.ethUSD) + ' · SOL ' + usd(s.solUSD) + '. L2 base fees are per-chain modelling constants, named in each row.</div>';
  }

  function trustCell(tr) {
    if (!tr) return "—";
    return '<span class="ch-trust" data-t="' + esc(tr.key) + '">' + esc(tr.label) + '</span>';
  }

  /* ------------------------------------------------------------- Route */
  function paneRoute() {
    var cmp = currentCompare();
    if (!cmp || !cmp.rows.length) return ticketStrip() + '<div class="ch-empty">' + esc(cmp && cmp.note ? cmp.note : "Nothing to compare.") + '</div>';
    var h = ticketStrip();
    h += '<div class="ch-head"><span class="ch-pair">' + esc(cmp.side.toUpperCase()) + ' ' + fmtNum(cmp.base) + ' ' + esc(cmp.sym) + ' / ' + esc(cmp.quote) + '</span><span class="ch-mid">mid ' + fmtQuote(cmp.mid, cmp.quote) + ' · notional ' + usd(cmp.notionalUSD) + ' · funds start on ' + esc((chainById(cmp.from) || {}).name || cmp.from) + '</span></div>';
    h += signalStrip(cmp);
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr>' +
      '<th>Chain</th><th>Pool</th><th class="r">Impact</th><th class="r">Swap fee</th><th class="r">Gas</th><th class="r">Bridge</th><th class="r">All-in / unit</th><th class="r">vs mid</th><th class="r">Time</th><th>Trust</th><th class="r">Rank</th>' +
      '</tr></thead><tbody>';
    var i, r;
    for (i = 0; i < cmp.rows.length; i++) {
      r = cmp.rows[i];
      h += '<tr data-kind="' + esc(r.kind) + '"' + (r.rank === 1 ? ' data-best="1"' : "") + (r.blocked ? ' data-blocked="1"' : "") + '>' +
        '<td class="ch-n">' + esc(r.name) + (r.blocked ? '<span class="ch-flag">would revert</span>' : "") + (r.exhausted ? '<span class="ch-flag">partial</span>' : "") + '</td>' +
        '<td class="ch-dex">' + esc(r.dex) + ' <span class="ch-tier">' + (r.feeRate * 100).toFixed(2) + '% · spacing ' + r.spacing + '</span></td>' +
        '<td class="r">' + (r.impactBps == null ? "—" : r.impactBps.toFixed(1) + " bp") + '<span class="ch-sub2">' + r.crossings + ' ticks crossed</span></td>' +
        '<td class="r">' + fmtQuote(r.swapFeeQuote, cmp.quote) + '</td>' +
        '<td class="r">' + usd(r.gasUSD) + (r.txCount > 1 ? '<span class="ch-sub2">' + r.txCount + ' tx</span>' : "") + '</td>' +
        '<td class="r">' + (r.chain === cmp.from ? '<span class="ch-none">none</span>' : usd(r.bridgeUSD)) + (r.bridge ? '<span class="ch-sub2">' + esc(r.bridge.name.split("(")[0].trim()) + '</span>' : "") + '</td>' +
        '<td class="r ch-all">' + fmtQuote(r.unitCost, cmp.quote) + '</td>' +
        '<td class="r">' + fmtBps(r.vsMidBps) + '</td>' +
        '<td class="r">' + fmtSec(r.etaSec) + '</td>' +
        '<td>' + trustCell(r.trust) + '</td>' +
        '<td class="r">' + (r.rank || "—") + '</td></tr>';
    }
    h += '</tbody></table></div>';

    h += '<div class="ch-legend">All-in per unit is the whole trip divided by what actually arrives: the multi-tick swap, its fee, the gas on the destination chain under that chain\'s own fee model, and the bridge fee to get the funds there. <b>Time and trust are printed beside the ranking and are never folded into it.</b> There is no honest weight between a seven-day withdrawal and a ninety-second one, and inventing one would hide the only decision on this table that is actually yours.</div>';

    /* the things that are not a number */
    var warn = "", j;
    for (i = 0; i < cmp.rows.length; i++) {
      r = cmp.rows[i];
      if (r.blocked && r.arrays) warn += '<li><b>' + esc(r.name) + '</b> — this order travels ' + Math.round(r.arrays.ticksTravelled) + ' ticks, which is ' + r.arrays.arraysNeeded + ' tick arrays, and a Whirlpool swap instruction can reference ' + r.arrays.arraysAvailable + '. ' + esc(r.arrays.remedy) + '</li>';
      if (r.exhausted) warn += '<li><b>' + esc(r.name) + '</b> — the modelled ladder ran out ' + fmtNum(r.unfilledIn) + ' ' + esc(cmp.side === "sell" ? cmp.sym : cmp.quote) + ' short. The shortfall is named rather than quietly dropped.</li>';
      if (r.unbridgedUSD > 0) warn += '<li><b>' + esc(r.name) + '</b> — the fast bridge could only front ' + usd(r.bridge.capacityUSD) + ' of ' + usd(cmp.notionalUSD) + '. ' + usd(r.unbridgedUSD) + ' has to wait for the canonical route, which is the row above it in time and below it in cost.</li>';
    }
    if (warn) h += '<div class="ch-sub">What would actually go wrong</div><ul class="ch-warnlist">' + warn + '</ul>';
    h += assumptionStrip();
    return h;
  }

  /* ------------------------------------------------------------ Chains */
  function paneChains() {
    var cmp = currentCompare();
    if (!cmp || !cmp.rows.length) return '<div class="ch-empty">' + esc((cmp && cmp.note) || "Nothing to price.") + '</div>';
    var h = '<div class="ch-note">One swap, the fee split into the components that actually produce it. Every line is computed from the chain\'s published formula — nothing here is a round number someone typed in.</div>';
    h += signalStrip(cmp);
    var i, j, r, m;

    for (i = 0; i < cmp.rows.length; i++) {
      r = cmp.rows[i];
      m = r.gas && r.gas.model;
      if (!m) continue;
      h += '<div class="ch-card"><div class="ch-cardh"><b>' + esc(r.name) + '</b><span>' + esc(kindLabel(r.kind)) + ' · ' + usd(r.gasUSD) + ' for this swap</span></div>';
      h += '<div class="ch-src">' + esc(r.gas.srcLabel || "") + '</div>';
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Component</th><th class="r">' + (r.kind === "svm" ? "lamports" : "wei") + '</th><th class="r">share</th><th>how it is computed</th></tr></thead><tbody>';
      var tot = r.kind === "svm" ? m.totalLamports : m.totalWei;
      for (j = 0; j < m.parts.length; j++) {
        var pr = m.parts[j];
        h += '<tr><td>' + esc(pr[0]) + '</td><td class="r">' + (r.kind === "svm" ? Math.round(pr[1]) : fmtWeiCell(pr[1])) + '</td><td class="r">' + (tot > 0 ? (pr[1] / tot * 100).toFixed(1) + "%" : "—") + '</td><td class="ch-how">' + esc(pr[2]) + '</td></tr>';
      }
      h += '<tr class="ch-tot"><td><b>Total</b></td><td class="r"><b>' + (r.kind === "svm" ? Math.round(tot) + " lamports" : fmtWeiCell(tot)) + '</b></td><td class="r">100%</td><td class="ch-how">' + (r.kind === "svm" ? esc(Math.round(tot) / SOL_LAMPORTS + " SOL at " + usd(SIG.solUSD)) : esc(fmtEth(tot) + " at " + usd(SIG.ethUSD) + "/ETH")) + '</td></tr>';
      h += '</tbody></table></div>';

      if (r.kind === "opstack") {
        h += '<div class="ch-branch"><b>The blob-versus-calldata branch.</b> Both scalar terms are in the Ecotone formula at once and the batcher\'s choice shows up as which one dominates. Right now the <b>' + esc(m.posting) + '</b> term is larger. The two are equal when the blob base fee reaches <b>' + wei(m.crossoverBlobBaseFeeWei) + ' wei</b> (' + (m.crossoverBlobBaseFeeWei / 1e9).toFixed(6) + ' gwei) — that is 16 x baseFeeScalar x l1BaseFee / blobBaseFeeScalar, and it is how far the blob market has to move before calldata is worth posting again. The L1 data side is ' + (m.l1SharePct == null ? "—" : m.l1SharePct.toFixed(1) + "%") + ' of this transaction\'s fee.</div>';
      }
      if (r.kind === "nitro") {
        h += '<div class="ch-branch"><b>The identity Nitro hides.</b> The receipt shows <b>' + fmtNum(m.totalGas) + ' gas</b>, of which only ' + fmtNum(m.l2ComputeGas) + ' is compute — the other ' + fmtNum(m.posterGas) + ' is the batch poster\'s L1 outlay converted back into L2 gas units at ' + (m.posting === "blob" ? "blob" : "calldata") + ' prices. ' + m.compressedBytes.toFixed(0) + ' compressed bytes out of ' + m.rawBytes + ' raw, at the modelled Brotli ratio ' + m.compression + '. total gas x L2 price = ' + fmtEth(m.totalWei) + ', and L2 compute plus the poster\'s outlay = ' + fmtEth(m.l2FeeWei + m.l1FeeWei) + ' — the two agree to ' + m.identityResidual.toExponential(1) + ' wei, which is float noise and not a fudge.</div>';
      }
      if (r.kind === "validity") {
        var curve = validityCurve({ l2Gas: unitsSwap(), l2GasPriceWei: (chainById(r.chain) || {}).l2BaseFeeGwei * 1e9, l1BaseFeeWei: SIG.l1Gwei * 1e9, blobBaseFeeWei: SIG.blobWei }, null);
        h += '<div class="ch-branch"><b>The proof does not care how many of you there are.</b> A verifier call is ' + ZK_PROOF_VERIFY_GAS + ' gas whether it attests to one transaction or a hundred thousand, so cost per transaction falls as 1/batchSize toward an asymptote of L2 execution plus your own state diff.</div>';
        h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">batch size</th><th class="r">cost per tx</th><th class="r">vs asymptote</th><th>bar</th></tr></thead><tbody>';
        var maxW = curve.length ? curve[0].totalWei : 1;
        for (j = 0; j < curve.length; j++) {
          var cv = curve[j];
          var pctw = maxW > 0 ? Math.max(0.6, cv.totalWei / maxW * 100) : 0;
          h += '<tr><td class="r">' + cv.batchSize + '</td><td class="r">' + usd(cv.totalWei / 1e18 * (SIG.ethUSD || 0)) + '</td><td class="r">' + (cv.asymptoteWei > 0 ? (cv.totalWei / cv.asymptoteWei).toFixed(2) + "x" : "—") + '</td><td><span class="ch-bar" data-w="' + Math.round(pctw) + '"></span></td></tr>';
        }
        h += '</tbody></table></div>';
      }
      if (r.kind === "svm" && r.arrays) {
        h += '<div class="ch-branch"><b>No gas auction, and a hard wall instead.</b> ' + esc(m.noAuction) + ' The wall is the tick arrays: ' + r.arrays.ticksPerArray + ' ticks each, ' + r.arrays.arraysPerSwap + ' per swap instruction, so one transaction can travel ' + r.arrays.maxTicksPerSwap + ' ticks at spacing ' + r.arrays.spacing + ' — a price move of ' + r.arrays.maxMovePct.toFixed(2) + '%. This order travels ' + Math.round(r.arrays.ticksTravelled) + ' ticks and needs ' + r.arrays.arraysNeeded + ' array' + (r.arrays.arraysNeeded === 1 ? "" : "s") + ', so it ' + (r.arrays.fits ? "fits in one transaction." : "DOES NOT FIT. " + esc(r.arrays.remedy)) + ' Where the wall actually bites is the TIGHT tiers, and the same order is fine on one and impossible on another purely because of the spacing:</div>';
        h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">tick spacing</th><th>typical Whirlpool tier</th><th class="r">ticks in 3 arrays</th><th class="r">biggest move in one tx</th><th class="r">this order needs</th><th>verdict</th></tr></thead><tbody>';
        var spacings = [[1, "stablecoin pair"], [8, "correlated pair"], [64, "volatile pair"], [128, "long-tail pair"]];
        for (j = 0; j < spacings.length; j++) {
          var ta = solanaTickArrays(spacings[j][0], r.arrays.ticksTravelled);
          if (!ta) continue;
          h += '<tr' + (ta.fits ? "" : ' data-blocked="1"') + '><td class="r">' + ta.spacing + '</td><td>' + esc(spacings[j][1]) + '</td><td class="r">' + ta.maxTicksPerSwap + '</td><td class="r">' + ta.maxMovePct.toFixed(2) + '%</td><td class="r">' + ta.arraysNeeded + '</td><td>' + (ta.fits ? "fits" : "reverts — " + esc(ta.remedy)) + '</td></tr>';
        }
        h += '</tbody></table></div>';
        h += '<div class="ch-branch">Read the first row: on a 1-spacing stable pool a swap cannot move the price more than ' + solanaTickArrays(1, 0).maxMovePct.toFixed(2) + '% in a single transaction, whatever it is willing to pay. That is not a fee, it is a ceiling, and it is the single most important difference between executing size here and executing it on an EVM chain — where the same order is merely expensive.</div>';
      }
      h += '</div>';
    }
    h += assumptionStrip();
    return h;
  }
  function kindLabel(k) {
    return k === "l1" ? "Ethereum L1" : k === "opstack" ? "OP stack, post-Ecotone" : k === "nitro" ? "Arbitrum Nitro" :
      k === "validity" ? "validity rollup" : k === "svm" ? "Solana, lamports and compute units" : k;
  }
  function fmtWeiCell(w) {
    if (w == null || !isFinite(w)) return "—";
    if (w === 0) return "0";
    if (w >= 1e12) return (w / 1e18).toFixed(9);
    return w.toExponential(3);
  }

  /* ----------------------------------------------------------- Bridges */
  function paneBridges() {
    var t = ticket();
    var cmp = currentCompare();
    var dest = t.dest || "arbitrum";
    var ch = chainById(dest) || CHAINS[1];
    var row = null, i, j;
    for (i = 0; i < ((cmp && cmp.rows) || []).length; i++) if (cmp.rows[i].chain === dest) row = cmp.rows[i];
    var h = '<div class="ch-note">The mechanisms that exist for this pair, priced separately, with the trust statement beside each one and the four failure modes underneath. A bridge quoted only on its happy path is quoted wrong.</div>';
    h += '<div class="dl-2 ch-form">' + field("Destination", '<select id="chDest" class="dl-inp" aria-label="Destination chain">' + opts(chainOpts(), dest) + '</select>') + '</div>';
    if (!row || !row.bridgeRoutes) {
      return h + '<div class="ch-empty">' + esc(dest === (cmp && cmp.from) ? "The funds already start on " + ch.name + " — there is nothing to bridge. Pick another destination, or change where the funds start on the Route tab." : "Nothing to price for " + ch.name + " this session.") + '</div>';
    }
    h += '<div class="ch-head"><span class="ch-pair">' + usd(cmp.notionalUSD) + ' to ' + esc(ch.name) + '</span><span class="ch-mid">from ' + esc((chainById(cmp.from) || {}).name || cmp.from) + ' · destination LP inventory ' + usd(LIQ_INVENTORY_USD[dest] || 5e5) + ' (modelled) at ' + (LIQ_START_UTIL * 100).toFixed(0) + '% utilisation (modelled)</span></div>';

    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Route</th><th class="r">Fee</th><th class="r">Carries</th><th class="r">Time</th><th>Trust — what must be honest</th></tr></thead><tbody>';
    for (i = 0; i < row.bridgeRoutes.length; i++) {
      var b = row.bridgeRoutes[i];
      h += '<tr' + (row.bridge && b.id === row.bridge.id ? ' data-best="1"' : "") + '>' +
        '<td class="ch-n">' + esc(b.name) + '<span class="ch-sub2">' + esc(b.dir) + '</span></td>' +
        '<td class="r">' + usd(b.feeUSD) + '</td>' +
        '<td class="r">' + usd(b.filledUSD) + (b.partial ? '<span class="ch-flag">partial</span>' : "") + '</td>' +
        '<td class="r">' + fmtSec(b.etaSec) + '<span class="ch-sub2">' + esc(b.etaNote) + '</span></td>' +
        '<td>' + trustCell(b.trust) + '<span class="ch-sub2">' + esc(b.trust.one) + (b.honestSet ? " " + esc(b.honestSet) + "." : "") + '</span></td></tr>';
    }
    h += '</tbody></table></div>';
    if (row.bridgeRoutes.length && row.bridgeRoutes[0].hasCanonical === false) {
      h += '<div class="ch-warn">There is no canonical bridge on this pair, so the two canonical rows are absent rather than approximated. A canonical bridge only exists between a rollup and the chain it settles to: each verifies the other because one is derived from the other. Ethereum and Solana do not verify each other at all, so every route between them is somebody\'s promise — an m-of-n validator set, an LP fronting inventory, or a counterparty behind a timelock. That is the honest statement, and it is the reason the trust column exists.</div>';
    }

    /* the fee parts of each route, computed rather than asserted */
    h += '<div class="ch-sub">Where each fee comes from</div>';
    for (i = 0; i < row.bridgeRoutes.length; i++) {
      var br = row.bridgeRoutes[i];
      h += '<div class="ch-card"><div class="ch-cardh"><b>' + esc(br.name) + '</b><span>' + usd(br.feeUSD) + '</span></div>';
      h += '<div class="ch-src">' + esc(br.mechanism) + '</div>';
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Part</th><th class="r">USD</th><th>how</th></tr></thead><tbody>';
      for (j = 0; j < br.feeParts.length; j++) {
        h += '<tr><td>' + esc(br.feeParts[j][0]) + '</td><td class="r">' + usd(br.feeParts[j][1]) + '</td><td class="ch-how">' + esc(br.feeParts[j][2]) + '</td></tr>';
      }
      h += '</tbody></table></div>';
      if (br.liq && br.liq.partial) {
        h += '<div class="ch-warn">Capacity limit reached. Inventory ' + usd(br.liq.inventoryUSD) + ' at ' + (br.liq.utilisationBefore * 100).toFixed(0) + '% used leaves ' + usd(br.liq.capacityUSD) + ' free, so ' + usd(br.liq.filledUSD) + ' fills and ' + usd(br.liq.unfilledUSD) + ' does not. ' + esc(br.liq.note) + '</div>';
      }
      h += '</div>';
    }

    /* the failure modes */
    var fails = row.bridge ? row.bridge.failures : row.bridgeRoutes[0].failures;
    h += '<div class="ch-sub">What goes wrong, and what it costs — for ' + esc((row.bridge || row.bridgeRoutes[0]).name) + '</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Failure</th><th class="r">Odds</th><th class="r">Expected cost</th><th>Arithmetic</th><th>Remedy</th></tr></thead><tbody>';
    for (i = 0; i < fails.length; i++) {
      var fm = fails[i];
      h += '<tr><td class="ch-n">' + esc(fm.label) + '<span class="ch-sub2">' + esc(fm.what) + '</span></td>' +
        '<td class="r">' + (fm.probability == null ? "—" : (fm.probability * 100).toFixed(2) + "%") + '</td>' +
        '<td class="r">' + (fm.expectedCostUSD == null ? (fm.remedyCostUSD == null ? "—" : usd(fm.remedyCostUSD)) : usd(fm.expectedCostUSD)) + '</td>' +
        '<td class="ch-how">' + esc(fm.arithmetic) + '</td>' +
        '<td class="ch-how">' + esc(fm.remedy) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="ch-legend">The trust column is a <b>risk statement, not a rating</b>. There is no ordering in it: a natively verified route can still be slow enough to be the wrong answer, and an m-of-n route can be the right one for a size where a week of challenge window costs more than the counterparty risk. What the column gives you is the sentence you would have to be comfortable saying out loud before you send.</div>';
    h += assumptionStrip();
    return h;
  }

  /* ------------------------------------------------------------- Ticks */
  function paneTicks() {
    var t = ticket();
    var cmp = currentCompare();
    var cid = t.chain || "ethereum";
    var row = null, i;
    for (i = 0; i < ((cmp && cmp.rows) || []).length; i++) if (cmp.rows[i].chain === cid) row = cmp.rows[i];
    var h = '<div class="ch-note">The tick liquidity distribution below is <b>modelled</b>. The arithmetic over it is <b>exact</b>: every sqrt price, every amount, every crossing and every fee-growth figure follows from the published formulas with no fudge factor. This is the part of the build that 53-sor.js says it does not have.</div>';
    h += '<div class="dl-2 ch-form">' + field("Chain", '<select id="chChain" class="dl-inp" aria-label="Chain for the tick walk">' + opts(chainOpts(), cid) + '</select>') + '</div>';
    if (!row) return h + '<div class="ch-empty">Nothing to walk for that chain this session.</div>';
    var pool = row.pool, w = row.walk;

    h += '<div class="ch-head"><span class="ch-pair">' + esc(row.name) + ' · ' + esc(row.dex) + '</span><span class="ch-mid">' + (pool.fee * 100).toFixed(2) + '% tier · tick spacing ' + pool.spacing + ' · ' + pool.slots.length + ' liquidity slots of ' + pool.slotTicks + ' ticks</span></div>';

    h += '<div class="dl-tblw"><table class="dl-tbl ch-state"><tbody>' +
      '<tr><td>price</td><td class="r">' + fmtQuote(pool.price, cmp.quote) + '</td><td>sqrtPrice</td><td class="r">' + pool.sqrtP.toFixed(8) + '</td></tr>' +
      '<tr><td>tick</td><td class="r">' + pool.tick + '</td><td>sqrtPriceX96</td><td class="r">' + pool.sqrtPriceX96.toExponential(6) + '</td></tr>' +
      '<tr><td>active liquidity L</td><td class="r">' + fmtNum(pool.L) + '</td><td>value in the ladder</td><td class="r">' + fmtQuote(pool.tvlQuote, cmp.quote) + '</td></tr>' +
      '<tr><td>tick 1.0001^tick check</td><td class="r">' + tickToPrice(pool.tick).toFixed(4) + '</td><td>ladder seed (FNV)</td><td class="r ch-seed">' + esc(pool.seed) + '</td></tr>' +
      '</tbody></table></div>';

    h += '<div class="ch-sub">The walk — ' + w.crossings + ' tick crossing' + (w.crossings === 1 ? "" : "s") + ', ' + w.steps.length + ' step' + (w.steps.length === 1 ? "" : "s") + '</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">#</th><th class="r">tick</th><th class="r">price from</th><th class="r">price to</th><th class="r">L in this step</th><th class="r">in</th><th class="r">out</th><th class="r">fee</th><th class="r">L after</th><th class="r">fee growth</th></tr></thead><tbody>';
    var shown = Math.min(w.steps.length, 60);
    for (i = 0; i < shown; i++) {
      var s = w.steps[i];
      h += '<tr' + (s.crossed ? ' data-cross="1"' : "") + '><td class="r">' + (i + 1) + '</td><td class="r">' + s.tickTarget + (s.crossed ? ' <span class="ch-x">crossed</span>' : "") + '</td>' +
        '<td class="r">' + fmtNum(s.priceFrom) + '</td><td class="r">' + fmtNum(s.priceTo) + '</td>' +
        '<td class="r">' + fmtNum(s.L) + '</td><td class="r">' + fmtNum(s.amountIn) + '</td><td class="r">' + fmtNum(s.amountOut) + '</td>' +
        '<td class="r">' + fmtNum(s.feeAmount) + '</td><td class="r">' + fmtNum(s.LAfter) + '</td>' +
        '<td class="r">' + s.feeGrowthGlobal.toExponential(3) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    if (w.steps.length > shown) h += '<div class="ch-sub2b">' + (w.steps.length - shown) + ' further steps are not printed; the totals below are over all of them.</div>';

    h += '<div class="dl-tblw"><table class="dl-tbl ch-state"><tbody>' +
      '<tr><td>input offered</td><td class="r">' + fmtNum(w.amountIn) + '</td><td>input consumed</td><td class="r">' + fmtNum(w.amountInUsed) + '</td></tr>' +
      '<tr><td>of which fee</td><td class="r">' + fmtNum(w.feePaid) + '</td><td>net into the curve</td><td class="r">' + fmtNum(w.amountInNet) + '</td></tr>' +
      '<tr><td>output</td><td class="r">' + fmtNum(w.amountOut) + '</td><td>unfilled</td><td class="r">' + (w.amountInUnfilled > 0 ? fmtNum(w.amountInUnfilled) : "none") + '</td></tr>' +
      '<tr><td>price moved</td><td class="r">' + fmtNum(w.priceStart) + ' to ' + fmtNum(w.priceEnd) + '</td><td>tick moved</td><td class="r">' + w.tickStart + ' to ' + w.tickEnd + '</td></tr>' +
      '<tr><td>L start / end</td><td class="r">' + fmtNum(w.LStart) + ' / ' + fmtNum(w.LEnd) + '</td><td>impact, fee excluded</td><td class="r">' + (w.impactBps == null ? "—" : w.impactBps.toFixed(1) + " bp") + '</td></tr>' +
      '<tr><td>fee growth global</td><td class="r">' + w.feeGrowthGlobal.toExponential(4) + '</td><td>per unit of liquidity</td><td class="r">sum of feeAmount / L per step</td></tr>' +
      '</tbody></table></div>';

    /* fee growth inside a range, the three-term identity */
    var lo = alignTick(pool.tick, pool.slotTicks) - pool.slotTicks * 4;
    var hi = lo + pool.slotTicks * 8;
    var inside = feeGrowthInside(lo, hi, w.tickEnd, w.feeGrowthGlobal, 0, w.feeGrowthGlobal);
    h += '<div class="ch-branch"><b>Fee growth inside a range.</b> Fees are not held by the pool, they are owed to whichever positions were in range when they were earned, so the pool tracks growth <i>per unit of liquidity</i> and each initialised tick stores feeGrowthOutside, flipping it to global minus itself on every crossing. For a position over ticks ' + lo + ' to ' + hi + ' after this walk, feeGrowthInside = global ' + w.feeGrowthGlobal.toExponential(4) + ' minus the part below minus the part above = ' + inside.toExponential(4) + '. That is the three-term identity from Uniswap v3 core, Tick.sol — and it is why a concentrated position earns more per dollar exactly where it also carries more inventory risk.</div>';

    if (row.arrays) {
      h += '<div class="ch-branch"><b>Solana tick arrays.</b> ' + esc(row.arrays.remedy) + ' This order travels ' + Math.round(row.arrays.ticksTravelled) + ' ticks = ' + row.arrays.spacingsTravelled.toFixed(1) + ' spacings = ' + row.arrays.arraysNeeded + ' array' + (row.arrays.arraysNeeded === 1 ? "" : "s") + ', against a ceiling of ' + row.arrays.arraysPerSwap + ' (' + row.arrays.maxTicksPerSwap + ' ticks, a ' + row.arrays.maxMovePct.toFixed(2) + '% move) per swap instruction.</div>';
    }

    var fk = forkPool();
    h += '<div class="ch-fork">' + (fk
      ? "Your fork node is connected. Its pool is the one row on this desk with a real price and real in-range liquidity: " + esc(fk.name) + ", fee " + (fk.feeRate * 100).toFixed(2) + "%. Everything above it on this tab is the modelled ladder."
      : "No fork node connected, so every tick on this tab is modelled. Point the Fork Sandbox at an anvil or Hardhat node and its pool joins this tab as the only row backed by an actual chain.") + '</div>';
    h += assumptionStrip();
    return h;
  }

  /* ------------------------------------------------------------ Method */
  function paneMethod() {
    var h = '<div class="ch-note">Everything this desk does, in plain language. If a number anywhere on it cannot be traced to one of these paragraphs, it should not be on the screen.</div>';
    var i;
    h += '<div class="ch-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="ch-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += '<div class="ch-sub">What is assumed, and what is measured</div><ul class="ch-assume">';
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    h += '<div class="ch-sub">Sources</div><ul class="ch-assume">' +
      '<li>Uniswap v3 whitepaper, equations 6.29 and 6.30 (amounts from liquidity), and v3-core TickMath / SwapMath / Tick.sol for the tick space, computeSwapStep and the fee-growth identity.</li>' +
      '<li>The worked liquidity example — price 5000, range 4545 to 5500, L = 1519.437308 from the base side and 1517.882344 from the quote side — is from the Uniswap v3 development book, and the gate re-derives both independently.</li>' +
      '<li>EIP-4844 for fake_exponential, MIN_BASE_FEE_PER_BLOB_GAS = 1 wei, the Cancun update fraction 3338477 and 131072 blob gas per blob.</li>' +
      '<li>The OP-stack Ecotone L1 cost formula, and Arbitrum Nitro\'s poster-gas accounting through ArbGasInfo.</li>' +
      '<li>Orca Whirlpool\'s tick-array layout: 88 ticks per array, at most 3 arrays per swap instruction.</li>' +
      '<li>The trust taxonomy — natively / externally / optimistically / locally verified — is the interoperability-trilemma one, from Connext\'s Arjun Bhuptani.</li>' +
      '<li>Abramowitz and Stegun 7.1.26 for the error function used in the slippage-breach probability.</li>' +
      '</ul>';
    return h;
  }

  function assumptionStrip() {
    return '<div class="ch-strip">The tick liquidity distribution is modelled; the arithmetic over it is exact. Gas, blob and priority prices are the app\'s own signals and are named per row. No bridge and no L2 is queried live in this build. The only real-chain row is the fork node when connected. Full detail on the Method tab.</div>';
  }

  /* ==================================================================
     9 · WIRING
     ================================================================== */

  function bodyFor(tab, body) {
    var h;
    if (tab === "chains") h = paneChains();
    else if (tab === "bridges") h = paneBridges();
    else if (tab === "ticks") h = paneTicks();
    else if (tab === "method") h = paneMethod();
    else h = paneRoute();
    /* onTab's return value is IGNORED — the body must be assigned here.
       (53-sor.js shipped the bug where it was not; do not repeat it.) */
    if (body) body.innerHTML = h;
    return h;
  }

  function readTicket() {
    var t = {}, el;
    el = document.getElementById("chSym"); if (el) t.sym = String(el.value || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
    el = document.getElementById("chSide"); if (el) t.side = el.value === "sell" ? "sell" : "buy";
    el = document.getElementById("chBase"); if (el) t.base = +el.value || 0;
    el = document.getElementById("chFrom"); if (el) t.from = el.value;
    el = document.getElementById("chBlob"); if (el) t.blobLevel = el.value;
    el = document.getElementById("chTol"); if (el) t.tolerancePct = +el.value || 0.5;
    return t;
  }

  function onClick(ev) {
    var tgt = ev.target;
    if (!tgt || tgt.id !== "chGo") return;
    ticket(readTicket());
    refreshSignals(ticket().blobLevel);
    open("route");
  }
  function onChange(ev) {
    var tgt = ev.target;
    if (!tgt || !tgt.id) return;
    if (tgt.id === "chDest") { ticket({ dest: tgt.value }); open("bridges"); return; }
    if (tgt.id === "chChain") { ticket({ chain: tgt.value }); open("ticks"); return; }
  }

  var wired = false, wiredEl = null;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    wired = true; wiredEl = el;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); el.removeEventListener("change", onChange); } catch (e) {}
      wired = false; wiredEl = null;
    };
  }

  function open(tab) {
    refreshSignals(ticket().blobLevel);
    var el = null;
    try {
      el = C.open("dlChain", {
        title: "⛓ Cross-chain",
        sub: "The same trade on six chains — real tick math, the fee split that produces it, and who has to be honest for it to arrive",
        tabs: [["route", "Route"], ["chains", "Chains"], ["bridges", "Bridges"], ["ticks", "Ticks"], ["method", "Method"]],
        onTab: bodyFor
      }, tab || "route");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlChain")); } catch (e) {}
    return el;
  }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("chains", "⛓", "Cross-chain", "Real concentrated-liquidity tick math, L2 fee anatomy, and bridges priced with their failure modes", function () { open("route"); }); } catch (e) {}
  try { C.cmd && C.cmd("Cross-chain", "Cross-chain — tick math, L2 fees and bridges", "⛓", function () { open("route"); }); } catch (e) {}

  window.DLCHAIN = {
    __v: 166,
    open: open,
    /* tick math */
    tickToSqrtPrice: tickToSqrtPrice, sqrtPriceToTick: sqrtPriceToTick,
    tickToPrice: tickToPrice, priceToTick: priceToTick,
    sqrtPriceX96: sqrtPriceX96, x96ToSqrtPrice: x96ToSqrtPrice,
    tickSpacing: tickSpacing, alignTick: alignTick, TICK_SPACING: TICK_SPACING,
    amount0For: amount0For, amount1For: amount1For,
    liquidityFromAmount0: liquidityFromAmount0, liquidityFromAmount1: liquidityFromAmount1,
    liquidityFromAmounts: liquidityFromAmounts,
    nextSqrtFromAmount0In: nextSqrtFromAmount0In, nextSqrtFromAmount1In: nextSqrtFromAmount1In,
    swapStep: swapStep, feeGrowthInside: feeGrowthInside,
    buildTicks: buildTicks, swapWalk: swapWalk, ticksFor: ticksFor,
    /* fee models */
    fakeExponential: fakeExponential, blobBaseFeeWei: blobBaseFeeWei, calldataGas: calldataGas,
    opStackFee: opStackFee, arbitrumFee: arbitrumFee,
    validityFee: validityFee, validityCurve: validityCurve,
    solanaFee: solanaFee, solanaTickArrays: solanaTickArrays, solanaComputeUnits: solanaComputeUnits,
    /* bridges */
    bridgeLiquidity: bridgeLiquidity, bridgeRoutes: bridgeRoutes, failureModes: failureModes,
    normalCdf: normalCdf, TRUST: TRUST,
    /* the comparison */
    compare: compare, CHAINS: CHAINS, chainById: chainById,
    signals: refreshSignals, ticket: ticket, hash32: hash32,
    METHOD: METHOD, ASSUMPTIONS: ASSUMPTIONS
  };
})();
