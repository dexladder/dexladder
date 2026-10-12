// Sweep the actual Chromium accessibility tree: fail with an element description.
'use strict';
const { launch } = require('./harness');
const file = process.argv[2] || require('path').join(__dirname, '../dist/index.html');
const interactive = new Set(['button','link','textbox','combobox','checkbox','radio','slider','spinbutton','switch','tab','menuitem']);
function failures(nodes) {
  return nodes.filter(node => !node.ignored && interactive.has(node.role && node.role.value) && !(node.name && String(node.name.value || '').trim()));
}
async function sweep(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    const result = [];
    for (const node of failures(nodes)) {
      let element = node.role.value;
      if (node.backendDOMNodeId) {
        const { node: dom } = await session.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId });
        element += ' ' + dom.nodeName + ' ' + JSON.stringify(dom.attributes || []);
      }
      result.push(element);
    }
    return result;
  } finally { await session.detach(); }
}
module.exports = { sweep, failures };
if (require.main === module) (async () => {
  const h = await launch(file); let count = 0;
  try {
    await h.page.waitForTimeout(6000);
    await h.page.evaluate(() => { if (window.DLXW) DLXW.dismiss(); });
    for (const route of ['markets','news','discover','explorer','learn','portfolio','p2p','community']) {
      await h.page.evaluate(route => window.nav(route), route);
      await h.page.waitForTimeout(600);
      for (const detail of await sweep(h.page)) { console.error(route + ': unnamed ' + detail); count++; }
    }
    // Both canaries go through the same accessibility tree and evaluator.
    await h.page.evaluate(() => { var b = document.createElement('button'); b.id = 'aria-gate-canary'; document.body.appendChild(b); });
    if (!(await sweep(h.page)).some(line => line.includes('aria-gate-canary'))) throw new Error('unnamed canary not detected');
    await h.page.evaluate(() => document.getElementById('aria-gate-canary').setAttribute('aria-label', 'Named canary'));
    if ((await sweep(h.page)).some(line => line.includes('aria-gate-canary'))) throw new Error('named canary falsely failed');
    console.log('aria sweep: ' + count + ' failures; both canaries passed');
    process.exitCode = count ? 1 : 0;
  } finally { await h.close(); }
})().catch(error => { console.error(error); process.exitCode = 99; });
