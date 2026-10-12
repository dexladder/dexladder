// owns: shared English UI string catalogue and lookup seam
// reads: buildlib/i18n/en.json at generation time
// emits: DLI18N with English defaults; no new locale control
//@inject-before: "use strict";const CG="https://api.coingecko.com/api/v3"
(function () {
  'use strict';
  var en = {};
  window.DLI18N = Object.freeze({ en: Object.freeze(en), t: function (id) {
    if (!Object.prototype.hasOwnProperty.call(en, id)) throw new Error('Unknown UI string: ' + id);
    return en[id];
  } });
})();
