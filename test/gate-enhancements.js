'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { launch } = require('./harness');
const file = process.argv[2] || path.join(__dirname, '../dist/index.html');
(async () => {
  const h = await launch(file);
  const { page } = h; let checks = 0;
  try {
    await page.waitForTimeout(7000);
    await page.evaluate(() => { if (window.DLXW) DLXW.dismiss(); });
    await page.evaluate(() => { const b = document.createElement('button'); b.id='focus-before'; b.textContent='Before'; document.body.appendChild(b); b.focus(); });
    await page.keyboard.press('?');
    assert.equal(await page.locator('#dlShortcuts [role=dialog]').getAttribute('aria-modal'), 'true'); checks++;
    await page.evaluate(() => { window.__backgroundTabs = 0; document.addEventListener('keydown', function (e) { if (e.key === 'Tab') window.__backgroundTabs++; }); });
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => window.__backgroundTabs),0); checks++;
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close'); checks++;
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-before'); checks++;
    await page.evaluate(() => { const i=document.createElement('input'); i.id='typing'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('?'); assert.equal(await page.locator('#dlShortcuts').count(),0); checks++;
    await page.evaluate(() => document.getElementById('typing').blur());
    await page.keyboard.press('?'); await page.locator('#dlShortcuts').click({position:{x:2,y:2}});
    assert.equal(await page.locator('#dlShortcuts').count(),0); checks++;
    await page.evaluate(() => DLTRUST.open('about'));
    await page.waitForFunction(() => /^[a-f0-9]{64}$/.test(document.getElementById('dlBuildHash').textContent));
    const hash = await page.locator('#dlBuildHash').textContent();
    assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')); checks++;
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.locator('#dlCopyHash').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),hash); checks++;
    await page.evaluate(() => { ['sources','changelog','privacy','dexai','laws','v154'].forEach(tab => DLTRUST.open(tab)); });
    await page.waitForTimeout(100); checks++;
    await page.evaluate(() => { if (DLTRUST.hide) DLTRUST.hide(); });
    const csv = await page.evaluate(() => DLVAULT.journalCsv([{t:0,sym:'=HYPERLINK("bad")',side:'sell',qty:2,exit:12,fee:0,slip:0,pl:-5},{sym:'a,b\n"c"',pl:0}]));
    assert.ok(csv.startsWith('\ufefftimestamp,symbol,side,type,qty,price,fee,slippage,pnl\r\n')); checks++;
    assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"a,b\n""c"""')); checks++;
    assert.ok(csv.includes('"1970-01-01T00:00:00.000Z"')); assert.ok(csv.includes('"-5"')); checks++;
    await page.evaluate(() => { S.journal=[{t:1000,sym:'ETH',qty:1,exit:3000,pl:10}]; });
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => DLVAULT.exportCsv());
    const download = await downloadPromise; assert.equal(download.suggestedFilename(),'dexladder-journal.csv');
    const downloaded = fs.readFileSync(await download.path(),'utf8'); assert.ok(downloaded.includes('ETH')); checks++;
    await page.evaluate(() => DLACCESS.setPref('colourblind',1));
    for (const mode of ['dark','day']) {
      await page.evaluate(mode => DLMODE.set(mode,true),mode);
      const up=await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--up').trim());
      assert.equal(up,mode==='day'?'#004c99':'#62b5ff'); checks++;
    }
    await page.reload(); await page.waitForTimeout(3000);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dla-colourblind'))); checks++;
    await page.evaluate(() => nav('learn'));
    assert.equal(await page.locator('#dlExecutionLessons article').count(),2); checks++;
    await page.locator('[data-funding-panel]').click();
    await page.waitForSelector('#dlWeather.on'); checks++;
    assert.deepEqual(h.errors,[]); checks++;
    console.log('enhancements: '+checks+' checks passed');
  } finally { await h.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
