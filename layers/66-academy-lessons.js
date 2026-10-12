// owns: two execution and funding lessons in Academy
// reads: bundled lesson HTML and DLWEATHER
// emits: Academy lesson articles and a link to the existing funding panel
(function () {
  'use strict';
  function mount() {
    var host = document.getElementById('learnHub');
    if (!host || document.getElementById('dlExecutionLessons')) return;
    var section = document.createElement('section'); section.id = 'dlExecutionLessons'; section.className = 'dl154';
    section.innerHTML = ("<details><summary>" + window.DLI18N.t("66-academy-lessons.4c0adc488e10") + "</summary><article><p>" + window.DLI18N.t("66-academy-lessons.687a30b2b0bd") + "</p><p>" + window.DLI18N.t("66-academy-lessons.757de8ab61a0") + "</p><p>" + window.DLI18N.t("66-academy-lessons.2e082b66d995") + "</p><p>" + window.DLI18N.t("66-academy-lessons.c1f673e182c8") + "</p><p>" + window.DLI18N.t("66-academy-lessons.cf12029dfd97") + "<a href=\"/tools/price-impact-calculator/\" target=\"_blank\" rel=\"noopener\">" + window.DLI18N.t("66-academy-lessons.5e539964d2e8") + "</a>" + window.DLI18N.t("66-academy-lessons.fc963ba3c332") + "</p><p>" + window.DLI18N.t("66-academy-lessons.d3f406d21ef9") + "</p><p>" + window.DLI18N.t("66-academy-lessons.53cf3a8045f1") + "</p></article></details><details><summary>" + window.DLI18N.t("66-academy-lessons.0c3dc1e3d47f") + "</summary><article><p>" + window.DLI18N.t("66-academy-lessons.532a0b384a02") + "</p><p>" + window.DLI18N.t("66-academy-lessons.af95c0f013df") + "</p><p>" + window.DLI18N.t("66-academy-lessons.6b46d37c5b4c") + "</p><p>" + window.DLI18N.t("66-academy-lessons.65f0db351236") + "</p><p>" + window.DLI18N.t("66-academy-lessons.a5fd4b25ca01") + "</p><p>" + window.DLI18N.t("66-academy-lessons.3ce5dc392fb3") + "<b>" + window.DLI18N.t("66-academy-lessons.2b801d876f55") + "</b>" + window.DLI18N.t("66-academy-lessons.d9b9eb2f9b0a") + "<b>" + window.DLI18N.t("66-academy-lessons.b10461d114e4") + "</b>" + window.DLI18N.t("66-academy-lessons.1e4108923371") + "</p><p>" + window.DLI18N.t("66-academy-lessons.17040014d00d") + "</p></article></details><button type=\"button\" data-funding-panel>" + window.DLI18N.t("66-academy-lessons.444732b8179e") + "</button>");
    host.appendChild(section);
    section.querySelector('[data-funding-panel]').onclick = function () { if (window.DLWEATHER) window.DLWEATHER.open('perps'); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
