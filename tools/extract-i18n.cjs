// Source-aware extraction: only UI-bearing string nodes; English remains byte-identical.
const ts = require('../app/node_modules/typescript');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const filename = process.argv[2];
if (!filename || !/^layers\/[\w-]+\.js$/.test(filename) || /(?:00-i18n|01-app)\.js$/.test(filename)) throw Error('pass one handwritten layer');
const source = fs.readFileSync(filename,'utf8');
const ast = ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const edits=[], table={};
const prefix=path.basename(filename,'.js');
function key(text) { const id=prefix+'.'+crypto.createHash('sha256').update(text).digest('hex').slice(0,12); table[id]=text; return id; }
function call(text) {return 'window.DLI18N.t('+JSON.stringify(key(text))+')';}
function visit(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value=node.text, parent=node.parent;
    if (value.includes('window.DLI18N')) return;
    let transformed=null;
    // In HTML, extract text nodes and accessibility-facing attributes only.
    if (/<[a-z/][^>]*>/i.test(value) && !/<(?:style|script)\b/i.test(value)) {
      const pieces=[]; let at=0;
      const pattern=/^[^<]+(?=<)|>[^<]+(?=<|$)|\b(?:aria-label|placeholder|title)="[^"]+"/g;
      for (const match of value.matchAll(pattern)) {
        let text=match[0], start=match.index;
        if (text[0]==='>') { start++;text=text.slice(1); }
        else if (/^(?:aria-label|placeholder|title)=/.test(text)) { const eq=text.indexOf('="');start+=eq+2;text=text.slice(eq+2,-1); }
        if (!/[A-Za-z]/.test(text) || /^[\s\d.,%+−–—:·/]+$/.test(text)) continue;
        pieces.push(JSON.stringify(value.slice(at,start)),call(text));at=start+text.length;
      }
      if (at) { pieces.push(JSON.stringify(value.slice(at)));transformed='('+pieces.filter(p=>p!=='""').join(' + ')+')'; }
    } else if (ts.isPropertyAssignment(parent) && ['label','title','note','sub','one','what'].includes(parent.name.getText(ast).replace(/['"]/g,'')) && /[A-Za-z]/.test(value)) transformed=call(value);
    else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind===ts.SyntaxKind.EqualsToken && /\.(?:textContent|innerText)$/.test(parent.left.getText(ast)) && /[A-Za-z]/.test(value)) transformed=call(value);
    if (!transformed && ts.isCallExpression(parent) && /(?:esc|\.empty)$/.test(parent.expression.getText(ast)) && /[A-Za-z]/.test(value) && !/[<>]/.test(value) && !/^https?:/.test(value)) transformed=call(value);
    if (transformed) edits.push({start:node.getStart(ast),end:node.end,replacement:transformed,original:value});
  }
  ts.forEachChild(node,visit);
}
visit(ast);
let result=source;
for (const edit of edits.reverse()) result=result.slice(0,edit.start)+edit.replacement+result.slice(edit.end);
// Verify each replacement evaluates to exactly its original literal before saving.
for (const edit of edits) {
 const evaluated=Function('window','return '+edit.replacement)({DLI18N:{t:id=>table[id]}});
 if (evaluated!==edit.original) throw Error('English changed');
}
const cataloguePath='buildlib/i18n/en.json';fs.mkdirSync(path.dirname(cataloguePath),{recursive:true});
const catalogue=fs.existsSync(cataloguePath)?JSON.parse(fs.readFileSync(cataloguePath,'utf8')):{};
Object.assign(catalogue,table);
fs.writeFileSync(filename,result);
fs.writeFileSync(cataloguePath,JSON.stringify(Object.fromEntries(Object.entries(catalogue).sort()),null,2)+'\n');
require('./generate-i18n.cjs');
console.log(prefix+': '+edits.length+' literals, '+Object.keys(table).length+' strings; exact English equivalence verified');
