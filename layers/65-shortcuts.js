// owns: global keyboard shortcut help dialog
// reads: keyboard events and existing DLKEYS commands
// emits: DLSHORTCUTS and a modal with restored focus
(function () {
  'use strict';
  var previous, overlay;
  var keys = [
    ['?', window.DLI18N.t("65-shortcuts.54a80bd055e7")], ['g then m / n / d / e / l / p / 2 / c', window.DLI18N.t("65-shortcuts.74e2959a7dd6")],
    ['⌘K / Ctrl+K / /', window.DLI18N.t("65-shortcuts.0347f794d69c")], ['t', window.DLI18N.t("65-shortcuts.8640e5405ab8")], ['Esc', window.DLI18N.t("65-shortcuts.863c24308391")],
    ['b / s', window.DLI18N.t("65-shortcuts.df0719d2274f")], ['x', window.DLI18N.t("65-shortcuts.0db80b6f050a")], ['1–5', window.DLI18N.t("65-shortcuts.3ef781a50e70")], ['w', window.DLI18N.t("65-shortcuts.80e272fdd198")],
    ['r', window.DLI18N.t("65-shortcuts.dfc9f8d56f3d")], ['y', window.DLI18N.t("65-shortcuts.0f92d1f369e7")], ['← / →', window.DLI18N.t("65-shortcuts.b0aad4d1327c")], ['+ / −', window.DLI18N.t("65-shortcuts.815e2a27ee5d")],
    ['Home / End', window.DLI18N.t("65-shortcuts.2fa0a03dc50c")], ['m', window.DLI18N.t("65-shortcuts.21e91a50ea9c")], ['Delete / Backspace', window.DLI18N.t("65-shortcuts.d4fd482cb995")],
    ['⌘Z / Ctrl+Z', window.DLI18N.t("65-shortcuts.31e213faa77f")], ['⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y', window.DLI18N.t("65-shortcuts.7591ca8358de")],
    ['Alt+t / h / v / f / r / p / b / e / i / l / s / c / x', window.DLI18N.t("65-shortcuts.bcdbdcd03c07")]
  ];
  function close() {
    if (!overlay) return;
    overlay.remove(); overlay = null;
    if (previous && previous.isConnected) previous.focus();
  }
  function open() {
    if (overlay) return;
    previous = document.activeElement;
    overlay = document.createElement('div');
    overlay.id = 'dlShortcuts'; overlay.className = 'dlv-ov on';
    Object.assign(overlay.style, { display:'flex', alignItems:'center', justifyContent:'center', zIndex:'100000' });
    var dialog = document.createElement('section');
    dialog.className = 'dlv-sheet'; Object.assign(dialog.style, { maxWidth:'760px', maxHeight:'85vh', overflow:'auto' });
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'dlShortcutsTitle');
    var title = document.createElement('h2'); title.id = 'dlShortcutsTitle'; title.textContent = window.DLI18N.t("65-shortcuts.e9bef0b0f3c2");
    var button = document.createElement('button'); button.type = 'button'; button.textContent = window.DLI18N.t("65-shortcuts.7d9eb7acb13e"); button.onclick = close;
    dialog.append(title, button);
    var table = document.createElement('table'); table.className = 'dl-tbl';
    keys.forEach(function (pair) { var row = table.insertRow(); row.insertCell().textContent = pair[0]; row.insertCell().textContent = pair[1]; });
    dialog.appendChild(table); overlay.appendChild(dialog); document.body.appendChild(overlay);
    overlay.onclick = function (event) { if (event.target === overlay) close(); };
    button.focus();
  }
  document.addEventListener('keydown', function (event) {
    if (overlay) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      else if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); overlay.querySelector('button').focus(); }
      else { event.stopImmediatePropagation(); }
      return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key !== '?') return;
    var target = event.target;
    if (target && (target.closest('input,textarea,select') || target.isContentEditable)) return;
    event.preventDefault(); event.stopImmediatePropagation(); open();
  }, true);
  window.DLSHORTCUTS = { open: open, close: close, keys: keys };
})();
