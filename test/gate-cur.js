// gate-cur · the display currency, asserted against the payload that ships.
// Runs against dist/index.html, like every other gate in this suite.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'dist', 'index.html');
const d = fs.readFileSync(FILE, 'utf8');
let fail = 0;
function ok(cond, msg) { if (!cond) { console.error('  ✖ ' + msg); fail++; } else { console.log('  ✓ ' + msg); } }

ok(d.indexOf('<script id="dlcur">') > 0, 'the DLCUR core ships');
ok(d.indexOf('<script id="dlcur">') < d.indexOf('</head>'), 'it is seated in <head>, ahead of every script that renders money');
ok(/window\.DLCUR\s*=/.test(d), 'DLCUR is exported');

// the currencies and their two rate sources
for (const c of ['USD', 'EUR', 'INR', 'GBP', 'JPY', 'AED', 'SGD', 'BRL', 'NGN', 'VND', 'BTC', 'ETH'])
  ok(new RegExp('\\["' + c + '"').test(d) || d.indexOf('"' + c + '",') > 0, 'the list carries ' + c);
ok(d.indexOf('/exchange_rates') > 0 && d.indexOf('open.er-api.com/v6/latest/USD') > 0,
   'both rate sources are wired');
ok(/rate\(cur\)\s*>\s*0\s*\?\s*cur\s*:\s*"USD"/.test(d.replace(/\s+/g, ' ')) || d.indexOf('function act()') > 0,
   'a quote with no rate falls back to USD rather than inventing one');

// the formatters converted
const leaves = ['function fmt$(', 'function cUSD(', 'function fmtUSD(', 'function fmtP(', 'function money('];
for (const f of leaves) {
  const i = d.indexOf(f);
  ok(i > 0 && d.slice(i, i + 700).indexOf('DLCUR.') > 0, f.slice(9, -1) + '() asks DLCUR for its symbol');
}
ok(d.indexOf('function qRate(q){return DLCUR.rate(q)||1}') > 0, 'qRate delegates to DLCUR');
ok(d.indexOf('function qSym(q){return DLCUR.sym(q)}') > 0, 'qSym delegates to DLCUR');

// no hard-coded rate survives outside the deliberate last-resort fallbacks
const hard = (d.match(/S\.fx\.INR\s*\|\|\s*83/g) || []).length;
ok(hard <= 3, 'the 83 rupee constant only survives as a last resort behind DLCUR (' + hard + ')');
ok(d.indexOf('fx:{EUR:.92,INR:83}') < 0, 'the markets module no longer seeds a made-up rate');

// the picker
ok(d.indexOf('id="mxCurSel"') > 0, 'the markets picker is the full list, not five buttons');
ok(d.indexOf('data-mxq=') < 0, 'the five-button segment is gone, not hidden');

// what is still allowed to print a dollar sign, and nothing more
const left = (d.match(/\$["']\s*\+\s*[A-Za-z0-9_$(]/g) || []).length;
ok(left <= 12, 'only the denied surfaces build money from a bare "$" (' + left + ')');
for (const denied of ['X402', 'taxReport'])
  ok(d.indexOf(denied) > 0, 'the denied surface ' + denied + ' is still in the payload');

// balances stay honest
ok(d.indexOf('pf-totalSub') > 0 && d.indexOf('USDT"') > 0, 'the portfolio total carries its USDT quantity');

console.log(fail ? '\ngate-cur: ' + fail + ' FAILED' : '\ngate-cur: all checks passed');
process.exit(fail ? 1 : 0);
