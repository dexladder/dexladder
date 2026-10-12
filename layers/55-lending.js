// owns: paper lending and liquidation cascade models
// reads: DLAPP, DLCORE, DLDESKS, browser DOM
// emits: DLLEND
/* ============================================================================
   DexLadder — DLLEND · layer 55 · v166 "the ladder under the ladder"
   LENDING, LIQUIDATION CASCADES AND RESTAKING

   The question this desk exists to answer: at what price does this position
   get taken, who takes it, what do they make, and what does their selling do
   to the price of everyone else's collateral.

   Aave v3 is the reference implementation and the arithmetic here is the
   protocol's, not a sketch of it: the two-slope interest rate strategy, the
   LINEAR liquidity index and the COMPOUNDED variable borrow index in the exact
   three-term binomial form the contract ships (which is why it undercharges),
   the health factor built on the liquidation THRESHOLD rather than the LTV,
   the close factor with its 100% branch, the liquidation bonus with the
   protocol's cut of that bonus, and the four mechanics that quietly change the
   answer — e-mode, isolation mode, siloed borrowing and the caps.

   The cascade is the part no calculator does. A liquidated position is not a
   number that disappears: its collateral is SOLD, and it is sold into this
   app own pool curve (DLAPP.paper poolFromTVL / quoteImpact), so the sale
   moves the price, and the new price takes the next tier. The desk separates
   the exogenous move from the reflexive one, and names the step at which it
   stops.

   Restaking is EigenLayer arithmetic: one stake, one operator, N services.
   The reward side is a split (AVS fee to operator commission to staker) and
   stacks on the LST base yield. The risk side is the one everybody gets wrong:
   slashing across AVSs served by ONE operator is not independent, because one
   operator fault is one event. Correlation is an explicit parameter, the loss
   distribution is computed exactly by conditioning on a common factor, and the
   desk prints the break-even slashing probability at which the extra yield is
   gone.

   LAWS OBSERVED
     · every model function is PURE — prices, amounts and parameters go in,
       numbers come out. No clock, no balance write, no persisted state inside
       the arithmetic
     · deterministic — not one random draw anywhere in this layer. The loss
       distribution is a quadrature, not a simulation, so two opens agree
     · a missing figure stays missing — null, never 0 wearing a price clothes
     · money moves only through the engine. This layer DOES trade: taking a
       liquidation on paper is two execFill calls (buy the collateral at the
       discount, sell it into the pool) plus chargeNetwork for the gas. It
       never assigns to a balance
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · nothing is compiled at runtime, no timers, no observers
     · Day + Night — every rule lives in _v166css/55-lending.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLLEND && window.DLLEND.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  /* -------------------------------------------------------------- the engine */
  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function LP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.paper; } catch (e) { return null; } }

  /* --------------------------------------------------------------- constants */

  /* Aave uses 365 days. Every rate on this desk is per-second times this. */
  var SECONDS_PER_YEAR = 31536000;

  /* LiquidationLogic.sol, Aave v3.1 */
  var DEFAULT_CLOSE_FACTOR = 0.5;
  var MAX_CLOSE_FACTOR = 1;
  var CLOSE_FACTOR_HF_THRESHOLD = 0.95;
  var MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD = 2000;   /* USD */
  var MIN_LEFTOVER_BASE = 1000;                     /* USD — half the above */
  var HEALTH_FACTOR_LIQUIDATION_THRESHOLD = 1;

  /* A liquidationCall plus the swap back is roughly three plain swaps of gas.
     This multiple is an ASSUMPTION and the desk says so where it is charged. */
  var LIQ_GAS_MULTIPLE = 3;

  /* Published Aave v3 reserve configuration, hard-coded. There is no live
     protocol feed in this build. Governance moves these; the Method tab says
     so, and says which row is representative rather than pinned. */
  var SNAPSHOT = "Aave v3 Ethereum reserve configuration, 2025 snapshot";

  var RESERVES = {
    WETH:   { sym: "WETH",   label: window.DLI18N.t("55-lending.5359e9235cc4"),   ltv: 0.805, lt: 0.83, bonus: 0.050, rf: 0.15, uOpt: 0.90, base: 0, s1: 0.027, s2: 0.80, protFee: 0.10, supplyCap: 1800000, borrowCap: 1600000, silo: false, ceiling: 0, inIso: false, emode: "eth",    stable: false, pinned: true },
    wstETH: { sym: "wstETH", label: window.DLI18N.t("55-lending.8fd7b313f298"), ltv: 0.785, lt: 0.81, bonus: 0.060, rf: 0.15, uOpt: 0.45, base: 0, s1: 0.070, s2: 3.00, protFee: 0.10, supplyCap: 1200000, borrowCap: 6000,    silo: false, ceiling: 0, inIso: false, emode: "eth",    stable: false, pinned: true },
    WBTC:   { sym: "WBTC",   label: window.DLI18N.t("55-lending.42fa70333108"),   ltv: 0.730, lt: 0.78, bonus: 0.050, rf: 0.20, uOpt: 0.45, base: 0, s1: 0.070, s2: 3.00, protFee: 0.10, supplyCap: 43000,   borrowCap: 1600,    silo: false, ceiling: 0, inIso: false, emode: null,     stable: false, pinned: true },
    USDC:   { sym: "USDC",   label: window.DLI18N.t("55-lending.8591ee9090c0"),   ltv: 0.770, lt: 0.80, bonus: 0.045, rf: 0.10, uOpt: 0.90, base: 0, s1: 0.060, s2: 0.60, protFee: 0.10, supplyCap: 1.55e9,  borrowCap: 1.4e9,   silo: false, ceiling: 0, inIso: true,  emode: "stable", stable: true,  pinned: true },
    USDT:   { sym: "USDT",   label: window.DLI18N.t("55-lending.ca9006bd3fb0"),   ltv: 0.750, lt: 0.78, bonus: 0.045, rf: 0.10, uOpt: 0.90, base: 0, s1: 0.065, s2: 0.75, protFee: 0.10, supplyCap: 1.5e9,   borrowCap: 1.35e9,  silo: false, ceiling: 0, inIso: true,  emode: "stable", stable: true,  pinned: true },
    DAI:    { sym: "DAI",    label: window.DLI18N.t("55-lending.bbeab13af262"),    ltv: 0.750, lt: 0.78, bonus: 0.050, rf: 0.10, uOpt: 0.90, base: 0, s1: 0.065, s2: 0.75, protFee: 0.10, supplyCap: 3.4e8,   borrowCap: 3.2e8,   silo: false, ceiling: 0, inIso: true,  emode: "stable", stable: true,  pinned: true },
    LINK:   { sym: "LINK",   label: window.DLI18N.t("55-lending.e26ef19029cc"),   ltv: 0.700, lt: 0.75, bonus: 0.070, rf: 0.20, uOpt: 0.45, base: 0, s1: 0.070, s2: 3.00, protFee: 0.10, supplyCap: 1300000, borrowCap: 1100000, silo: true,  ceiling: 0, inIso: false, emode: null,     stable: false, pinned: false },
    RPL:    { sym: "RPL",    label: window.DLI18N.t("55-lending.b0167ad27880"),    ltv: 0.650, lt: 0.70, bonus: 0.075, rf: 0.20, uOpt: 0.45, base: 0, s1: 0.070, s2: 3.00, protFee: 0.10, supplyCap: 800000,  borrowCap: 0,       silo: false, ceiling: 3000000, inIso: false, emode: null, stable: false, pinned: false }
  };
  var RES_ORDER = ["WETH", "wstETH", "WBTC", "USDC", "USDT", "DAI", "LINK", "RPL"];

  /* Which rows carry something we assigned rather than read off a published
     config. Named here so the UI can flag the exact cell. */
  var REPRESENTATIVE = {
    LINK: "the siloed-borrowing flag is switched on here as the representative siloed listing. Aave v3 Ethereum does not silo LINK. The constraint it enforces is the protocol's; the assignment is ours.",
    RPL: "the isolation-mode row: the $3.0m debt ceiling and the risk parameters are representative of an Aave v3 isolated listing, not a pinned governance value."
  };

  /* E-mode categories. Both are published category definitions; the label
     names the deployment each was read from, because they differ. */
  var EMODES = {
    none:   { key: "none",   label: window.DLI18N.t("55-lending.b4dc66dde806"),                                                     ltv: null,  lt: null,  bonus: null, assets: null },
    eth:    { key: "eth",    label: window.DLI18N.t("55-lending.bd1128cd1dac"),           ltv: 0.93,  lt: 0.95,  bonus: 0.01, assets: ["WETH", "wstETH"] },
    stable: { key: "stable", label: window.DLI18N.t("55-lending.07905b74885d"),               ltv: 0.975, lt: 0.98,  bonus: 0.01, assets: ["USDC", "USDT", "DAI"] }
  };
  var EMODE_ORDER = ["none", "eth", "stable"];

  function res(k) { return RESERVES[k] || null; }

  /* ---------------------------------------------------------------- honesty */

  var ASSUMPTIONS = [
    "Reserve parameters are HARD-CODED published Aave v3 values — a " + SNAPSHOT + ": WETH 80.5% LTV / 83% liquidation threshold / 5% bonus / 15% reserve factor, two-slope strategy base 0%, optimal utilisation 90%, slope1 2.7%, slope2 80%. wstETH 78.5/81/6/15 at U_opt 45%, slope1 7%, slope2 300%. WBTC 73/78/5/20 at U_opt 45%. USDC 77/80/4.5/10 at U_opt 90%, slope1 6%, slope2 60%. USDT and DAI 75/78/4.5–5/10 at U_opt 90%. There is NO live protocol feed in this build: nothing here is read off the chain, and governance moves every one of these numbers. Re-check them against the risk parameters page before you act on a figure.",
    "Two rows are REPRESENTATIVE rather than pinned, and the table flags both. LINK carries the siloed-borrowing flag so the constraint can be demonstrated — Aave v3 Ethereum does not silo LINK. RPL carries a $3.0m isolation debt ceiling of our choosing. The mechanics those rows exercise are the protocol's; the assignment of them to those tickers is ours.",
    "The liquidation protocol fee is 10% OF THE BONUS, not of the collateral — that is the contract's arithmetic (bonusCollateral = C − C/liquidationBonus, then percentMul by the protocol fee). It is set here at 10% for every reserve, which is the mainnet value for most of them but not a per-reserve reading.",
    "The variable borrow index uses Aave's own THREE-TERM binomial approximation of e^x, not exact compounding, because that is what the contract ships (MathUtils.calculateCompoundedInterest). The Market tab prints the gap against exact e^x deliberately: the approximation is a truncated positive series, so the protocol always undercharges the borrower, by about 0.003 bp of the factor at a 5% rate over a year and about 29 bp at a 50% rate. That is a feature of the deployed code, reproduced, not a bug in this desk.",
    "The liquidation cascade sells seized collateral into THE APP'S OWN MODELLED POOL (DLAPP.paper poolFromTVL and quoteImpact), whose value is derived from 24h volume through the engine's DEX_TVL_PER_VOL constant, or from the pool size you type. It is NOT a measured order book and it is NOT on-chain depth: no venue publishes either to this app. Read the cascade's depth as a demonstration of reflexivity at a stated pool size, not as a claim about how far ETH would really fall.",
    "The cascade's price path is EXOGENOUS and deterministic — a straight-line drawdown over the number of steps you set. Real drawdowns are not straight lines, and there is no volatility, no gap, no oracle lag and no liquidation-bot competition in it. What the desk isolates is the part of the fall the cascade itself caused, given a path you chose.",
    "Liquidators here are assumed to be instant, fully funded and unopposed: the whole liquidatable amount is taken at each step, in worst-health-first order, and the swap back happens immediately at the pool's price. Real liquidations compete, fail, partially fill and pay priority fees. Gas is charged at three times the engine's swap gas (a liquidationCall plus the swap back), which is a stated multiple, not a measured trace.",
    "Restaking is EigenLayer's SHAPE, with your numbers: an AVS pays a fee expressed as an APR on restaked stake, the operator takes a commission of it, the remainder reaches the staker and stacks on the LST base yield. Fee rates, commissions, slash severities and slash probabilities are all INPUTS — nobody publishes a forward slashing probability, and any number that claims to is a guess with a decimal point on it.",
    "Correlated slashing is modelled with a ONE-FACTOR GAUSSIAN COPULA: each AVS slashing event fires when a latent variable crosses its threshold, and the latents share a common factor with correlation rho. That is a modelling choice, the standard one from credit portfolios, and it is the reason the joint tail is fatter than the product of the probabilities. The distribution is computed by exact enumeration of the 2^N outcome set inside a 321-point Gauss–Hermite-style quadrature over the common factor, so it is deterministic — the same inputs give the same tail every time. It is not a simulation and there is no seed.",
    "The desk models slashing as a loss of restaked principal only. It does not model the redemption queue, the 7-day withdrawal delay, the veto committee, an AVS that pays in its own token at a price that will not survive contact with a bid, or the LST's own secondary-market discount — the Liquidity Desk covers that last one.",
    "The account-level figures (health factor, max borrow, borrowing power) are computed the way GenericLogic.calculateUserAccountData computes them: value-weighted across collateral, thresholds not LTVs in the health factor, and a position in e-mode uses the category's parameters ONLY for assets in the category. Everything else keeps its own.",
    "The Liquidity Desk (45-defi) carries a one-line restaking sketch that sums APRs and adds a worst-case. This desk supersedes it for the reward split and for the correlated tail; where the two disagree, this one is the arithmetic."
  ];

  var METHOD = [
    ["Utilisation", "U = totalDebt / (availableLiquidity + totalDebt). Availability is what is left in the reserve to withdraw or borrow, so a reserve at U = 1 has nothing left and a withdrawal will not settle — which is the mechanism behind every lending-protocol bank run."],
    ["The rate curve", "Two slopes around an optimal utilisation. Below it the variable borrow rate is base + slope1 · U/U_opt; above it, base + slope1 + slope2 · (U − U_opt)/(1 − U_opt). Slope2 is enormous on purpose — WETH's is 80% and WBTC's is 300% — because the only tool the protocol has to pull utilisation back down is to make the marginal borrow unaffordable. The kink is where the curve stops being a rate and starts being a fire alarm."],
    ["The supply rate", "supplyRate = borrowRate · U · (1 − reserveFactor). Suppliers are paid out of what borrowers pay, scaled by the fraction of the pool actually lent, less the protocol's cut. This is why a supply APY is always far below the borrow APR it is quoted next to: at 90% utilisation and a 15% reserve factor the supplier keeps 76.5 cents of each borrowed dollar's interest, and at 45% utilisation, 38 cents."],
    ["Two indices, two kinds of interest", "Aave accrues the LIQUIDITY index linearly — index × (1 + rate · Δt / year) — and the variable BORROW index by compounding. Suppliers therefore do not earn interest on their interest between touches of the reserve; borrowers pay it. The asymmetry is deliberate and it is worth what it is worth: over a year at 5%, linear and compounded differ by 12.7 bp of the factor."],
    ["The binomial, and what it costs", "The compounded index is not e^x. MathUtils.calculateCompoundedInterest ships a three-term binomial expansion: 1 + x + x²/2·(1 − 1/n) + x³/6·(1 − 1/n)(1 − 2/n), with n the elapsed seconds and x the rate over the period. Truncating a positive series means the protocol charges LESS than exact compounding — 0.0026 bp of the factor at a 5% annual rate, 28.9 bp at 50%. On a billion dollars of variable debt at 5% that is about $263 a year the protocol does not collect. The desk prints both and the gap."],
    ["LTV is not the liquidation threshold", "They are two different numbers and confusing them is how people get liquidated. The LTV governs how much you may borrow — WETH 80.5%. The liquidation threshold governs when you are taken — WETH 83%. The 2.5-point gap between them is the whole of your buffer, and it is the reason a position opened at the maximum LTV is not one bad print from liquidation but very nearly is."],
    ["Health factor", "HF = Σ(collateral · price · liquidationThreshold) / Σ(debt · price). Below 1 the position is liquidatable. Note what is NOT in it: no time, no rate, no interest accrual — HF moves with price, and it moves down slowly with accrued debt. The desk also solves it backwards, for the price of each collateral asset at which HF = 1, holding the others: p* = (debt − Σ_other collateral·price·threshold) / (amount · threshold). When that comes out negative, that asset alone cannot sink the position, and the desk prints nothing rather than a number."],
    ["The close factor", "Aave v3 lets a liquidator repay HALF the debt of a position that is merely underwater. It lets them repay ALL of it when HF has fallen below 0.95, or when either side of the position is smaller than $2,000, or when taking only half would leave less than $1,000 of dust on either side. That last branch exists because a dust position is not worth anyone's gas, so the protocol makes it worth taking in one go rather than leaving bad debt on the books."],
    ["The bonus, and the protocol's cut", "Collateral seized = debtRepaid · (debtPrice / collateralPrice) · (1 + bonus). Out of that, the bonus portion is C − C/(1 + bonus), and the protocol keeps liquidationProtocolFee of the bonus — not of the collateral. So a 5% bonus with a 10% protocol fee leaves the liquidator 4.5% of the repaid amount, gross. Then they have to sell it, and the sale is where the 4.5% goes."],
    ["What the liquidator actually makes", "The desk prices the sale of the seized collateral on the app's own pool curve, subtracts the repayment, subtracts gas at three times a swap, and prints what is left. On a small position that is a healthy margin; on a position large relative to the pool, the price impact of the sale eats the bonus, and the desk shows the size at which it does. It also recomputes the health factor after the liquidation, because a 50% close factor does not always leave a healthy position — the remaining debt is smaller but so is the remaining collateral."],
    ["The cascade", "This is the part that matters. A liquidated position's collateral is sold, and it is sold into a finite pool. The desk drives a deterministic exogenous price path, and at each step: reprices the pool, finds every position below HF 1, liquidates them worst-first, sells the seized collateral through the pool's curve, and takes the resulting marginal price as the new price — which may put the next tier under water within the same step. It iterates until the step is quiet, then moves on. What is reported is the split: how far the price would have fallen on the exogenous path alone, how far it actually fell, and the difference, which is the reflexive drawdown the cascade itself caused."],
    ["Where the cascade stops", "It stops when no remaining position is below HF 1 at the current price — which happens either because the liquidated positions were the leveraged ones and what is left is genuinely over-collateralised, or because the close factor has already taken everything it can. The desk names the step and the reason. A cascade that does not stop inside the price path is a cascade whose pool is too thin for its positions, and that is the finding."],
    ["E-mode", "A correlated-asset category replaces the LTV, the threshold and the bonus for assets inside it — ETH-correlated is 93 / 95 / 1 against WETH's own 80.5 / 83 / 5. It is not free: while e-mode is on, you may only borrow assets in the category, and the desk refuses a borrow outside it rather than quietly ignoring the rule. Collateral outside the category keeps its own parameters."],
    ["Isolation mode", "An isolated asset can be your only collateral, you can only borrow stablecoins flagged borrowable-in-isolation against it, and the protocol tracks a debt CEILING in dollars across everyone who borrowed against it. When the ceiling is full, the borrow fails no matter how healthy you are. The desk enforces all three and prints the headroom."],
    ["Siloed borrowing and the caps", "A siloed reserve may be the only debt in a position, full stop — the protocol's answer to a long-tail asset whose price it does not fully trust. Supply and borrow caps are absolute unit ceilings on the reserve; a borrow that would cross one is refused with the exact headroom, and the maximum borrow the desk quotes is the MINIMUM of the LTV limit, the cap headroom and the isolation ceiling, not the LTV limit alone."],
    ["Restaking — the reward side", "Restaked ETH or an LST earns its base yield and then, separately, whatever the AVSs it secures pay. An AVS fee is expressed as an APR on the stake it is securing; the operator takes a commission of that fee; the rest reaches the staker. Effective yield = LST base + Σ fee_i · (1 − commission_i). The stacking is real and it is also small: three services paying 1–3% with a 10% operator commission adds perhaps five points to a three-point base."],
    ["Restaking — the risk side, done properly", "Slashing across AVSs served by one operator is NOT independent. One operator fault — a bad key, a bad upgrade, an outage — is one event that several AVSs can slash for. The desk models each AVS's event as a latent normal crossing its threshold, with all latents sharing a common factor at correlation rho: X_i = √rho·Z + √(1−rho)·ε_i, event i when X_i < Φ⁻¹(p_i). Conditional on Z the events are independent, so the exact loss distribution is the 2^N enumeration integrated over Z by quadrature. At rho = 0 it collapses to the independent case, and the desk prints both so the fattening is visible rather than asserted."],
    ["The break-even", "Extra yield is certain and small; the loss is rare and large, which is the shape people mis-price. The desk scales every AVS's slashing probability by a common factor and solves for the factor at which the expected annual loss exactly equals the extra yield. What comes back is a probability you can argue with — if the largest service's true annual slashing probability is above it, the restaking leg has a negative expected value at your correlation, however good the APR looked."]
  ];

  /* ============================================================ rate model */

  function utilisation(available, debt) {
    if (!(available >= 0) || !(debt >= 0)) return null;
    var tot = available + debt;
    if (!(tot > 0)) return 0;
    return debt / tot;
  }

  /* Aave v3 DefaultReserveInterestRateStrategy.calculateInterestRates */
  function borrowRate(r, U) {
    if (!r || !(U >= 0)) return null;
    if (U <= r.uOpt) return r.base + (r.uOpt > 0 ? r.s1 * U / r.uOpt : r.s1);
    var over = (U - r.uOpt) / (1 - r.uOpt);
    return r.base + r.s1 + r.s2 * over;
  }

  function supplyRate(borrow, U, reserveFactor) {
    if (borrow == null || !(U >= 0)) return null;
    return borrow * U * (1 - (reserveFactor || 0));
  }

  /* MathUtils.calculateLinearInterest — the LIQUIDITY index */
  function linearFactor(rate, seconds) {
    if (rate == null || !(seconds >= 0)) return null;
    return 1 + rate * seconds / SECONDS_PER_YEAR;
  }

  /* MathUtils.calculateCompoundedInterest — the VARIABLE BORROW index.
     Written the way the contract writes it, in seconds, so the (1 − 1/n) and
     (1 − 2/n) factors are present rather than dropped. */
  function compoundedFactor(rate, seconds) {
    if (rate == null || !(seconds >= 0)) return null;
    var exp = seconds;
    if (exp === 0) return 1;
    var expMinusOne = exp - 1;
    var expMinusTwo = exp > 2 ? exp - 2 : 0;
    var rps = rate / SECONDS_PER_YEAR;
    var basePowerTwo = rps * rps;
    var basePowerThree = basePowerTwo * rps;
    var secondTerm = exp * expMinusOne * basePowerTwo / 2;
    var thirdTerm = exp * expMinusOne * expMinusTwo * basePowerThree / 6;
    return 1 + rps * exp + secondTerm + thirdTerm;
  }

  /* what the contract WOULD charge if it compounded continuously */
  function exactFactor(rate, seconds) {
    if (rate == null || !(seconds >= 0)) return null;
    return Math.exp(rate * seconds / SECONDS_PER_YEAR);
  }

  /* the three factors side by side, and what the approximation costs */
  function accrual(rate, seconds, principal) {
    var lin = linearFactor(rate, seconds);
    var apx = compoundedFactor(rate, seconds);
    var ex = exactFactor(rate, seconds);
    if (lin == null || apx == null || ex == null) return null;
    var p = principal > 0 ? principal : null;
    return {
      seconds: seconds, rate: rate,
      linear: lin, binomial: apx, exact: ex,
      binomialVsExact: ex - apx,
      binomialVsExactBps: (ex - apx) * 1e4,
      binomialVsExactPerMillion: (ex - apx) * 1e6,
      linearVsBinomialBps: (apx - lin) * 1e4,
      interestLinear: p == null ? null : p * (lin - 1),
      interestBinomial: p == null ? null : p * (apx - 1),
      interestExact: p == null ? null : p * (ex - 1),
      undercharge: p == null ? null : p * (ex - apx)
    };
  }

  /* a row of the curve, for the Market tab */
  function curveRow(r, U) {
    var b = borrowRate(r, U);
    return { u: U, borrow: b, supply: supplyRate(b, U, r.rf), kink: Math.abs(U - r.uOpt) < 1e-12 };
  }

  /* ========================================================= position health */

  /* GenericLogic.calculateUserAccountData: the e-mode category replaces the
     parameters ONLY for reserves inside it. */
  function effParams(key, emodeKey) {
    var r = res(key);
    if (!r) return null;
    var em = EMODES[emodeKey || "none"];
    if (em && em.assets && em.assets.indexOf(key) >= 0) {
      return { ltv: em.ltv, lt: em.lt, bonus: em.bonus, source: "e-mode: " + em.label };
    }
    return { ltv: r.ltv, lt: r.lt, bonus: r.bonus, source: "reserve parameters" };
  }

  /* pos = { collateral:[{key,amount,price,enabled}], debt:[{key,amount,price}],
            emode:"none"|"eth"|"stable" } */
  function health(pos) {
    if (!pos || !pos.collateral || !pos.debt) return null;
    var i, c, d, p, v;
    var collBase = 0, ltvW = 0, ltW = 0, debtBase = 0, rows = [], drows = [];
    for (i = 0; i < pos.collateral.length; i++) {
      c = pos.collateral[i];
      if (c.enabled === false) continue;
      if (!(c.amount > 0) || !(c.price > 0)) continue;
      p = effParams(c.key, pos.emode);
      if (!p) continue;
      v = c.amount * c.price;
      collBase += v; ltvW += v * p.ltv; ltW += v * p.lt;
      rows.push({ key: c.key, amount: c.amount, price: c.price, valueBase: v, ltv: p.ltv, lt: p.lt, bonus: p.bonus, source: p.source });
    }
    for (i = 0; i < pos.debt.length; i++) {
      d = pos.debt[i];
      if (!(d.amount > 0) || !(d.price > 0)) continue;
      debtBase += d.amount * d.price;
      drows.push({ key: d.key, amount: d.amount, price: d.price, valueBase: d.amount * d.price });
    }
    var hf = debtBase > 0 ? ltW / debtBase : (collBase > 0 ? Infinity : null);
    var maxBorrow = collBase > 0 ? ltvW : null;
    for (i = 0; i < rows.length; i++) {
      /* p* such that HF = 1 holding the other collateral still */
      var others = ltW - rows[i].valueBase * rows[i].lt;
      var denom = rows[i].amount * rows[i].lt;
      var star = denom > 0 ? (debtBase - others) / denom : null;
      rows[i].liqPrice = (star != null && star > 0 && isFinite(star)) ? star : null;
      rows[i].liqDropPct = rows[i].liqPrice != null && rows[i].price > 0 ? (1 - rows[i].liqPrice / rows[i].price) * 100 : null;
    }
    return {
      collateralBase: collBase > 0 ? collBase : null,
      debtBase: debtBase,
      weightedLtv: collBase > 0 ? ltvW / collBase : null,
      weightedThreshold: collBase > 0 ? ltW / collBase : null,
      thresholdBase: ltW,
      healthFactor: hf,
      maxBorrowBase: maxBorrow,
      availableBorrowBase: maxBorrow == null ? null : Math.max(0, maxBorrow - debtBase),
      powerUsed: maxBorrow > 0 ? debtBase / maxBorrow : null,
      liquidatable: hf != null && isFinite(hf) && hf < HEALTH_FACTOR_LIQUIDATION_THRESHOLD,
      collateral: rows, debt: drows,
      emode: pos.emode || "none"
    };
  }

  /* ===================================================== the four constraints */

  /* plan = { borrowKey, borrowAmount, borrowPrice, reserveSupplied, reserveBorrowed,
             isolatedDebtBase } — reserve totals are what the caps bite on */
  function constraints(pos, plan) {
    var out = [], i, h = health(pos), em = EMODES[(pos && pos.emode) || "none"];
    plan = plan || {};
    var bk = plan.borrowKey, br = res(bk), amt = +plan.borrowAmount || 0, px = +plan.borrowPrice || 0;
    var limitBase = h && h.availableBorrowBase != null ? h.availableBorrowBase : null;
    var binding = null;

    /* 1 · e-mode restricts what may be borrowed at all */
    if (em && em.assets) {
      var allowed = !bk || em.assets.indexOf(bk) >= 0;
      out.push({
        id: "emode", ok: allowed, label: window.DLI18N.t("55-lending.b90d39b8bdac"),
        detail: allowed
          ? "category " + em.label + " — borrowing is restricted to " + em.assets.join(", ") + ", and " + (bk ? bk + " is inside it" : "nothing is being borrowed")
          : "category " + em.label + " is on, so " + bk + " cannot be borrowed at all. Only " + em.assets.join(", ") + " may be. Turn e-mode off and this position's threshold drops from " + pctOf(em.lt) + " to the reserve's own."
      });
      if (!allowed) { limitBase = 0; binding = binding || "e-mode"; }
    }

    /* 2 · isolation mode */
    var iso = isolatedOf(pos);
    if (iso) {
      var ir = res(iso);
      var isoOk = !bk || !!(res(bk) && res(bk).inIso);
      out.push({
        id: "iso-asset", ok: isoOk, label: window.DLI18N.t("55-lending.3bf16086d085"),
        detail: isoOk
          ? iso + " is an isolated listing, so it is your only collateral and only stablecoins flagged borrowable-in-isolation may be borrowed against it" + (bk ? " — " + bk + " is flagged" : "")
          : iso + " is isolated: only stablecoins flagged borrowable-in-isolation may be borrowed against it, and " + bk + " is not one. The borrow is refused."
      });
      if (!isoOk) { limitBase = 0; binding = binding || "isolation mode"; }
      var used = +plan.isolatedDebtBase || 0;
      var ceiling = ir ? ir.ceiling : 0;
      var headroom = Math.max(0, ceiling - used);
      var ceilOk = !bk || amt * px <= headroom + 1e-9;
      out.push({
        id: "iso-ceiling", ok: ceilOk, label: window.DLI18N.t("55-lending.2bd38624fe2c"),
        detail: "the ceiling on " + iso + " is " + usd(ceiling) + " across every borrower, " + usd(used) + " of it is used, so " + usd(headroom) + " is left. " +
          (ceilOk ? "This borrow fits." : "This borrow is " + usd(amt * px) + " and does not fit: it fails on the ceiling, not on your health factor.")
      });
      if (limitBase == null || headroom < limitBase) { limitBase = headroom; binding = "the isolation debt ceiling"; }
    }

    /* 3 · siloed borrowing */
    if (br && br.silo) {
      var otherDebt = 0;
      for (i = 0; i < pos.debt.length; i++) if (pos.debt[i].key !== bk && pos.debt[i].amount > 0) otherDebt++;
      var siloOk = otherDebt === 0;
      out.push({
        id: "silo", ok: siloOk, label: window.DLI18N.t("55-lending.6d622cca365f"),
        detail: siloOk
          ? bk + " is a siloed reserve: it can be borrowed, but it must be the only debt in the position from here on"
          : bk + " is siloed and this position already carries " + otherDebt + " other borrowed asset" + (otherDebt === 1 ? "" : "s") + ". A siloed reserve may be the only debt in a position — repay the rest first."
      });
      if (!siloOk) { limitBase = 0; binding = binding || "siloed borrowing"; }
    } else {
      for (i = 0; i < pos.debt.length; i++) {
        var od = res(pos.debt[i].key);
        if (od && od.silo && pos.debt[i].amount > 0 && pos.debt[i].key !== bk && bk) {
          out.push({ id: "silo", ok: false, label: window.DLI18N.t("55-lending.6d622cca365f"), detail: pos.debt[i].key + " is already borrowed and it is siloed, so nothing else may be borrowed alongside it." });
          limitBase = 0; binding = binding || "siloed borrowing";
          break;
        }
      }
    }

    /* 4 · caps */
    if (br) {
      var borrowed = +plan.reserveBorrowed || 0;
      var capRoom = Math.max(0, br.borrowCap - borrowed);
      var capOk = br.borrowCap > 0 ? amt <= capRoom + 1e-9 : amt <= 0;
      out.push({
        id: "borrow-cap", ok: capOk, label: window.DLI18N.t("55-lending.0d1cf163f9a6"),
        detail: br.borrowCap > 0
          ? "the cap on " + bk + " is " + big(br.borrowCap) + " " + bk + ", " + big(borrowed) + " is borrowed, so " + big(capRoom) + " is left. " + (capOk ? "This borrow fits." : "This borrow is " + big(amt) + " and crosses it.")
          : bk + " has a borrow cap of zero — it is supply-only. Nothing can be borrowed from it at any health factor."
      });
      var capBase = px > 0 ? capRoom * px : null;
      if (capBase != null && (limitBase == null || capBase < limitBase)) { limitBase = capBase; binding = "the borrow cap"; }
    }
    if (plan.supplyKey) {
      var sr = res(plan.supplyKey), sup = +plan.reserveSupplied || 0, add = +plan.supplyAmount || 0;
      if (sr) {
        var room = Math.max(0, sr.supplyCap - sup);
        var sOk = add <= room + 1e-9;
        out.push({
          id: "supply-cap", ok: sOk, label: window.DLI18N.t("55-lending.4b6985bd9ac0"),
          detail: "the cap on " + plan.supplyKey + " is " + big(sr.supplyCap) + ", " + big(sup) + " is supplied, " + big(room) + " is left. " + (sOk ? "This supply fits." : "This supply is " + big(add) + " and is refused at the cap — a supply cap is not a soft limit.")
        });
      }
    }

    if (limitBase == null && h && h.availableBorrowBase != null) limitBase = h.availableBorrowBase;
    if (binding == null) binding = "your loan-to-value limit";
    return {
      rows: out,
      maxBorrowBase: limitBase,
      binding: binding,
      allOk: (function () { for (var j = 0; j < out.length; j++) if (!out[j].ok) return false; return true; })()
    };
  }

  function isolatedOf(pos) {
    if (!pos || !pos.collateral) return null;
    var i, c, r, on = [];
    for (i = 0; i < pos.collateral.length; i++) {
      c = pos.collateral[i];
      if (c.enabled === false || !(c.amount > 0)) continue;
      on.push(c.key);
    }
    for (i = 0; i < on.length; i++) { r = res(on[i]); if (r && r.ceiling > 0) return on[i]; }
    return null;
  }

  /* ============================================================ liquidation */

  /* LiquidationLogic._calculateDebt, Aave v3.1 */
  function closeFactor(hf, debtBase, collBase) {
    if (hf == null || !isFinite(hf)) return null;
    if (hf < CLOSE_FACTOR_HF_THRESHOLD) return MAX_CLOSE_FACTOR;
    if (debtBase < MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) return MAX_CLOSE_FACTOR;
    if (collBase < MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) return MAX_CLOSE_FACTOR;
    return DEFAULT_CLOSE_FACTOR;
  }

  /* LiquidationLogic._calculateAvailableCollateralToLiquidate */
  function seize(debtToCover, debtPrice, collPrice, bonus, protFee) {
    if (!(debtToCover > 0) || !(debtPrice > 0) || !(collPrice > 0)) return null;
    var baseCollateral = debtToCover * debtPrice / collPrice;
    var withBonus = baseCollateral * (1 + bonus);
    var bonusPortion = withBonus - withBonus / (1 + bonus);
    var fee = bonusPortion * (protFee || 0);
    return {
      baseCollateral: baseCollateral,
      collateralSeized: withBonus,
      bonusCollateral: bonusPortion,
      protocolFee: fee,
      toLiquidator: withBonus - fee
    };
  }

  /* The whole call: what the liquidator repays, what they receive, what the
     sale of it fetches on the pool, what gas costs, and whether the position
     is left healthy. The pool argument is a DLAPP.paper pool; null means the sale is not
     priced and the proceeds stay missing rather than becoming the mid. */
  function liquidate(pos, collKey, debtKey, pool, opts) {
    opts = opts || {};
    var h = health(pos);
    if (!h || h.healthFactor == null) return null;
    var cRow = null, dRow = null, i;
    for (i = 0; i < h.collateral.length; i++) if (h.collateral[i].key === collKey) cRow = h.collateral[i];
    for (i = 0; i < h.debt.length; i++) if (h.debt[i].key === debtKey) dRow = h.debt[i];
    if (!cRow || !dRow) return { ok: false, reason: "that collateral or that debt is not in the position" };
    if (!h.liquidatable) {
      return { ok: false, health: h, reason: "health factor is " + fx(h.healthFactor, 4) + " — at or above 1 nothing can be liquidated. The protocol does not care how close it is." };
    }

    var cf = closeFactor(h.healthFactor, h.debtBase, h.collateralBase);
    var cfReason = h.healthFactor < CLOSE_FACTOR_HF_THRESHOLD
      ? "health factor is below " + CLOSE_FACTOR_HF_THRESHOLD + ", so the whole debt may be repaid"
      : (h.debtBase < MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD || h.collateralBase < MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD)
        ? "one side of the position is under " + usd(MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) + ", so the whole debt may be repaid rather than leaving dust"
        : "health factor is at or above " + CLOSE_FACTOR_HF_THRESHOLD + " and both sides clear " + usd(MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) + ", so half the debt is the limit";

    var wanted = dRow.amount * cf;
    /* the leftover rule: half of a position that leaves dust is taken whole */
    var leftDebt = (dRow.amount - wanted) * dRow.price;
    if (cf < 1 && leftDebt > 0 && leftDebt < MIN_LEFTOVER_BASE) {
      wanted = dRow.amount; cf = 1;
      cfReason = "taking half would leave under " + usd(MIN_LEFTOVER_BASE) + " of debt behind, which is dust nobody would pay gas to clear, so the whole debt is taken";
    }

    var s = seize(wanted, dRow.price, cRow.price, cRow.bonus, res(collKey) ? res(collKey).protFee : 0);
    if (!s) return { ok: false, reason: "a price is missing, so nothing can be priced" };

    /* the collateral cannot exceed what the position holds — scale the repay */
    var capped = false;
    if (s.collateralSeized > cRow.amount) {
      var scale = cRow.amount / s.collateralSeized;
      wanted = wanted * scale;
      s = seize(wanted, dRow.price, cRow.price, cRow.bonus, res(collKey) ? res(collKey).protFee : 0);
      capped = true;
    }

    var repayBase = wanted * dRow.price;
    var grossBase = s.toLiquidator * cRow.price;

    /* sell what the liquidator received, on the app's own curve */
    var sale = null, saleBase = null, impactBps = null, newPrice = null;
    if (pool) {
      var q = quoteSale(pool, s.toLiquidator);
      if (q) {
        sale = q;
        saleBase = q.quote;
        impactBps = q.impactPct * 100;
        newPrice = q.p1;
      }
    }
    var swapFee = saleBase == null ? null : saleBase * ammFeeRate();
    var gas = gasForLiquidation(opts.gasTier || "medium");
    var netBase = saleBase == null ? null : saleBase - swapFee - repayBase - (gas == null ? 0 : gas);

    /* the position afterwards */
    var after = clonePos(pos);
    for (i = 0; i < after.collateral.length; i++) if (after.collateral[i].key === collKey) after.collateral[i].amount -= s.collateralSeized;
    for (i = 0; i < after.debt.length; i++) if (after.debt[i].key === debtKey) after.debt[i].amount -= wanted;
    var hAfter = health(after);

    return {
      ok: true, health: h, healthAfter: hAfter,
      closeFactor: cf, closeFactorReason: cfReason, capped: capped,
      debtRepaid: wanted, debtRepaidBase: repayBase,
      collateralSeized: s.collateralSeized, bonusCollateral: s.bonusCollateral,
      protocolFeeCollateral: s.protocolFee, toLiquidator: s.toLiquidator,
      bonus: cRow.bonus, protFee: res(collKey) ? res(collKey).protFee : 0,
      grossBase: grossBase,
      grossMarginBase: grossBase - repayBase,
      saleProceedsBase: saleBase, swapFeeBase: swapFee, gasBase: gas,
      netProfitBase: netBase,
      netProfitPct: netBase == null || !(repayBase > 0) ? null : netBase / repayBase * 100,
      saleImpactBps: impactBps, priceAfterSale: newPrice,
      healthyAfter: hAfter && hAfter.healthFactor != null && (!isFinite(hAfter.healthFactor) || hAfter.healthFactor >= 1),
      collKey: collKey, debtKey: debtKey, collPrice: cRow.price, debtPrice: dRow.price,
      pos: pos, after: after
    };
  }

  function clonePos(pos) {
    var o = { emode: pos.emode, collateral: [], debt: [] }, i, c;
    for (i = 0; i < pos.collateral.length; i++) { c = pos.collateral[i]; o.collateral.push({ key: c.key, amount: c.amount, price: c.price, enabled: c.enabled }); }
    for (i = 0; i < pos.debt.length; i++) { c = pos.debt[i]; o.debt.push({ key: c.key, amount: c.amount, price: c.price }); }
    return o;
  }

  function ammFeeRate() {
    try {
      var p = P();
      if (p && typeof p.venueFees === "function") { var f = p.venueFees("dexamm"); if (f && f.taker > 0) return f.taker; }
      if (p && p.VENUES && p.VENUES.dexamm && p.VENUES.dexamm.taker > 0) return p.VENUES.dexamm.taker;
    } catch (e) {}
    return 0.003;
  }

  function gasForLiquidation(tier) {
    var p = P();
    if (!p) return null;
    var eth = 0;
    try { var c = C.coin("ETH"); eth = (c && +c.price) || 0; } catch (e) { eth = 0; }
    if (!(eth > 0)) return null;
    try {
      var gwei = (p.FALLBACK_GWEI > 0 ? p.FALLBACK_GWEI : 5) * ((p.TIER_MULT && p.TIER_MULT[tier]) || 1);
      var units = (p.GAS_UNITS && p.GAS_UNITS.swap ? p.GAS_UNITS.swap : 150000) * LIQ_GAS_MULTIPLE;
      return p.gasCost(units, gwei, eth, 1);
    } catch (e) { return null; }
  }

  /* one sale of qty base into the pool, using the engine's own curve */
  function quoteSale(pool, qty) {
    var p = P();
    if (!p || !pool || !(qty > 0)) return null;
    try {
      var q = p.quoteImpact(pool, "sell", qty, 0);
      if (!q || !q.swap || !(q.swap.filled > 0)) return null;
      return { filled: q.swap.filled, quote: q.swap.quote, avg: q.swap.avg, p0: q.swap.p0, p1: q.swap.p1, impactPct: q.impactPct, unfilled: q.swap.unfilled };
    } catch (e) { return null; }
  }

  function poolAtPrice(pool, price) {
    if (!pool || !(price > 0)) return pool;
    var sp = Math.sqrt(price);
    if (pool.spa > 0 && sp < pool.spa) sp = pool.spa;
    if (isFinite(pool.spb) && sp > pool.spb) sp = pool.spb;
    return { L: pool.L, sp: sp, spa: pool.spa, spb: pool.spb };
  }

  function poolOf(price, tvlUSD, rangePct) {
    var p = P();
    if (!p || !(price > 0) || !(tvlUSD > 0)) return null;
    try { return p.poolFromTVL(price, tvlUSD, rangePct != null && rangePct > 0 ? rangePct : null); } catch (e) { return null; }
  }

  /* ================================================================ cascade */

  /* cfg = { collKey, price0, tvlUSD, rangePct, dropPct, steps,
             positions: [{ collateral, debt, debtKey }], emode } */
  function cascade(cfg) {
    cfg = cfg || {};
    var collKey = cfg.collKey || "WETH";
    var debtKey = cfg.debtKey || "USDC";
    var price0 = +cfg.price0 || 0;
    var steps = Math.max(1, Math.min(120, Math.round(+cfg.steps || 12)));
    var drop = +cfg.dropPct || 0;
    var pool = poolOf(price0, +cfg.tvlUSD || 0, +cfg.rangePct || 0);
    if (!(price0 > 0)) return { ok: false, reason: "no starting price, so there is nothing to fall" };
    if (!pool) return { ok: false, reason: "no pool — the engine's curve is not available, and without it a forced sale has no price to move" };

    var list = [], i;
    for (i = 0; i < (cfg.positions || []).length; i++) {
      var s = cfg.positions[i];
      if (!(s.collateral > 0) || !(s.debt > 0)) continue;
      list.push({ id: i + 1, label: s.label || ("position " + (i + 1)), collateral: s.collateral, coll0: s.collateral, debt: s.debt, debt0: s.debt, alive: true, hits: 0 });
    }
    if (!list.length) return { ok: false, reason: "no positions, so no cascade" };

    var P0 = effParams(collKey, cfg.emode), r = res(collKey);
    if (!P0 || !r) return { ok: false, reason: "unknown reserve" };
    var lt = P0.lt, bonus = P0.bonus, protFee = r.protFee;

    var price = price0, sold = 0, soldBase = 0, hitCount = 0, events = [], stepRows = [];
    var lastHitStep = null, guardHit = false;

    for (var k = 1; k <= steps; k++) {
      var exo = price0 * (1 - (drop / 100) * (k / steps));
      var exoPrev = price0 * (1 - (drop / 100) * ((k - 1) / steps));
      /* the exogenous move reprices the pool: arbitrage drags it to the new
         reference before any liquidation happens */
      var ratio = exoPrev > 0 ? exo / exoPrev : 1;
      price = price * ratio;
      pool = poolAtPrice(pool, price);

      var stepSold = 0, stepHits = 0, rounds = 0, priceStepStart = price;
      while (rounds < 40) {
        rounds++;
        /* worst health first, then lowest id — deterministic, no ties by luck */
        var worst = null, worstHf = null;
        for (i = 0; i < list.length; i++) {
          if (!list[i].alive) continue;
          var hfi = list[i].debt > 0 ? (list[i].collateral * price * lt) / list[i].debt : Infinity;
          if (hfi < 1 && (worstHf == null || hfi < worstHf - 1e-15)) { worstHf = hfi; worst = list[i]; }
        }
        if (!worst) break;

        var collBase = worst.collateral * price, debtBase = worst.debt;
        var cf = closeFactor(worstHf, debtBase, collBase);
        var repay = worst.debt * cf;
        if ((worst.debt - repay) > 0 && (worst.debt - repay) < MIN_LEFTOVER_BASE) { repay = worst.debt; cf = 1; }
        var sz = seize(repay, 1, price, bonus, protFee);
        if (!sz) break;
        if (sz.collateralSeized > worst.collateral) {
          var sc = worst.collateral / sz.collateralSeized;
          repay = repay * sc;
          sz = seize(repay, 1, price, bonus, protFee);
        }
        worst.collateral -= sz.collateralSeized;
        worst.debt -= repay;
        worst.hits++;
        if (!(worst.debt > 1e-9) || !(worst.collateral > 1e-12)) worst.alive = false;

        /* the seized collateral is SOLD. This is the whole point. */
        var q = quoteSale(pool, sz.toLiquidator);
        var got = q ? q.quote : null;
        if (q) { price = q.p1; pool = poolAtPrice(pool, q.p1); }
        sold += sz.toLiquidator; soldBase += (got == null ? sz.toLiquidator * price : got);
        stepSold += sz.toLiquidator; stepHits++; hitCount++;
        lastHitStep = k;
        events.push({
          step: k, id: worst.id, label: worst.label, hfBefore: worstHf, closeFactor: cf,
          repaid: repay, seized: sz.collateralSeized, toLiquidator: sz.toLiquidator,
          proceeds: got, priceBefore: q ? q.p0 : price, priceAfter: price,
          impactBps: q ? q.impactPct * 100 : null
        });
        if (rounds >= 40) guardHit = true;
      }

      stepRows.push({
        step: k, exogenous: exo, price: price, hits: stepHits, sold: stepSold,
        reflexiveBps: exo > 0 ? (1 - price / exo) * 1e4 : null,
        stepMoveBps: priceStepStart > 0 ? (1 - price / priceStepStart) * 1e4 : null
      });
      if (guardHit) break;
    }

    var exoFinal = price0 * (1 - drop / 100);
    var alive = 0;
    for (i = 0; i < list.length; i++) if (list[i].alive) alive++;
    var stopReason;
    if (guardHit) stopReason = "the step guard tripped at 40 liquidation rounds inside one step — at this pool size the position set does not clear, which is the finding";
    else if (lastHitStep == null) stopReason = "nothing was ever liquidated: every position stayed above health factor 1 for the whole path";
    else if (alive === 0) stopReason = "every position was fully taken by step " + lastHitStep;
    else if (lastHitStep === steps) stopReason = "it had not stopped — the price path ran out at step " + steps + " with liquidations still landing. Lengthen the path or deepen the pool to find where it actually ends";
    else stopReason = "the cascade went quiet after step " + lastHitStep + " — the " + alive + " remaining position" + (alive === 1 ? " was" : "s were") + " above health factor 1 at the price the selling left behind, and the rest of the path did not put " + (alive === 1 ? "it" : "them") + " back under";

    return {
      ok: true,
      price0: price0, priceFinal: price, exogenousFinal: exoFinal,
      exogenousDrawdownPct: (1 - exoFinal / price0) * 100,
      totalDrawdownPct: (1 - price / price0) * 100,
      reflexiveDrawdownPct: (1 - price / price0) * 100 - (1 - exoFinal / price0) * 100,
      reflexiveShareOfFall: (1 - price / price0) > 0 ? ((1 - price / price0) - (1 - exoFinal / price0)) / (1 - price / price0) : null,
      cumulativeImpactBps: exoFinal > 0 ? (1 - price / exoFinal) * 1e4 : null,
      positionsHit: countHit(list), liquidations: hitCount,
      collateralSold: sold, collateralSoldBase: soldBase,
      positionsLeft: alive, lastHitStep: lastHitStep, stopReason: stopReason,
      steps: stepRows, events: events, positions: list,
      collKey: collKey, debtKey: debtKey
    };
  }

  function countHit(list) { var n = 0, i; for (i = 0; i < list.length; i++) if (list[i].hits > 0) n++; return n; }

  /* ============================================================== restaking */

  /* West's double-precision cumulative normal — accurate to ~1e-15, which the
     tail needs and a 7-term series does not. */
  function normCdf(x) {
    var z = Math.abs(x), c = 0, e, b, d, f;
    if (z > 37) c = 0;
    else {
      e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        b = 3.52624965998911e-02 * z + 0.700383064443688;
        b = b * z + 6.37396220353165; b = b * z + 33.912866078383;
        b = b * z + 112.079291497871; b = b * z + 221.213596169931;
        b = b * z + 220.206867912376;
        d = 8.83883476483184e-02 * z + 1.75566716318264;
        d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674; d = d * z + 637.333633378831;
        d = d * z + 793.826512519948; d = d * z + 440.413735824752;
        c = e * b / d;
      } else {
        f = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))));
        c = e / (f * 2.506628274631);
      }
    }
    return x > 0 ? 1 - c : c;
  }

  /* Acklam's inverse normal, refined once by Halley against normCdf */
  function normInv(p) {
    if (!(p > 0) || !(p < 1)) return p <= 0 ? -Infinity : Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r, x;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    var e2 = normCdf(x) - p;
    var u = e2 * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /* the reward split: AVS fee → operator commission → staker */
  function rewardStack(cfg) {
    cfg = cfg || {};
    var base = +cfg.lstBaseApr || 0;
    var rows = [], extra = 0, toOps = 0, i;
    var avs = cfg.avs || [];
    for (i = 0; i < avs.length; i++) {
      var a = avs[i];
      var fee = +a.feeApr || 0, com = Math.min(1, Math.max(0, +a.commission || 0));
      var toOp = fee * com, toStaker = fee - toOp;
      extra += toStaker; toOps += toOp;
      rows.push({ name: a.name || ("AVS " + (i + 1)), feeApr: fee, commission: com, operatorApr: toOp, stakerApr: toStaker, slashPct: +a.slashPct || 0, prob: +a.prob || 0 });
    }
    return {
      lstBaseApr: base, rows: rows,
      extraStakerApr: extra, operatorApr: toOps,
      grossAvsApr: extra + toOps,
      effectiveApr: base + extra,
      stackMultiple: base > 0 ? (base + extra) / base : null
    };
  }

  /* One-factor Gaussian copula. Conditional on the common factor the events
     are independent, so the loss distribution is the exact 2^N enumeration
     integrated over the factor by quadrature. Deterministic: no seed, no draw. */
  var Z_NODES = 321, Z_SPAN = 8;

  function lossDistribution(avs, rho) {
    if (!avs || !avs.length) return null;
    var n = Math.min(avs.length, 12), i, j, k;
    rho = Math.min(0.999, Math.max(0, rho == null ? 0 : rho));
    var thr = [], sev = [];
    for (i = 0; i < n; i++) {
      var pr = Math.min(0.999999, Math.max(1e-9, +avs[i].prob || 0));
      thr.push(normInv(pr));
      sev.push(Math.min(1, Math.max(0, +avs[i].slashPct || 0)));
    }
    var sr = Math.sqrt(rho), sr1 = Math.sqrt(1 - rho);
    var combos = 1 << n;
    var acc = [], loss = [];
    for (k = 0; k < combos; k++) {
      var L = 0;
      for (i = 0; i < n; i++) if (k & (1 << i)) L += sev[i];
      loss.push(Math.min(1, L));
      acc.push(0);
    }
    var step = 2 * Z_SPAN / (Z_NODES - 1), total = 0;
    for (j = 0; j < Z_NODES; j++) {
      var z = -Z_SPAN + j * step;
      var w = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * step;
      /* Simpson would be tidier; the trapezoid ends are 1e-15 so the
         difference is below the width of the answer. Normalised below. */
      if (j === 0 || j === Z_NODES - 1) w *= 0.5;
      total += w;
      var q = [];
      for (i = 0; i < n; i++) q.push(rho <= 0 ? normCdf(thr[i]) : normCdf((thr[i] - sr * z) / sr1));
      for (k = 0; k < combos; k++) {
        var pk = 1;
        for (i = 0; i < n; i++) pk *= (k & (1 << i)) ? q[i] : (1 - q[i]);
        acc[k] += w * pk;
      }
    }
    /* renormalise for the truncated tails of the quadrature */
    var mean = 0, pAny = 0, pAll = 0, pairs = 0;
    for (k = 0; k < combos; k++) { acc[k] /= total; mean += acc[k] * loss[k]; if (k) pAny += acc[k]; }
    pAll = acc[combos - 1];
    for (k = 0; k < combos; k++) { var bits = 0; for (i = 0; i < n; i++) if (k & (1 << i)) bits++; if (bits >= 2) pairs += acc[k]; }

    /* sorted outcomes for the tail */
    var idx = [];
    for (k = 0; k < combos; k++) idx.push(k);
    idx.sort(function (x, y) { return loss[x] - loss[y] || x - y; });
    function quantile(a) {
      var cum = 0;
      for (var t = 0; t < idx.length; t++) { cum += acc[idx[t]]; if (cum >= a - 1e-15) return loss[idx[t]]; }
      return loss[idx[idx.length - 1]];
    }
    function tailAtLeast(x) { var s = 0; for (var t = 0; t < combos; t++) if (loss[t] >= x - 1e-12) s += acc[t]; return s; }
    var v99 = quantile(0.99);
    var es = 0, esW = 0;
    for (k = 0; k < combos; k++) if (loss[k] >= v99 - 1e-12) { es += acc[k] * loss[k]; esW += acc[k]; }

    return {
      n: n, rho: rho,
      expectedLoss: mean,
      pAny: pAny, pAll: pAll, pTwoOrMore: pairs,
      var95: quantile(0.95), var99: v99, var999: quantile(0.999),
      es99: esW > 0 ? es / esW : null,
      maxLoss: loss[idx[idx.length - 1]],
      tailAtLeast: tailAtLeast,
      outcomes: (function () {
        var out = [], seen = {}, t;
        for (t = idx.length - 1; t >= 0; t--) {
          var key = loss[idx[t]].toFixed(6);
          if (!seen[key]) { seen[key] = { loss: loss[idx[t]], prob: 0 }; out.push(seen[key]); }
          seen[key].prob += acc[idx[t]];
        }
        return out;
      })()
    };
  }

  /* the whole restaking answer: yield, correlated loss, the independent
     comparison, and the probability at which the extra yield is gone */
  function restake(cfg) {
    cfg = cfg || {};
    var stack = rewardStack(cfg);
    var avs = stack.rows;
    if (!avs.length) return { ok: false, reason: "no services — restaking with nothing to secure is just staking" };
    var rho = cfg.rho == null ? 0.5 : +cfg.rho;
    var corr = lossDistribution(avs, rho);
    var indep = lossDistribution(avs, 0);
    if (!corr || !indep) return { ok: false, reason: "the loss distribution could not be built" };

    var principal = +cfg.principal > 0 ? +cfg.principal : null;
    var extra = stack.extraStakerApr;
    var netApr = stack.effectiveApr - corr.expectedLoss;

    /* break-even: scale every probability by k until the expected loss eats
       the extra yield. Monotone in k, so bisection is exact to 1e-9. */
    var lo = 0, hi = 1, kStar = null, it;
    var scaled = function (k) {
      var l = [], i;
      for (i = 0; i < avs.length; i++) l.push({ prob: Math.min(0.999999, avs[i].prob * k), slashPct: avs[i].slashPct });
      var d = lossDistribution(l, rho);
      return d ? d.expectedLoss : 0;
    };
    if (extra > 0) {
      if (scaled(1) >= extra) { hi = 1; lo = 0; }
      else {
        hi = 1;
        for (it = 0; it < 40 && scaled(hi) < extra; it++) hi *= 2;
      }
      for (it = 0; it < 60; it++) {
        var mid = (lo + hi) / 2;
        if (scaled(mid) < extra) lo = mid; else hi = mid;
      }
      kStar = (lo + hi) / 2;
    }
    var beRows = [];
    if (kStar != null) for (var i2 = 0; i2 < avs.length; i2++) beRows.push({ name: avs[i2].name, prob: avs[i2].prob, breakEvenProb: Math.min(1, avs[i2].prob * kStar) });

    return {
      ok: true, stack: stack, rho: rho,
      corr: corr, indep: indep,
      tailFattening: indep.pTwoOrMore > 0 ? corr.pTwoOrMore / indep.pTwoOrMore : null,
      allFattening: indep.pAll > 0 ? corr.pAll / indep.pAll : null,
      expectedLoss: corr.expectedLoss,
      expectedLossIndep: indep.expectedLoss,
      netApr: netApr,
      extraStakerApr: extra,
      worthIt: netApr > stack.lstBaseApr,
      breakEvenMultiple: kStar,
      breakEven: beRows,
      principal: principal,
      expectedLossBase: principal == null ? null : principal * corr.expectedLoss,
      var99Base: principal == null ? null : principal * corr.var99,
      extraBase: principal == null ? null : principal * extra
    };
  }

  /* ======================================================== the paper trade */

  /* The one place money moves, and it moves through the engine. Taking a
     liquidation is two fills and a gas charge: buy the seized collateral at
     the discount the protocol hands you, sell it into the pool at what the
     pool will actually pay, pay for the call. Nothing is assigned anywhere. */
  function take(r) {
    var lp = LP();
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || "there is nothing to take" };
    if (!lp || typeof lp.execFill !== "function") return { ok: false, reason: "the paper engine is not available" };
    if (typeof S === "undefined") return { ok: false, reason: "the account is not ready yet" };
    if (r.saleProceedsBase == null) return { ok: false, reason: "the sale could not be priced on the pool, so the profit is unknown and nothing is sent" };
    if (!(r.toLiquidator > 0) || !(r.debtRepaidBase > 0)) return { ok: false, reason: "nothing to seize at this price" };

    var sym = tradeSym(r.collKey);
    var acqPx = r.debtRepaidBase / r.toLiquidator;
    var salePx = r.saleProceedsBase / r.toLiquidator;
    if (!(acqPx > 0) || !(salePx > 0)) return { ok: false, reason: "a price came back missing, so nothing is sent" };

    var boughtOk = false, soldOk = false, gasPaid = 0;
    try { boughtOk = !!lp.execFill(S, 0, "buy", sym, "USDT", r.toLiquidator, acqPx, "lend", true); } catch (e) { boughtOk = false; }
    if (!boughtOk) return { ok: false, reason: "the repayment leg did not fill — check the USDT balance for " + usd(r.debtRepaidBase) };
    try { soldOk = !!lp.execFill(S, ammFeeRate(), "sell", sym, "USDT", r.toLiquidator, salePx, "lend", true); } catch (e) { soldOk = false; }
    if (r.gasBase > 0 && typeof lp.chargeNetwork === "function") {
      try { gasPaid = lp.chargeNetwork(S, "USDT", r.gasBase, "Lending desk · liquidationCall + swap back (gas at " + LIQ_GAS_MULTIPLE + "x a swap)") || 0; } catch (e) { gasPaid = 0; }
    }

    var entry = {
      t: C.now ? C.now() : 0, collKey: r.collKey, debtKey: r.debtKey, sym: sym,
      repaidBase: r.debtRepaidBase, seized: r.collateralSeized, toLiquidator: r.toLiquidator,
      acqPx: acqPx, salePx: salePx, proceedsBase: r.saleProceedsBase,
      gasBase: gasPaid, netBase: r.netProfitBase, closeFactor: r.closeFactor,
      hfBefore: r.health ? r.health.healthFactor : null,
      hfAfter: r.healthAfter ? r.healthAfter.healthFactor : null,
      soldOk: soldOk
    };
    push(entry);
    try { C.save(); } catch (e) {}
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.toast && C.toast(r.netProfitBase > 0 ? "good" : "bad", "Liquidation taken", usd(r.debtRepaidBase) + " repaid · " + usd(r.netProfitBase) + " net after the swap back and gas"); } catch (e) {}
    try { C.xp && C.xp("lend.liq", 20, "Took a liquidation — repaid the debt, ate the impact on the way out"); } catch (e) {}
    return { ok: true, entry: entry, soldOk: soldOk };
  }

  /* the reserve tickers are the wrapped ones; the app prices the underlying */
  function tradeSym(k) {
    if (k === "WETH" || k === "wstETH") return "ETH";
    if (k === "WBTC") return "BTC";
    return k;
  }

  function livePrice(k) {
    var r = res(k);
    try {
      var c = C.coin(tradeSym(k));
      var v = c && +c.price;
      if (v > 0) return v;
    } catch (e) {}
    if (r && r.stable) return 1;
    return null;
  }

  /* ------------------------------------------------------------ state + log */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.lend) X.lend = {};
    if (!X.lend.log) X.lend.log = [];
    return X.lend;
  }
  function log() { var b = bucket(); return b ? b.log.slice() : []; }
  function push(e) { var b = bucket(); if (!b) return; b.log.unshift(e); if (b.log.length > 30) b.log.length = 30; }

  var DEF = {
    market: { key: "WETH", u: 85, days: 365, principal: 1000000 },
    pos: { c1: "WETH", a1: 10, p1: 0, c2: "", a2: 0, p2: 0, d1: "USDC", da: 15000, dp: 1, emode: "none", bk: "USDC", ba: 5000, supplied: 0, borrowed: 0 },
    liq: { px: 1780, tvl: 8000000, range: 0 },
    casc: { key: "WETH", price0: 3000, tvl: 150000000, range: 0, drop: 22, steps: 18, n: 10, top: 2.40, bottom: 1.05, size: 2000000 },
    rst: {
      principal: 100000, base: 3.0, rho: 50,
      a: [
        { name: "AVS 1 — a data-availability layer", fee: 2.4, com: 10, sev: 5, prob: 1.0 },
        { name: "AVS 2 — an oracle network", fee: 1.8, com: 10, sev: 10, prob: 0.6 },
        { name: "AVS 3 — a bridge attestation set", fee: 1.2, com: 10, sev: 25, prob: 0.3 }
      ]
    }
  };

  function cfg(section, patch) {
    var b = bucket();
    var base = DEF[section];
    if (!b) return patch ? merge(base, patch) : merge(base, {});
    if (!b[section]) b[section] = merge(base, {});
    if (patch) { b[section] = merge(b[section], patch); try { C.save(); } catch (e) {} }
    return b[section];
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ------------------------------------------------------------- formatting */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fx(n, d) { return (n == null || !isFinite(n)) ? "—" : n.toFixed(d == null ? 2 : d); }
  function usd(n) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money) return C.money(n); } catch (e) {}
    return "$" + n.toFixed(2);
  }
  function big(n) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.big) return C.big(n); } catch (e) {}
    return String(Math.round(n));
  }
  function pctOf(f, d) { return (f == null || !isFinite(f)) ? "—" : (f * 100).toFixed(d == null ? 2 : d) + "%"; }
  function bps(n, d) { return (n == null || !isFinite(n)) ? "—" : n.toFixed(d == null ? 2 : d) + " bp"; }
  function hfText(hf) {
    if (hf == null) return "—";
    if (!isFinite(hf)) return "no debt";
    return hf.toFixed(4);
  }
  function hfCls(hf) {
    if (hf == null || !isFinite(hf)) return "ok";
    if (hf < 1) return "bad";
    if (hf < 1.15) return "warn";
    return "ok";
  }
  function when(t) {
    if (!(t > 0)) return "—";
    try { return new Date(t).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; }
  }
  function num(id, dflt) { var el = document.getElementById(id); if (!el) return dflt; var v = parseFloat(el.value); return isFinite(v) ? v : dflt; }
  function str(id, dflt) { var el = document.getElementById(id); return el ? String(el.value) : dflt; }

  function f(label, inner, note) {
    return '<label class="lnd-f"><span class="lnd-fl">' + esc(label) + '</span>' + inner +
      (note ? '<span class="lnd-fn">' + esc(note) + '</span>' : "") + '</label>';
  }
  function inp(id, v, step) { return '<input id="' + id + '" class="dl-inp" type="number" step="' + (step || "any") + '" value="' + esc(v) + '" aria-label="' + id + '">'; }
  function sel(id, list, cur, blank) {
    var h = '<select id="' + id + '" class="dl-inp" aria-label="' + id + '">', i;
    if (blank) h += '<option value=""' + (cur ? "" : " selected") + '>' + esc(blank) + '</option>';
    for (i = 0; i < list.length; i++) {
      var k = list[i], lab = RESERVES[k] ? RESERVES[k].label : k;
      h += '<option value="' + esc(k) + '"' + (k === cur ? " selected" : "") + '>' + esc(lab) + '</option>';
    }
    return h + '</select>';
  }
  function kv(k, v, cls) { return '<div class="lnd-kv"><span>' + esc(k) + '</span><b class="' + (cls || "") + '">' + v + '</b></div>'; }

  /* ================================================================== panes */

  function paneFor(t) {
    if (t === "position") return panePosition();
    if (t === "liq") return paneLiquidation();
    if (t === "restake") return paneRestake();
    if (t === "method") return paneMethod();
    return paneMarket();
  }

  /* ---------------------------------------------------------------- market */

  function paneMarket() {
    var m = cfg("market"), r = res(m.key) || res("WETH");
    var U = Math.min(1, Math.max(0, (+m.u || 0) / 100));
    var br = borrowRate(r, U), sr = supplyRate(br, U, r.rf);
    var h = ('<div class="lnd-note">' + window.DLI18N.t("55-lending.59a055a5b0dd") + '</div>');

    h += '<div class="dl-2 lnd-form">';
    h += f("Reserve", sel("lndMk", RES_ORDER, r.sym));
    h += f("Utilisation %", inp("lndMu", m.u, "0.1"), "U = totalDebt / (availableLiquidity + totalDebt)");
    h += f("Horizon (days)", inp("lndMd", m.days, "1"));
    h += f("Debt outstanding", inp("lndMp", m.principal, "1000"), "for the accrual table below");
    h += ('</div><div class="lnd-actions"><button class="dl-b pri" id="lndMgo">' + window.DLI18N.t("55-lending.403aa4bb5e0e") + '</button></div>');

    h += '<div class="lnd-grid3">' +
      kv("Utilisation", pctOf(U)) +
      kv("Variable borrow APR", pctOf(br), U > r.uOpt ? "bad" : "") +
      kv("Supply APY (linear)", pctOf(sr), "ok") +
      kv("Optimal utilisation", pctOf(r.uOpt)) +
      kv("Reserve factor", pctOf(r.rf, 0)) +
      kv("Past the kink by", U > r.uOpt ? pctOf(U - r.uOpt) : "—", U > r.uOpt ? "bad" : "") +
      '</div>';

    var pts = [0, 0.25, 0.5, r.uOpt, 0.95, 0.99, 1], i;
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.07a34748227d") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.a25513c7e0f6") + '</th><th class="r">' + window.DLI18N.t("55-lending.7b1ba7062283") + '</th><th class="r">' + window.DLI18N.t("55-lending.ab3bbe1a4211") + '</th><th>' + window.DLI18N.t("55-lending.52656e8104ee") + '</th></tr></thead><tbody>');
    for (i = 0; i < pts.length; i++) {
      var row = curveRow(r, pts[i]);
      h += '<tr' + (row.kink ? ' data-kink="1"' : "") + '><td>' + pctOf(pts[i], 1) + '</td><td class="r">' + pctOf(row.borrow) + '</td><td class="r">' + pctOf(row.supply) + '</td><td>' +
        (row.kink ? "the kink" : pts[i] < r.uOpt ? "base + slope1 · U/U_opt" : "base + slope1 + slope2 · (U − U_opt)/(1 − U_opt)") + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="dl-formula">' + window.DLI18N.t("55-lending.bb40838accc3") + '') + pctOf(r.base, 1) + ' + ' + pctOf(r.s1, 1) + ' · U/' + pctOf(r.uOpt, 0) + '   below the kink\n' +
      'borrow = ' + pctOf(r.base, 1) + ' + ' + pctOf(r.s1, 1) + ' + ' + pctOf(r.s2, 0) + ' · (U − ' + pctOf(r.uOpt, 0) + ')/(1 − ' + pctOf(r.uOpt, 0) + ')   above it\n' +
      'supply = borrow · U · (1 − ' + pctOf(r.rf, 0) + ')</div>';

    /* the two indices */
    var secs = Math.max(1, Math.round((+m.days || 365) * 86400));
    var ac = accrual(br, secs, +m.principal || 0);
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.10760fb4b639") + '</div>');
    if (!ac) h += ('<div class="dl-empty">' + window.DLI18N.t("55-lending.5f6c320140d5") + '</div>');
    else {
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.39c3be1198a2") + '</th><th class="r">' + window.DLI18N.t("55-lending.964a9c060652") + '</th><th class="r">' + window.DLI18N.t("55-lending.ccdd65cb245e") + '') + usd(+m.principal || 0) + ('</th><th>' + window.DLI18N.t("55-lending.1f36becc3aa7") + '</th></tr></thead><tbody>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.6536a33f2ba3") + '</td><td class="r">') + ac.linear.toFixed(10) + '</td><td class="r">' + usd(ac.interestLinear) + ('</td><td>' + window.DLI18N.t("55-lending.d6ccc6de5fdf") + '</td></tr>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.187e0a7e54de") + '</td><td class="r">') + ac.binomial.toFixed(10) + '</td><td class="r">' + usd(ac.interestBinomial) + ('</td><td>' + window.DLI18N.t("55-lending.f3ff06649f77") + '</td></tr>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.6908541bdd05") + '</td><td class="r">') + ac.exact.toFixed(10) + '</td><td class="r">' + usd(ac.interestExact) + ('</td><td>' + window.DLI18N.t("55-lending.96a082c8128b") + '</td></tr>') +
        '</tbody></table></div>';
      h += '<div class="lnd-grid3">' +
        kv("Binomial vs exact", bps(ac.binomialVsExactBps, 4) + " of the factor") +
        kv("Undercharged over the horizon", usd(ac.undercharge), "bad") +
        kv("Per $1m of debt", usd(ac.binomialVsExactPerMillion), "bad") +
        '</div>';
      h += ('<div class="lnd-note">' + window.DLI18N.t("55-lending.a1062e36d2bb") + '') + pctOf(br) + ' over ' + fx(+m.days || 365, 0) + ' days the gap is ' + bps(ac.binomialVsExactBps, 4) + ('' + window.DLI18N.t("55-lending.ba6e3c9da9d1") + '</div>');
    }

    /* the parameter table */
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.8ac657c92ea3") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr>') +
      ('<th>' + window.DLI18N.t("55-lending.5ae6f30c297b") + '</th><th class="r">' + window.DLI18N.t("55-lending.9b6f7ddf7cfd") + '</th><th class="r">' + window.DLI18N.t("55-lending.92759b56b607") + '</th><th class="r">' + window.DLI18N.t("55-lending.d587622d277c") + '</th><th class="r">' + window.DLI18N.t("55-lending.3d036e176eb4") + '</th><th class="r">' + window.DLI18N.t("55-lending.25b8a65515a8") + '</th><th class="r">' + window.DLI18N.t("55-lending.f7bcfeca825e") + '</th><th class="r">' + window.DLI18N.t("55-lending.8ba08d954d5f") + '</th><th>' + window.DLI18N.t("55-lending.f38d9950af4f") + '</th></tr></thead><tbody>');
    for (i = 0; i < RES_ORDER.length; i++) {
      var rr = RESERVES[RES_ORDER[i]];
      var flags = [];
      if (rr.silo) flags.push("siloed");
      if (rr.ceiling > 0) flags.push("isolated · ceiling " + usd(rr.ceiling));
      if (rr.inIso) flags.push("borrowable in isolation");
      if (rr.emode) flags.push("e-mode: " + rr.emode);
      if (rr.borrowCap === 0) flags.push("supply-only");
      h += '<tr' + (rr.pinned ? "" : ' data-rep="1"') + '><td>' + esc(rr.label) + (rr.pinned ? "" : ('<span class="lnd-flag">' + window.DLI18N.t("55-lending.482a37dd98d9") + '</span>')) + '</td>' +
        '<td class="r">' + pctOf(rr.ltv, 1) + '</td><td class="r">' + pctOf(rr.lt, 1) + '</td><td class="r">' + pctOf(rr.bonus, 1) + '</td>' +
        '<td class="r">' + pctOf(rr.rf, 0) + '</td><td class="r">' + pctOf(rr.uOpt, 0) + '</td><td class="r">' + pctOf(rr.s1, 1) + '</td><td class="r">' + pctOf(rr.s2, 0) + '</td>' +
        '<td>' + esc(flags.join(" · ") || "—") + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="lnd-strip">' + esc(SNAPSHOT) + ('' + window.DLI18N.t("55-lending.538072d830fb") + '<b>' + window.DLI18N.t("55-lending.482a37dd98d9") + '</b>: ') + esc(REPRESENTATIVE.LINK) + " " + esc(REPRESENTATIVE.RPL) + ('' + window.DLI18N.t("55-lending.f63799999898") + '</div>');
    return h;
  }

  /* -------------------------------------------------------------- position */

  function readPos(pc) {
    var p = pc || cfg("pos");
    var coll = [];
    if (p.c1 && p.a1 > 0) coll.push({ key: p.c1, amount: +p.a1, price: +p.p1 > 0 ? +p.p1 : livePrice(p.c1), enabled: true });
    if (p.c2 && p.a2 > 0) coll.push({ key: p.c2, amount: +p.a2, price: +p.p2 > 0 ? +p.p2 : livePrice(p.c2), enabled: true });
    var debt = [];
    if (p.d1 && p.da > 0) debt.push({ key: p.d1, amount: +p.da, price: +p.dp > 0 ? +p.dp : livePrice(p.d1) });
    return { collateral: coll, debt: debt, emode: p.emode || "none" };
  }

  function panePosition() {
    var p = cfg("pos"), i;
    var h = ('<div class="lnd-note">' + window.DLI18N.t("55-lending.99f41993ebae") + '</div>');

    h += '<div class="dl-2 lnd-form">';
    h += f("Collateral 1", sel("lndC1", RES_ORDER, p.c1));
    h += f("Amount", inp("lndA1", p.a1));
    h += f("Price (0 = live)", inp("lndP1", p.p1), livePrice(p.c1) ? "live " + usd(livePrice(p.c1)) : "no live price for this one");
    h += f("Collateral 2 (optional)", sel("lndC2", RES_ORDER, p.c2, "none"));
    h += f("Amount", inp("lndA2", p.a2));
    h += f("Price (0 = live)", inp("lndP2", p.p2));
    h += f("Debt asset", sel("lndD1", RES_ORDER, p.d1));
    h += f("Debt amount", inp("lndDA", p.da));
    h += f("Debt price (0 = live)", inp("lndDP", p.dp));
    h += f("E-mode", (function () {
      var s = ('<select id="lndEm" class="dl-inp" aria-label="' + window.DLI18N.t("55-lending.8809134ac48f") + '">'), j;
      for (j = 0; j < EMODE_ORDER.length; j++) s += '<option value="' + EMODE_ORDER[j] + '"' + (EMODE_ORDER[j] === p.emode ? " selected" : "") + '>' + esc(EMODES[EMODE_ORDER[j]].label) + '</option>';
      return s + '</select>';
    })());
    h += f("Borrow next", sel("lndBK", RES_ORDER, p.bk));
    h += f("Borrow amount (units)", inp("lndBA", p.ba));
    h += f("Already borrowed from that reserve", inp("lndBB", p.borrowed), "an INPUT, not a feed — it is what the borrow cap bites on");
    h += ('</div><div class="lnd-actions"><button class="dl-b pri" id="lndPgo">' + window.DLI18N.t("55-lending.403aa4bb5e0e") + '</button></div>');

    var pos = readPos(p), hh = health(pos);
    if (!hh || hh.collateralBase == null) return h + ('<div class="dl-empty">' + window.DLI18N.t("55-lending.5644617b038e") + '</div>');

    var cl = hfCls(hh.healthFactor);
    h += '<div class="lnd-grid3">' +
      kv("Health factor", hfText(hh.healthFactor), cl) +
      kv("Collateral", usd(hh.collateralBase)) +
      kv("Debt", usd(hh.debtBase)) +
      kv("Weighted LTV", pctOf(hh.weightedLtv)) +
      kv("Weighted liquidation threshold", pctOf(hh.weightedThreshold)) +
      kv("The gap you are trading on", hh.weightedLtv == null ? "—" : pctOf(hh.weightedThreshold - hh.weightedLtv)) +
      kv("Max borrow (LTV limit)", usd(hh.maxBorrowBase)) +
      kv("Still borrowable", usd(hh.availableBorrowBase)) +
      kv("Borrowing power used", pctOf(hh.powerUsed)) +
      '</div>';

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.3376dff9692d") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr>') +
      ('<th>' + window.DLI18N.t("55-lending.80d298c9f240") + '</th><th class="r">' + window.DLI18N.t("55-lending.49e96d7cdf58") + '</th><th class="r">' + window.DLI18N.t("55-lending.93c91c851e7a") + '</th><th class="r">' + window.DLI18N.t("55-lending.9b6f7ddf7cfd") + '</th><th class="r">' + window.DLI18N.t("55-lending.0da627ada476") + '</th><th class="r">' + window.DLI18N.t("55-lending.c38903cdcc99") + '</th><th class="r">' + window.DLI18N.t("55-lending.c8af9ae37a48") + '</th><th>' + window.DLI18N.t("55-lending.aaafd425e178") + '</th></tr></thead><tbody>');
    for (i = 0; i < hh.collateral.length; i++) {
      var c = hh.collateral[i];
      h += '<tr><td>' + esc(c.key) + '</td><td class="r">' + fx(c.amount, 4) + '</td><td class="r">' + usd(c.price) + '</td>' +
        '<td class="r">' + pctOf(c.ltv, 1) + '</td><td class="r">' + pctOf(c.lt, 1) + '</td>' +
        '<td class="r">' + (c.liqPrice == null ? ('<span class="lnd-dim">' + window.DLI18N.t("55-lending.f406b4952a19") + '</span>') : usd(c.liqPrice)) + '</td>' +
        '<td class="r">' + (c.liqDropPct == null ? "—" : "−" + fx(c.liqDropPct, 1) + "%") + '</td>' +
        '<td>' + esc(c.source) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="lnd-note">' + window.DLI18N.t("55-lending.3d57ce0c6557") + '</div>');

    var con = constraints(pos, { borrowKey: p.bk, borrowAmount: +p.ba || 0, borrowPrice: livePrice(p.bk) || (res(p.bk) && res(p.bk).stable ? 1 : 0), reserveBorrowed: +p.borrowed || 0, isolatedDebtBase: 0 });
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.2b8891a543ef") + '</div><ul class="lnd-cons">');
    for (i = 0; i < con.rows.length; i++) {
      h += '<li data-ok="' + (con.rows[i].ok ? "1" : "0") + '"><b>' + esc(con.rows[i].label) + '</b> — ' + esc(con.rows[i].detail) + '</li>';
    }
    h += '</ul>';
    h += '<div class="lnd-grid3">' + kv("Binding constraint", esc(con.binding), con.allOk ? "" : "bad") +
      kv("Maximum borrow after every constraint", usd(con.maxBorrowBase)) +
      kv("LTV limit alone would allow", usd(hh.availableBorrowBase)) + '</div>';
    return h;
  }

  /* ----------------------------------------------------------- liquidation */

  var LASTLIQ = null;

  function paneLiquidation() {
    var p = cfg("pos"), L = cfg("liq"), K = cfg("casc"), i;
    var h = ('<div class="lnd-note">' + window.DLI18N.t("55-lending.39c8118512e6") + '</div>');

    /* --- the single call --- */
    var pos = readPos(p);
    if (pos.collateral.length) {
      pos = clonePos(pos);
      if (+L.px > 0) pos.collateral[0].price = +L.px;
    }
    h += '<div class="dl-2 lnd-form">';
    h += f("Price of " + (p.c1 || "collateral") + " now", inp("lndLpx", L.px), "the position comes from the Position tab; this is the price that puts it under");
    h += f("Pool value for the sale back (USD)", inp("lndLtvl", L.tvl, "10000"), "the app's own modelled curve, not a measured book");
    h += f("Concentrated range ±% (0 = full range)", inp("lndLrng", L.range, "1"));
    h += ('</div><div class="lnd-actions"><button class="dl-b pri" id="lndLgo">' + window.DLI18N.t("55-lending.c325e07b3069") + '</button></div>');

    var pool = poolOf(+L.px > 0 ? +L.px : (pos.collateral[0] ? pos.collateral[0].price : 0), +L.tvl || 0, +L.range || 0);
    var r = pos.collateral.length && pos.debt.length ? liquidate(pos, pos.collateral[0].key, pos.debt[0].key, pool, {}) : null;
    LASTLIQ = r && r.ok ? r : null;

    if (!r) h += ('<div class="dl-empty">' + window.DLI18N.t("55-lending.a676da1c01f6") + '</div>');
    else if (!r.ok) h += '<div class="lnd-verdict">' + esc(r.reason) + '</div>';
    else {
      h += '<div class="lnd-grid3">' +
        kv("Health factor", hfText(r.health.healthFactor), hfCls(r.health.healthFactor)) +
        kv("Close factor", pctOf(r.closeFactor, 0), r.closeFactor >= 1 ? "bad" : "") +
        kv("Debt repaid", usd(r.debtRepaidBase)) +
        kv("Collateral seized", fx(r.collateralSeized, 6) + " " + esc(r.collKey)) +
        kv("Of which the bonus", fx(r.bonusCollateral, 6) + " " + esc(r.collKey)) +
        kv("Protocol's cut of the bonus", fx(r.protocolFeeCollateral, 6) + " " + esc(r.collKey)) +
        '</div>';
      h += '<div class="lnd-verdict">' + esc(r.closeFactorReason) + '.</div>';
      h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.5d83b7125c05") + '</div>');
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.7c94ee113e1b") + '</th><th class="r">' + window.DLI18N.t("55-lending.49e96d7cdf58") + '</th><th>' + window.DLI18N.t("55-lending.d8da2c49df39") + '</th></tr></thead><tbody>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.ae906dfd938e") + '</td><td class="r">−') + usd(r.debtRepaidBase) + '</td><td>' + esc(r.debtKey) + ' at ' + usd(r.debtPrice) + '</td></tr>' +
        ('<tr><td>' + window.DLI18N.t("55-lending.a188c6c0f7b5") + '</td><td class="r">') + fx(r.toLiquidator, 6) + ' ' + esc(r.collKey) + ('</td><td>' + window.DLI18N.t("55-lending.476158242ba8") + '') + usd(r.grossBase) + ' at the mark — a gross margin of ' + usd(r.grossMarginBase) + ', which is the ' + pctOf(r.bonus, 1) + ' bonus less the protocol\'s ' + pctOf(r.protFee, 0) + ('' + window.DLI18N.t("55-lending.9fba6ba2996d") + '</td></tr>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.49caac69ff72") + '</td><td class="r">') + (r.saleProceedsBase == null ? ('<span class="lnd-dim">' + window.DLI18N.t("55-lending.5805ffba6946") + '</span>') : "+" + usd(r.saleProceedsBase)) + '</td><td>' + (r.saleImpactBps == null ? "no pool, so no proceeds — the figure stays missing" : bps(r.saleImpactBps, 1) + ' of price impact against a ' + usd(+L.tvl || 0) + ' pool') + '</td></tr>' +
        ('<tr><td>' + window.DLI18N.t("55-lending.52195e8616df") + '</td><td class="r">') + (r.swapFeeBase == null ? "—" : "−" + usd(r.swapFeeBase)) + '</td><td>' + pctOf(ammFeeRate(), 2) + ('' + window.DLI18N.t("55-lending.ef2b5c474d78") + '</td></tr>') +
        ('<tr><td>' + window.DLI18N.t("55-lending.e23a445d0fa7") + '</td><td class="r">') + (r.gasBase == null ? "—" : "−" + usd(r.gasBase)) + ('</td><td>' + window.DLI18N.t("55-lending.4058946b0234") + '') + LIQ_GAS_MULTIPLE + ('' + window.DLI18N.t("55-lending.961ecd9d083b") + '</td></tr>') +
        ('<tr data-net="1"><td>' + window.DLI18N.t("55-lending.660fb2c41d02") + '</td><td class="r">') + usd(r.netProfitBase) + '</td><td>' + (r.netProfitPct == null ? "" : fx(r.netProfitPct, 2) + '% of what was repaid') + '</td></tr>' +
        '</tbody></table></div>';
      h += '<div class="lnd-grid3">' +
        kv("Health factor after", hfText(r.healthAfter && r.healthAfter.healthFactor), hfCls(r.healthAfter && r.healthAfter.healthFactor)) +
        kv("Left healthy?", r.healthyAfter ? "yes" : "no — it can be taken again", r.healthyAfter ? "ok" : "bad") +
        kv("Price after the sale", r.priceAfterSale == null ? "—" : usd(r.priceAfterSale)) +
        '</div>';
      h += ('<div class="lnd-actions"><button class="dl-b pri" id="lndTake">' + window.DLI18N.t("55-lending.39740975fd86") + '</button><span class="lnd-sendnote">' + window.DLI18N.t("55-lending.6923fa600a02") + '</span></div>');
    }

    /* --- the cascade --- */
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.5592a60288cd") + '</div>');
    h += ('<div class="lnd-note">' + window.DLI18N.t("55-lending.296e42df69d9") + '</div>');
    h += '<div class="dl-2 lnd-form">';
    h += f("Collateral", sel("lndKk", RES_ORDER, K.key));
    h += f("Starting price", inp("lndKp", K.price0));
    h += f("Pool value (USD)", inp("lndKtvl", K.tvl, "10000"));
    h += f("Exogenous drawdown %", inp("lndKd", K.drop, "1"));
    h += f("Steps in the path", inp("lndKs", K.steps, "1"));
    h += f("Positions", inp("lndKn", K.n, "1"));
    h += f("Health factor of the safest", inp("lndKt", K.top, "0.01"));
    h += f("Health factor of the thinnest", inp("lndKb", K.bottom, "0.01"));
    h += f("Debt per position (USD)", inp("lndKsz", K.size, "10000"));
    h += ('</div><div class="lnd-actions"><button class="dl-b pri" id="lndKgo">' + window.DLI18N.t("55-lending.e80c41f6290b") + '</button></div>');

    var cas = cascade(buildCascadeCfg(K));
    if (!cas || !cas.ok) h += '<div class="dl-empty">' + esc((cas && cas.reason) || "nothing to cascade") + '</div>';
    else {
      h += '<div class="lnd-grid3">' +
        kv("Exogenous drawdown", "−" + fx(cas.exogenousDrawdownPct, 2) + "%") +
        kv("Total drawdown", "−" + fx(cas.totalDrawdownPct, 2) + "%", "bad") +
        kv("Reflexive, caused by the selling", "−" + fx(cas.reflexiveDrawdownPct, 2) + "%", "bad") +
        kv("Cumulative impact vs the exogenous path", bps(cas.cumulativeImpactBps, 0)) +
        kv("Positions hit", cas.positionsHit + " of " + cas.positions.length) +
        kv("Liquidation calls", String(cas.liquidations)) +
        kv("Collateral sold", fx(cas.collateralSold, 4) + " " + esc(cas.collKey)) +
        kv("Sold for", usd(cas.collateralSoldBase)) +
        kv("Share of the fall that is reflexive", pctOf(cas.reflexiveShareOfFall)) +
        '</div>';
      h += '<div class="lnd-verdict">' + esc(cas.stopReason) + '.</div>';
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.8e6a6cca7aae") + '</th><th class="r">' + window.DLI18N.t("55-lending.038884790d80") + '</th><th class="r">' + window.DLI18N.t("55-lending.22fc50e98b00") + '</th><th class="r">' + window.DLI18N.t("55-lending.cb129306bc6f") + '</th><th class="r">' + window.DLI18N.t("55-lending.7b444f34b2e6") + '</th><th class="r">' + window.DLI18N.t("55-lending.b870b1b48724") + '</th></tr></thead><tbody>');
      for (i = 0; i < cas.steps.length; i++) {
        var s = cas.steps[i];
        h += '<tr' + (s.hits ? ' data-hit="1"' : "") + '><td>' + s.step + '</td><td class="r">' + usd(s.exogenous) + '</td><td class="r">' + usd(s.price) + '</td>' +
          '<td class="r">' + bps(s.reflexiveBps, 0) + '</td><td class="r">' + s.hits + '</td><td class="r">' + (s.sold > 0 ? fx(s.sold, 4) : "—") + '</td></tr>';
      }
      h += '</tbody></table></div>';
      if (cas.events.length) {
        h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.0a983b5a289d") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.8e6a6cca7aae") + '</th><th>' + window.DLI18N.t("55-lending.6d031af10da7") + '</th><th class="r">' + window.DLI18N.t("55-lending.669f4259d89b") + '</th><th class="r">' + window.DLI18N.t("55-lending.7d9eb7acb13e") + '</th><th class="r">' + window.DLI18N.t("55-lending.524a883758e6") + '</th><th class="r">' + window.DLI18N.t("55-lending.ee10599c247a") + '</th><th class="r">' + window.DLI18N.t("55-lending.d1f23f0d1361") + '</th><th class="r">' + window.DLI18N.t("55-lending.8c62edd3c91f") + '</th></tr></thead><tbody>');
        for (i = 0; i < Math.min(cas.events.length, 40); i++) {
          var e = cas.events[i];
          h += '<tr><td>' + e.step + '</td><td>' + esc(e.label) + '</td><td class="r">' + fx(e.hfBefore, 4) + '</td><td class="r">' + pctOf(e.closeFactor, 0) + '</td>' +
            '<td class="r">' + usd(e.repaid) + '</td><td class="r">' + fx(e.seized, 4) + '</td><td class="r">' + bps(e.impactBps, 1) + '</td><td class="r">' + usd(e.priceAfter) + '</td></tr>';
        }
        h += '</tbody></table></div>';
        if (cas.events.length > 40) h += '<div class="lnd-note">' + (cas.events.length - 40) + ('' + window.DLI18N.t("55-lending.1f729e98a05a") + '</div>');
      }
      h += ('<div class="lnd-strip">' + window.DLI18N.t("55-lending.fea0cae317d8") + '') + usd(+K.tvl || 0) + ('' + window.DLI18N.t("55-lending.4c3872b12a2d") + '</div>');
    }

    var lg = log();
    if (lg.length) {
      h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.43ba2807d5d4") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("55-lending.989da04b0aaa") + '</th><th class="r">' + window.DLI18N.t("55-lending.524a883758e6") + '</th><th class="r">' + window.DLI18N.t("55-lending.5921b6d43c59") + '</th><th class="r">' + window.DLI18N.t("55-lending.660fb2c41d02") + '</th><th class="r">' + window.DLI18N.t("55-lending.e575ae508d88") + '</th></tr></thead><tbody>');
      for (i = 0; i < lg.length; i++) {
        h += '<tr><td>' + esc(when(lg[i].t)) + '</td><td>' + esc(lg[i].collKey + " / " + lg[i].debtKey) + '</td><td class="r">' + usd(lg[i].repaidBase) + '</td>' +
          '<td class="r">' + usd(lg[i].proceedsBase) + '</td><td class="r">' + usd(lg[i].netBase) + '</td><td class="r">' + hfText(lg[i].hfBefore) + " → " + hfText(lg[i].hfAfter) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    }
    return h;
  }

  function buildCascadeCfg(K) {
    var n = Math.max(1, Math.min(60, Math.round(+K.n || 1)));
    var top = +K.top || 1.3, bot = +K.bottom || 1.02, price0 = +K.price0 || 0, size = +K.size || 0;
    var r = res(K.key) || res("WETH"), lt = r.lt, list = [], i;
    for (i = 0; i < n; i++) {
      var hf = n === 1 ? bot : bot + (top - bot) * (i / (n - 1));
      var coll = price0 > 0 && lt > 0 ? hf * size / (price0 * lt) : 0;
      list.push({ label: "HF " + hf.toFixed(3), collateral: coll, debt: size });
    }
    return { collKey: K.key, debtKey: "USDC", price0: price0, tvlUSD: +K.tvl || 0, rangePct: +K.range || 0, dropPct: +K.drop || 0, steps: +K.steps || 12, positions: list, emode: "none" };
  }

  /* -------------------------------------------------------------- restake */

  function paneRestake() {
    var R = cfg("rst"), i;
    var h = ('<div class="lnd-note">' + window.DLI18N.t("55-lending.fba878aee495") + '</div>');

    h += '<div class="dl-2 lnd-form">';
    h += f("Restaked principal (USD)", inp("lndRp", R.principal, "1000"));
    h += f("LST base yield % APR", inp("lndRb", R.base, "0.1"));
    h += f("Slashing correlation ρ %", inp("lndRrho", R.rho, "1"), "0 = the services fail independently. 100 = one operator fault takes every service at once.");
    h += '</div>';

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.2ec679233d50") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr>') +
      ('<th>' + window.DLI18N.t("55-lending.d677190e0a99") + '</th><th class="r">' + window.DLI18N.t("55-lending.315ca1a6fead") + '</th><th class="r">' + window.DLI18N.t("55-lending.8eedb14c58de") + '</th><th class="r">' + window.DLI18N.t("55-lending.8f90cce2c059") + '</th><th class="r">' + window.DLI18N.t("55-lending.8919120433f9") + '</th></tr></thead><tbody>');
    for (i = 0; i < R.a.length; i++) {
      h += '<tr><td>' + esc(R.a[i].name) + '</td>' +
        '<td class="r">' + inp("lndRf" + i, R.a[i].fee, "0.1") + '</td>' +
        '<td class="r">' + inp("lndRc" + i, R.a[i].com, "1") + '</td>' +
        '<td class="r">' + inp("lndRs" + i, R.a[i].sev, "1") + '</td>' +
        '<td class="r">' + inp("lndRq" + i, R.a[i].prob, "0.01") + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="lnd-actions"><button class="dl-b pri" id="lndRgo">' + window.DLI18N.t("55-lending.403aa4bb5e0e") + '</button></div>');

    var out = restake(restakeCfg(R));
    if (!out || !out.ok) return h + '<div class="dl-empty">' + esc((out && out.reason) || "nothing to compute") + '</div>';
    var st = out.stack;

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.61a51e2d8d66") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr>') +
      ('<th>' + window.DLI18N.t("55-lending.d677190e0a99") + '</th><th class="r">' + window.DLI18N.t("55-lending.2ad72e45502c") + '</th><th class="r">' + window.DLI18N.t("55-lending.8ba5b0f8403a") + '</th><th class="r">' + window.DLI18N.t("55-lending.86679ce65a60") + '</th><th class="r">' + window.DLI18N.t("55-lending.5e9f98120dbe") + '</th><th class="r">' + window.DLI18N.t("55-lending.80f172a11d9f") + '</th></tr></thead><tbody>');
    for (i = 0; i < st.rows.length; i++) {
      h += '<tr><td>' + esc(st.rows[i].name) + '</td><td class="r">' + pctOf(st.rows[i].feeApr) + '</td>' +
        '<td class="r">' + pctOf(st.rows[i].operatorApr) + '</td><td class="r">' + pctOf(st.rows[i].stakerApr) + '</td>' +
        '<td class="r">' + pctOf(st.rows[i].slashPct, 1) + '</td><td class="r">' + pctOf(st.rows[i].prob, 3) + '</td></tr>';
    }
    h += ('<tr data-net="1"><td>' + window.DLI18N.t("55-lending.659d545e9598") + '') + pctOf(st.lstBaseApr) + '</td><td class="r">' + pctOf(st.grossAvsApr) + '</td>' +
      '<td class="r">' + pctOf(st.operatorApr) + '</td><td class="r">' + pctOf(st.extraStakerApr) + '</td><td class="r">—</td><td class="r">—</td></tr>';
    h += '</tbody></table></div>';

    h += '<div class="lnd-grid3">' +
      kv("Effective yield", pctOf(st.effectiveApr), "ok") +
      kv("Extra over just holding the LST", pctOf(st.extraStakerApr), "ok") +
      kv("Expected slashing loss per year", pctOf(out.expectedLoss), "bad") +
      kv("Net of expected loss", pctOf(out.netApr), out.worthIt ? "ok" : "bad") +
      kv("On " + usd(out.principal) + ", extra", usd(out.extraBase), "ok") +
      kv("On " + usd(out.principal) + ", expected loss", usd(out.expectedLossBase), "bad") +
      '</div>';

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.258519e31a6b") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.ebf940f2b3ea") + '</th><th class="r">' + window.DLI18N.t("55-lending.9dfeedd3af21") + '</th><th class="r">' + window.DLI18N.t("55-lending.652306c49029") + '') + pctOf(out.rho, 0) + ('</th><th>' + window.DLI18N.t("55-lending.eed88f3aa1ed") + '</th></tr></thead><tbody>') +
      ('<tr><td>' + window.DLI18N.t("55-lending.243e17352739") + '</td><td class="r">') + pctOf(out.expectedLossIndep, 3) + '</td><td class="r">' + pctOf(out.expectedLoss, 3) + ('</td><td>' + window.DLI18N.t("55-lending.05e0c38b4fbf") + '</td></tr>') +
      ('<tr><td>' + window.DLI18N.t("55-lending.8eb03f49ed8d") + '</td><td class="r">') + pctOf(out.indep.pAny, 3) + '</td><td class="r">' + pctOf(out.corr.pAny, 3) + ('</td><td>' + window.DLI18N.t("55-lending.230487c2bde3") + '</td></tr>') +
      ('<tr><td>' + window.DLI18N.t("55-lending.e13015040ac8") + '</td><td class="r">') + pctOf(out.indep.pTwoOrMore, 4) + '</td><td class="r">' + pctOf(out.corr.pTwoOrMore, 4) + '</td><td>' + (out.tailFattening == null ? "—" : fx(out.tailFattening, 1) + "× fatter") + '</td></tr>' +
      ('<tr><td>' + window.DLI18N.t("55-lending.d00e85d47deb") + '</td><td class="r">') + pctOf(out.indep.pAll, 6) + '</td><td class="r">' + pctOf(out.corr.pAll, 6) + '</td><td>' + (out.allFattening == null ? "—" : fx(out.allFattening, 0) + "× the independent number") + '</td></tr>' +
      ('<tr><td>' + window.DLI18N.t("55-lending.a6ceb666344b") + '</td><td class="r">') + pctOf(out.indep.var99, 2) + '</td><td class="r">' + pctOf(out.corr.var99, 2) + '</td><td>' + usd(out.var99Base) + ('' + window.DLI18N.t("55-lending.9afaa73c4a40") + '</td></tr>') +
      ('<tr><td>' + window.DLI18N.t("55-lending.d2c7023d7797") + '</td><td class="r">') + pctOf(out.indep.es99, 2) + '</td><td class="r">' + pctOf(out.corr.es99, 2) + ('</td><td>' + window.DLI18N.t("55-lending.519605b15f51") + '</td></tr>') +
      '</tbody></table></div>';

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.2c978bce6fbe") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">' + window.DLI18N.t("55-lending.3971beb95244") + '</th><th class="r">' + window.DLI18N.t("55-lending.e7500867b0ed") + '') + pctOf(out.rho, 0) + ('</th><th class="r">' + window.DLI18N.t("55-lending.b2f580387f54") + '') + usd(out.principal) + '</th></tr></thead><tbody>';
    for (i = 0; i < Math.min(out.corr.outcomes.length, 12); i++) {
      var o = out.corr.outcomes[i];
      h += '<tr><td class="r">' + pctOf(o.loss, 2) + '</td><td class="r">' + pctOf(o.prob, 4) + '</td><td class="r">' + (out.principal == null ? "—" : usd(out.principal * o.loss)) + '</td></tr>';
    }
    h += '</tbody></table></div>';

    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.096781155c71") + '</div>');
    if (out.breakEvenMultiple == null) h += ('<div class="dl-empty">' + window.DLI18N.t("55-lending.56fd694058e0") + '</div>');
    else {
      h += ('<div class="lnd-verdict">' + window.DLI18N.t("55-lending.87db881a57a4") + '') + pctOf(out.extraStakerApr) + ' is erased when every slashing probability is ' + fx(out.breakEvenMultiple, 2) + '× what you typed. ' +
        (out.breakEvenMultiple < 1 ? 'It is already below 1, which means at the probabilities you entered this restaking leg has a NEGATIVE expected value: the yield does not pay for the risk.' : 'Below that multiple the leg pays; above it, it does not.') + '</div>';
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("55-lending.d677190e0a99") + '</th><th class="r">' + window.DLI18N.t("55-lending.1af478f60a15") + '</th><th class="r">' + window.DLI18N.t("55-lending.63a2d52bd86c") + '</th></tr></thead><tbody>');
      for (i = 0; i < out.breakEven.length; i++) {
        h += '<tr><td>' + esc(out.breakEven[i].name) + '</td><td class="r">' + pctOf(out.breakEven[i].prob, 3) + '</td><td class="r">' + pctOf(out.breakEven[i].breakEvenProb, 3) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    }
    h += ('<div class="lnd-strip">' + window.DLI18N.t("55-lending.d759c827f52a") + '</div>');
    return h;
  }

  function restakeCfg(R) {
    var a = [], i;
    for (i = 0; i < R.a.length; i++) {
      a.push({ name: R.a[i].name, feeApr: (+R.a[i].fee || 0) / 100, commission: (+R.a[i].com || 0) / 100, slashPct: (+R.a[i].sev || 0) / 100, prob: (+R.a[i].prob || 0) / 100 });
    }
    return { principal: +R.principal || 0, lstBaseApr: (+R.base || 0) / 100, rho: (+R.rho || 0) / 100, avs: a };
  }

  /* --------------------------------------------------------------- method */

  function paneMethod() {
    var h = ('<div class="lnd-note">' + window.DLI18N.t("55-lending.1c8aca9bedbd") + '</div>');
    var i;
    h += '<div class="lnd-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="lnd-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.72575be9ba5c") + '</div><ul class="lnd-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    h += ('<div class="lnd-sub">' + window.DLI18N.t("55-lending.caf85b0888d7") + '</div><ul class="lnd-assume">') +
      ('<li>' + window.DLI18N.t("55-lending.f59b28cc3a10") + '</li>') +
      ('<li>' + window.DLI18N.t("55-lending.cd309b97fc7d") + '</li>') +
      ('<li>' + window.DLI18N.t("55-lending.fd274c879720") + '</li>') +
      ('<li>' + window.DLI18N.t("55-lending.707101e762c0") + '</li>') +
      '</ul>';
    return h;
  }

  /* ---------------------------------------------------------------- wiring */

  function readMarket() { return { key: str("lndMk", "WETH"), u: num("lndMu", 85), days: num("lndMd", 365), principal: num("lndMp", 1000000) }; }
  function readPosForm() {
    return {
      c1: str("lndC1", "WETH"), a1: num("lndA1", 0), p1: num("lndP1", 0),
      c2: str("lndC2", ""), a2: num("lndA2", 0), p2: num("lndP2", 0),
      d1: str("lndD1", "USDC"), da: num("lndDA", 0), dp: num("lndDP", 0),
      emode: str("lndEm", "none"), bk: str("lndBK", "USDC"), ba: num("lndBA", 0),
      borrowed: num("lndBB", 0)
    };
  }
  function readLiq() { return { px: num("lndLpx", 0), tvl: num("lndLtvl", 0), range: num("lndLrng", 0) }; }
  function readCasc() {
    return {
      key: str("lndKk", "WETH"), price0: num("lndKp", 0), tvl: num("lndKtvl", 0), range: 0,
      drop: num("lndKd", 0), steps: num("lndKs", 12), n: num("lndKn", 6),
      top: num("lndKt", 1.35), bottom: num("lndKb", 1.02), size: num("lndKsz", 0)
    };
  }
  function readRst() {
    var R = cfg("rst"), a = [], i;
    for (i = 0; i < R.a.length; i++) {
      a.push({ name: R.a[i].name, fee: num("lndRf" + i, R.a[i].fee), com: num("lndRc" + i, R.a[i].com), sev: num("lndRs" + i, R.a[i].sev), prob: num("lndRq" + i, R.a[i].prob) });
    }
    return { principal: num("lndRp", R.principal), base: num("lndRb", R.base), rho: num("lndRrho", R.rho), a: a };
  }

  function repaint(el, tab) {
    try {
      var body = el && el.querySelector ? el.querySelector(".dls-body") : null;
      if (!body) return;
      body.innerHTML = paneFor(tab || (el.dataset ? el.dataset.tab : "market"));
    } catch (e) {}
  }

  function onClick(ev) {
    var tgt = ev.target, el = document.getElementById("dlLend");
    if (!tgt || !tgt.id) return;
    if (tgt.id === "lndMgo") { cfg("market", readMarket()); repaint(el, "market"); return; }
    if (tgt.id === "lndPgo") { cfg("pos", readPosForm()); repaint(el, "position"); return; }
    if (tgt.id === "lndLgo") { cfg("liq", readLiq()); repaint(el, "liq"); return; }
    if (tgt.id === "lndKgo") { cfg("casc", readCasc()); repaint(el, "liq"); return; }
    if (tgt.id === "lndRgo") { cfg("rst", readRst()); repaint(el, "restake"); return; }
    if (tgt.id === "lndTake") {
      var out = take(LASTLIQ);
      if (!out.ok) { try { C.toast && C.toast("bad", "Not taken", out.reason); } catch (e) {} return; }
      repaint(el, "liq");
    }
  }
  function onChange(ev) {
    var tgt = ev.target, el = document.getElementById("dlLend");
    if (!tgt || !tgt.id || String(tgt.tagName).toUpperCase() !== "SELECT") return;
    if (tgt.id === "lndMk") { cfg("market", readMarket()); repaint(el, "market"); return; }
    if (tgt.id === "lndKk") { cfg("casc", readCasc()); repaint(el, "liq"); return; }
    if (tgt.id.indexOf("lndC") === 0 || tgt.id.indexOf("lndD") === 0 || tgt.id === "lndEm" || tgt.id === "lndBK") {
      cfg("pos", readPosForm()); repaint(el, "position");
    }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    wired = true;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); } catch (e) {}
      try { el.removeEventListener("change", onChange); } catch (e) {}
      wired = false;
    };
  }

  function seedPrices() {
    var p = cfg("pos");
    if (!(+p.p1 > 0)) { var lp = livePrice(p.c1); if (lp > 0) cfg("pos", { p1: lp }); }
    var L = cfg("liq");
    if (!(+L.px > 0)) { var q = +cfg("pos").p1; if (q > 0) cfg("liq", { px: q * 0.59 }); }
    var K = cfg("casc");
    if (!(+K.price0 > 0)) { var k = livePrice(K.key); if (k > 0) cfg("casc", { price0: k }); }
  }

  function open(tab) {
    try { seedPrices(); } catch (e) {}
    var el = null;
    try {
      el = C.open("dlLend", {
        title: window.DLI18N.t("55-lending.d31e10b3507a"),
        sub: window.DLI18N.t("55-lending.90359620a104"),
        tabs: [["market", "Market"], ["position", "Position"], ["liq", "Liquidation"], ["restake", "Restake"], ["method", "Method"]],
        onTab: function (t, body) {
          try { body.innerHTML = paneFor(t); }
          catch (e) { body.innerHTML = '<div class="dl-empty">' + esc(e && e.message ? e.message : e) + '</div>'; }
        }
      }, tab || "market");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlLend")); } catch (e) {}
    return el;
  }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("lend", "🏦", "Lending", "Rates, health factors, liquidation cascades and restaking", function () { open("market"); }); } catch (e) {}
  try { C.cmd && C.cmd("lending", "Lending Desk — the rate curve, health factors and the close factor", "🏦", function () { open("market"); }); } catch (e) {}
  try { C.cmd && C.cmd("liquidation cascade", "Cascade — forced selling into the app's own pool, and the reflexive drawdown", "🏦", function () { open("liq"); }); } catch (e) {}
  try { C.cmd && C.cmd("restaking", "Restaking — the reward split and correlated slashing done properly", "🏦", function () { open("restake"); }); } catch (e) {}

  window.DLLEND = {
    __v: 166,
    open: open,
    /* rate model */
    utilisation: utilisation, borrowRate: borrowRate, supplyRate: supplyRate,
    linearFactor: linearFactor, compoundedFactor: compoundedFactor, exactFactor: exactFactor,
    accrual: accrual, curveRow: curveRow,
    /* position */
    effParams: effParams, health: health, constraints: constraints, isolatedOf: isolatedOf,
    /* liquidation */
    closeFactor: closeFactor, seize: seize, liquidate: liquidate, cascade: cascade,
    /* restaking */
    normCdf: normCdf, normInv: normInv, rewardStack: rewardStack,
    lossDistribution: lossDistribution, restake: restake,
    /* engine + state */
    take: take, log: log, poolOf: poolOf, quoteSale: quoteSale,
    RESERVES: RESERVES, EMODES: EMODES, SNAPSHOT: SNAPSHOT,
    SECONDS_PER_YEAR: SECONDS_PER_YEAR,
    METHOD: METHOD, ASSUMPTIONS: ASSUMPTIONS
  };
})();
