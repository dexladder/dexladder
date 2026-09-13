'use strict';
const { launch } = require('./harness');
(async()=>{
 const h=await launch('../dist/index.html',{width:1440,height:900});
 const {page}=h; await page.setViewportSize({width:1440,height:900});
 await page.waitForTimeout(20000);
 await page.evaluate(()=>nav('markets')); await page.waitForTimeout(4000);
 const r=await page.evaluate(()=>{
  const main=document.querySelector('main.active');
  const vis=e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'};
  const out=[];
  const walk=[...main.querySelectorAll('*')].filter(vis);
  for(const e of walk){ const t=(e.childElementCount===0?(e.innerText||''):'').trim();
    if(!t||t.length<3||t.length>34) continue;
    const s=getComputedStyle(e);
    if(parseFloat(s.letterSpacing)>0.5 && s.textTransform==='uppercase'){
      const r=e.getBoundingClientRect(); out.push({t:t.replace(/\s+/g,' '),y:Math.round(r.y+scrollY),w:Math.round(r.width)});}}
  const seen={}; out.forEach(o=>seen[o.t.toLowerCase()]=(seen[o.t.toLowerCase()]||0)+1);
  // heatmap panel
  const hm=document.getElementById('dlHeat');
  const hmInfo=hm?{h:Math.round(hm.getBoundingClientRect().height),txt:(hm.innerText||'').trim().length,
    canvas:hm.querySelectorAll('canvas').length,cells:hm.querySelectorAll('div').length}:null;
  return {labels:out.slice(0,40),dups:Object.entries(seen).filter(([,n])=>n>1),hmInfo};
 });
 console.log('SECTION LABELS (top→bottom):');
 r.labels.forEach(l=>console.log(String(l.y).padStart(5), l.t));
 console.log('\nREPEATED:', JSON.stringify(r.dups));
 console.log('HEATMAP:', JSON.stringify(r.hmInfo));
 process.exit(0);
})();
