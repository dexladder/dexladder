// One-shot evidence: every custom property AND a sample of rendered colours are identical between
// two payloads, in Night and Day, at 393 and 1440 px. Used to prove the A3 token consolidation
// changed nothing a user can see.   node test/tokens-equivalence.js <before.html> <after.html>
'use strict';
const { launch } = require('./harness');
async function probe(file, mode, width) {
  const h = await launch(file, { viewport: { width, height: 900 } });
  const { page } = h;
  await page.waitForTimeout(6000);
  const r = await page.evaluate(async (mode) => {
    try { if (window.DLMODE) DLMODE.set(mode === 'day' ? 'day' : 'dark'); } catch (e) {}
    await new Promise(r => setTimeout(r, 2500));   // past the 280 ms cross-fade and any re-layout
    const names = new Set();
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      const walk = rs => { for (const r of rs) { if (r.style) for (const p of r.style) if (p.startsWith('--')) names.add(p); if (r.cssRules) walk(r.cssRules); } }; walk(rules); }
    const cs = getComputedStyle(document.documentElement), bs = getComputedStyle(document.body);
    const tok = {}; [...names].sort().forEach(n => { tok[n] = cs.getPropertyValue(n).trim() + ' | ' + bs.getPropertyValue(n).trim(); });
    // key every painted element by its DOM path, so a card that renders in a different ORDER in
    // one run is still compared with itself, not with its neighbour
    const key = e => { const p = []; for (let n = e; n && n !== document.body; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++; p.unshift(n.tagName + (n.id ? '#' + n.id : '') + ':' + i); } return p.join('>'); };
    const paint = {};
    [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length).forEach(e => { const s = getComputedStyle(e); paint[key(e)] = s.color + '/' + s.backgroundColor + '/' + s.borderTopColor + '/' + s.boxShadow.slice(0, 40); });
    return { mode: document.documentElement.getAttribute('data-mode') || 'night', tok, paint };
  }, mode);
  await h.close();
  return r;
}
(async () => {
  const [a, b] = process.argv.slice(2);
  let fail = 0;
  for (const mode of ['night', 'day']) for (const w of [393, 1440]) {
    const A = await probe(a, mode, w), B = await probe(b, mode, w);
    const keys = new Set([...Object.keys(A.tok), ...Object.keys(B.tok)]);
    const diffT = [...keys].filter(k => A.tok[k] !== B.tok[k]);
    const both = Object.keys(A.paint).filter(k => k in B.paint);
    const diffP = both.filter(k => A.paint[k] !== B.paint[k]);
    console.log(`${mode.padEnd(5)} ${w}px  mode=${B.mode}  tokens compared ${keys.size}  differing ${diffT.length}  elements compared ${both.length}  differing paint ${diffP.length}`);
    diffP.slice(0, 6).forEach(k => console.log('    paint ' + k.slice(-90) + '\n      ' + A.paint[k] + '\n      ' + B.paint[k]));
    if (diffT.length) console.log('   ', diffT.slice(0, 8).map(k => k + ': ' + A.tok[k] + ' → ' + B.tok[k]).join('\n    '));
    fail += diffT.length + diffP.length;
  }
  process.exit(fail ? 1 : 0);
})();
