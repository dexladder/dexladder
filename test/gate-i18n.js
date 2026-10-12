// Every call site must resolve to the emitted English catalogue; no forgotten keys.
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert/strict');
const catalogue=JSON.parse(fs.readFileSync(path.join(__dirname,'../buildlib/i18n/en.json'),'utf8'));
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../layers/00-i18n.js'),'utf8'),sandbox);
let calls=0;
for(const name of fs.readdirSync(path.join(__dirname,'../layers')).filter(n=>n.endsWith('.js')&&n!=='00-i18n.js')) {
 const text=fs.readFileSync(path.join(__dirname,'../layers',name),'utf8');
 for(const m of text.matchAll(/window\.DLI18N\.t\("([^"]+)"\)/g)) {
  assert.equal(sandbox.window.DLI18N.t(m[1]),catalogue[m[1]],name+': '+m[1]);calls++;
 }
}
assert.throws(()=>sandbox.window.DLI18N.t('missing.key'),/Unknown UI string/);
if(process.argv.includes('--complete')) assert.ok(calls>397,'must cover the issue’s original scope');
console.log('i18n: '+calls+' call sites, '+Object.keys(catalogue).length+' English strings; all resolve');
