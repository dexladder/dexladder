'use strict';
// Exercises the packaged hosted artifact, including a fresh worker and offline reload.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
(async()=>{
 const file=path.resolve(process.argv[2]);const root=path.dirname(file);const manifest=JSON.parse(fs.readFileSync(path.join(root,'hosted-manifest.json')));
 const hasDeferred=fs.readFileSync(file,'utf8').includes('<script type="application/x-dl-deferred"');
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(fs.readFileSync(file)),manifest.index_sha256);assert.ok(manifest.hosted_html_bytes<1000000);
 assert.ok(!fs.readFileSync(file,'utf8').includes('nvVeilAuto'));
 for(const url of manifest.assets) assert.equal(hash(fs.readFileSync(path.join(root,url))),path.basename(url).split('.')[0]);
 const server=http.createServer((req,res)=>{let p=new URL(req.url,'http://local').pathname;let f=path.join(root,p==='/'?'index.html':p);if(!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end('Not found');}let ext=path.extname(f);res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[ext]||'application/octet-stream','cache-control':p.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'});fs.createReadStream(f).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://dexladder.localhost:'+server.address().port;
 const browser=await chromium.launch({args:['--no-proxy-server','--host-resolver-rules=MAP dexladder.localhost 127.0.0.1']});
 try{
 const context=await browser.newContext({viewport:{width:393,height:852}});await context.route(/^https?:\/\/(?!dexladder\.localhost)/,r=>r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'load'});
 await page.waitForFunction(hasDeferred=>typeof window.nav==='function'&&window.DLHOSTED?.ready&&(!hasDeferred||window.DLIDLE?.ready),hasDeferred,{timeout:30000});
 await page.waitForTimeout(2000);
 const badge=await page.locator('#sv82-chip .sv82-b img').evaluate(img=>({w:img.getBoundingClientRect().width,h:img.getBoundingClientRect().height}));
 assert.ok(badge.w>0&&badge.w<=22&&badge.h>0&&badge.h<=22,JSON.stringify(badge));
 assert.equal(await page.locator('[data-dl-guide-start]').count(),1);
 assert.equal(await page.locator('.tour-tip').count(),0);
 assert.equal(await page.locator('#dlStartHere').count(),0);
 await page.locator('[data-dl-guide-start]').click();
 if(await page.locator('#dlStartHere').count()) await page.locator('[data-dl-start="markets"]').click();
 else await page.waitForFunction(()=>document.querySelector('#page-learn.active'));
 await page.evaluate(()=>nav('coin'));assert.equal(await page.locator('#page-coin.active').count(),1);
 await page.evaluate(()=>nav('learn'));assert.equal(await page.locator('#page-learn.active').count(),1);
 const desks=['DLLEND','DLOPT','DLCHAIN','DLORD','DLRISK','DLPATH','DLREPLAY','DLCARRY','DLACCESS','DLVERIFY','DLSOR'];
 assert.ok(await page.evaluate(keys=>keys.every(k=>typeof window[k]?.open==='function'),desks));
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:30000});
 assert.equal(await page.evaluate(async assets=>{const keys=await caches.keys();const cache=await caches.open(keys.find(k=>k.endsWith('-shell')));return (await Promise.all(assets.map(url=>cache.match(url)))).every(Boolean);},manifest.assets),true);
 await page.evaluate(()=>nav('markets'));await context.setOffline(true);await page.reload({waitUntil:'load'});
 await page.waitForFunction(hasDeferred=>typeof window.nav==='function'&&window.DLHOSTED?.ready&&(!hasDeferred||window.DLIDLE?.ready),hasDeferred,{timeout:30000});
 assert.ok(await page.evaluate(keys=>keys.every(k=>typeof window[k]?.open==='function'),desks));
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: content hashes, bounded HTML, opt-in guide, mobile Trade/Learn, all desks, automatic worker installation, full offline reload');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
