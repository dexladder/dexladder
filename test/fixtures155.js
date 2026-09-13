// Deterministic fixtures for the v155 stabilisation gates.
// Every payload here is synthetic. Nothing is fetched from a live provider.
'use strict';

// A CoinGecko /coins/markets row. `variant` decides how the supply field arrives.
//   'normal'  → a real number
//   'null'    → explicit null (provider says: we do not know)
//   'absent'  → the key is missing entirely
//   'zero'    → a legitimate 0 (a token with nothing in circulation yet)
//   'garbage' → a non-numeric string
function cgRow(sym, id, name, price, mcap, supply) {
  return {
    id, symbol: sym.toLowerCase(), name, image: '',
    current_price: price, market_cap: mcap, market_cap_rank: 1,
    fully_diluted_valuation: null, total_volume: mcap / 20,
    high_24h: price * 1.02, low_24h: price * 0.98,
    price_change_percentage_1h_in_currency: 0.1,
    price_change_percentage_24h_in_currency: 1.2,
    price_change_percentage_7d_in_currency: -3.4,
    price_change_percentage_24h: 1.2,
    circulating_supply: supply, max_supply: null, total_supply: null,
    ath: price * 1.6, ath_change_percentage: -37.5,
    atl: price * 0.01, atl_change_percentage: 9900,
    last_updated: '2026-09-07T11:00:00.000Z',
  };
}

const SUPPLY_VARIANTS = {
  normal: 19749447.31,
  null: null,
  zero: 0,
  garbage: 'n/a',
};

// A markets page where BTC carries the variant under test and the rest are normal.
function cgMarkets(variant, per) {
  per = per || 100;
  const rows = [];
  const btc = cgRow('BTC', 'bitcoin', 'Bitcoin', 79389.21, 1.59e12, SUPPLY_VARIANTS[variant]);
  if (variant === 'absent') delete btc.circulating_supply;
  rows.push(btc);
  rows.push(cgRow('ETH', 'ethereum', 'Ethereum', 3521, 4.2e11, 120280000));
  // A brand-new token with a genuine zero circulating supply — this must NOT read "Unavailable".
  rows.push(cgRow('ZRO0', 'zero-token', 'Zero Token', 1.5, 0, 0));
  for (let i = rows.length; i < per; i++) {
    rows.push(cgRow('T' + i, 'tok-' + i, 'Token ' + i, 10 + i, 1e9 - i * 1e6, 1e6 + i));
  }
  return rows;
}

// Coinpaprika /tickers — the shape the fallback shim reshapes into CoinGecko rows.
function paprika(variant) {
  const q = (mcap, vol) => ({ USD: {
    price: 79389.21, volume_24h: vol, market_cap: mcap,
    percent_change_1h: 0.1, percent_change_24h: 1.2, percent_change_7d: -3.4,
    ath_price: 0, percent_from_price_ath: 0,
  } });
  const btc = { id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1,
    circulating_supply: SUPPLY_VARIANTS[variant], max_supply: 21000000, total_supply: 19749447,
    last_updated: '2026-09-07T11:00:00Z', quotes: q(1.59e12, 3e10) };
  if (variant === 'absent') delete btc.circulating_supply;
  const eth = { id: 'eth-ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2,
    circulating_supply: 120280000, max_supply: 0, total_supply: 120280000,
    last_updated: '2026-09-07T11:00:00Z', quotes: q(4.2e11, 1.5e10) };
  const out = [btc, eth];
  for (let i = 2; i < 120; i++) {
    out.push({ id: 'tok-' + i, symbol: 'T' + i, name: 'Token ' + i, rank: i + 1,
      circulating_supply: 1e6 + i, max_supply: 0, total_supply: 1e6 + i,
      last_updated: '2026-09-07T11:00:00Z', quotes: q(1e9 - i * 1e6, 1e7) });
  }
  return out;
}

// Blockchair dashboards/transaction — block_id is -1 while unconfirmed, 0 for genesis.
function blockchairTx(blockId, hash) {
  return { data: { [hash || 'HASH']: { transaction: {
    hash: hash || 'HASH', block_id: blockId, time: '2009-01-03 18:15:05',
    input_count: 0, output_count: 1, output_total: 5000000000,
  } } }, context: { code: 200 } };
}

// A dl.supply.v1 store with `days` daily snapshots ending today.
function supplyStore(days, sym, from, to) {
  const out = { since: null, days: {} };
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const t = days === 1 ? 1 : (days - 1 - i) / (days - 1);
    out.days[d] = { [sym]: Math.round(from + (to - from) * t) };
  }
  out.since = Object.keys(out.days).sort()[0];
  return out;
}

module.exports = { cgRow, cgMarkets, paprika, blockchairTx, supplyStore, SUPPLY_VARIANTS };
