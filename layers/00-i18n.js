// owns: shared English UI string catalogue and lookup seam
// reads: buildlib/i18n/en.json at generation time
// emits: DLI18N with English defaults; no new locale control
//@inject-before: "use strict";const CG="https://api.coingecko.com/api/v3"
(function () {
  'use strict';
  var en = {
  "00-astra-boot.bff91a49cd13": "live markets · paper money · zero stakes",
  "11-newsfeed.d57cda15bac6": " via ",
  "20-core.08190d892c18": " · sources differ",
  "20-core.7d9eb7acb13e": "Close",
  "20-core.7e8920d19ec8": "paper money — simulated",
  "20-core.daeb30e06dcf": "simulated"
};
  window.DLI18N = Object.freeze({ en: Object.freeze(en), t: function (id) {
    if (!Object.prototype.hasOwnProperty.call(en, id)) throw new Error('Unknown UI string: ' + id);
    return en[id];
  } });
})();
