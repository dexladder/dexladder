'use strict';
// Exercises the packaged hosted artifact, including a fresh worker and offline reload.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
(async()=>{
 const RUM='\n<script async id="netlify-rum-container" src="/.netlify/scripts/rum" data-netlify-rum-site-id="7f8be369-fe1c-4277-9cad-ff33c1b9f840" data-netlify-deploy-branch="" data-netlify-deploy-context="production" data-netlify-cwv-token="abc.def-ghi"></script>\n';
 const file=path.resolve(process.argv[2]);const root=path.dirname(file);const manifest=JSON.parse(fs.readFileSync(path.join(root,'hosted-manifest.json')));
 const hasDeferred=fs.readFileSync(path.join(root,'app/index.html'),'utf8').includes('<script type="application/x-dl-deferred"');
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(fs.readFileSync(file)),manifest.index_sha256);assert.equal(hash(fs.readFileSync(path.join(root,'app/index.html'))),manifest.app_sha256);assert.ok(manifest.hosted_html_bytes<25000);
 assert.ok(!fs.readFileSync(file,'utf8').includes('nvVeilAuto'));
 assert.equal(hash(fs.readFileSync(path.join(root,manifest.offline_path))),manifest.offline_sha256,'Single-file download must preserve the verified source artifact');
 for(const url of manifest.assets) assert.equal(hash(fs.readFileSync(path.join(root,url))),path.basename(url).split('.')[0]);
 const server=http.createServer((req,res)=>{let p=new URL(req.url,'http://local').pathname;if(p==='/.netlify/scripts/rum'){res.writeHead(200,{'content-type':'text/javascript'});return res.end('');}let f=path.join(root,p==='/'?'index.html':p);if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end('Not found');}let ext=path.extname(f);res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[ext]||'application/octet-stream','cache-control':p.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'});if(f===path.join(root,'app/index.html'))return res.end(fs.readFileSync(f,'utf8').replace('</body>',RUM+'</body>'));fs.createReadStream(f).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://dexladder.localhost:'+server.address().port;
 const browser=await chromium.launch({args:['--no-proxy-server','--host-resolver-rules=MAP dexladder.localhost 127.0.0.1']});
 try{
 const context=await browser.newContext({viewport:{width:393,height:852}});await context.route(/^https?:\/\/(?!dexladder\.localhost)/,r=>r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Hold the first extension in the network. Core trading must work before
 // the catalogue, assistants and optional desks finish; no metrics-only shell.
 const early=await context.newPage();
 const firstStage=fs.readFileSync(path.join(root,'app/index.html'),'utf8').match(/type="application\/x-dl-boot" data-dl-src="([^"]+)"/)[1];
 const pending=[];let held=true;
 await early.route(origin+firstStage,r=>held?pending.push(r):r.continue());
 await early.goto(origin+'/app/#/terminal',{waitUntil:'load'});
 await early.waitForFunction(()=>window.DLHOSTED?.coreReady,null,{timeout:15000});
 assert.equal(await early.evaluate(()=>window.DLHOSTED.ready),false,'Do not label extensions ready before they load');
 assert.ok(await early.evaluate(()=>typeof window.CBX?.preview==='function'&&typeof window.SV82?.exportBundle==='function'),'Paper engine and ledger must exist in the usable core');
 assert.equal(await early.locator('#cbCmd').count(),1,'Connection status must be available in the usable core');
 const cashBefore=await early.evaluate(()=>S.bal.USDT);
 await early.locator('#amt').fill('0.001');
 await early.locator('#placeBtn').click();
 assert.ok(await early.evaluate(before=>S.bal.USDT<before&&S.txns.length===1,cashBefore),'A real simulated order must fill before extensions are available');
 held=false;for(const route of pending)await route.continue();
 await early.waitForFunction(()=>window.DLHOSTED.ready,null,{timeout:30000});
 assert.ok(await early.evaluate(()=>S.txns.length===1),'Completing startup must preserve the early paper trade');
 await early.close();
 const homeRequests=[];page.on('request',request=>homeRequests.push(new URL(request.url()).pathname));
 await page.goto(origin,{waitUntil:'load'});await page.waitForTimeout(1500);
 assert.equal(await page.locator('h1').count(),1);
 assert.ok((await page.locator('h1').innerText()).includes('Learn crypto mechanics'));
 assert.equal(homeRequests.filter(url=>url.startsWith('/assets/')||url.startsWith('/app/')).length,0,'Homepage must not download the simulator');
 await page.getByRole('link',{name:'Open the simulator',exact:true}).click();
 await page.waitForFunction(hasDeferred=>typeof window.nav==='function'&&window.DLHOSTED?.ready&&(!hasDeferred||window.DLIDLE?.ready),hasDeferred,{timeout:30000});
 await page.waitForTimeout(2000);
 await page.evaluate(()=>nav('markets'));
 const protectedAssets=await page.evaluate(()=>Array.from(document.querySelectorAll('script[src^="/assets/"],link[href^="/assets/"]')).map(node=>({url:new URL(node.src||node.href).pathname,integrity:node.integrity})));
 for(const url of manifest.assets){const expected='sha256-'+Buffer.from(path.basename(url).split('.')[0],'hex').toString('base64');assert.ok(protectedAssets.some(item=>item.url===url&&item.integrity===expected),'Browser-enforced integrity missing: '+url);}
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
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller&&window.DLHOSTED?.offlineReady,null,{timeout:30000});
 assert.equal(await page.evaluate(async assets=>{const keys=await caches.keys();const cache=await caches.open(keys.find(k=>k.endsWith('-shell')));return (await Promise.all(assets.map(url=>cache.match(url)))).every(Boolean);},manifest.assets),true);
 await page.evaluate(()=>nav('markets'));await context.setOffline(true);await page.reload({waitUntil:'load'});
 await page.waitForFunction(hasDeferred=>typeof window.nav==='function'&&window.DLHOSTED?.ready&&(!hasDeferred||window.DLIDLE?.ready),hasDeferred,{timeout:30000});
 assert.ok(await page.evaluate(keys=>keys.every(k=>typeof window[k]?.open==='function'),desks));
 const witness=await page.evaluate(()=>new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error('Navigation witness timed out')),6000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};navigator.serviceWorker.controller.postMessage({dl:'running-build-hash'},[channel.port2]);}));
 assert.equal(witness.sha256,hash(Buffer.from(fs.readFileSync(path.join(root,'app/index.html'),'utf8').replace('</body>',RUM+'</body>'))),'Trust must describe the actual app response including hosting RUM');
 const cachesInUse=await page.evaluate(()=>caches.keys());assert.ok(cachesInUse.some(key=>key.endsWith(manifest.app_sha256.slice(0,12)+'-shell')),'App-only changes must version the cache group');
 await page.goto(origin+'/#/learn',{waitUntil:'load'});
 await page.waitForFunction(hasDeferred=>typeof window.nav==='function'&&window.DLHOSTED?.ready&&(!hasDeferred||window.DLIDLE?.ready),hasDeferred,{timeout:30000});
 assert.ok(page.url().includes('/app/#/learn'),'Existing deep links must reach the app');
 assert.equal(await page.locator('#page-learn.active').count(),1);
 await page.goto(origin,{waitUntil:'load'});
 assert.ok((await page.locator('h1').innerText()).includes('Learn crypto mechanics'),'App navigation must not overwrite cached homepage');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: homepage <25KB with no app downloads; app digests, navigation, all desks, complete offline reload, old deep links, independent home/app caches');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
