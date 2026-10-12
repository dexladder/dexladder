const fs=require('fs');
const catalogue=JSON.parse(fs.readFileSync('buildlib/i18n/en.json','utf8'));
const text=`// owns: shared English UI string catalogue and lookup seam
// reads: buildlib/i18n/en.json at generation time
// emits: DLI18N with English defaults; no new locale control
//@inject-before: "use strict";const CG="https://api.coingecko.com/api/v3"
(function () {
  'use strict';
  var en = ${JSON.stringify(catalogue,null,2)};
  window.DLI18N = Object.freeze({ en: Object.freeze(en), t: function (id) {
    if (!Object.prototype.hasOwnProperty.call(en, id)) throw new Error('Unknown UI string: ' + id);
    return en[id];
  } });
})();
`;
if(process.argv.includes('--check')) {if(fs.readFileSync('layers/00-i18n.js','utf8')!==text) throw Error('catalogue layer is stale');}
else fs.writeFileSync('layers/00-i18n.js',text);
