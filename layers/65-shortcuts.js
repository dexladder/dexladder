// owns: global keyboard shortcut help dialog
// reads: keyboard events and existing DLKEYS commands
// emits: DLSHORTCUTS and a modal with restored focus
(function () {
  'use strict';
  var previous, overlay;
  var keys = [
    ['?', 'Show shortcuts'], ['g then m / n / d / e / l / p / 2 / c', 'Markets / News / Discover / Explorer / Academy / Portfolio / P2P / Community'],
    ['⌘K / Ctrl+K / /', 'Command palette'], ['t', 'Cycle display theme'], ['Esc', 'Close dialogs'],
    ['b / s', 'Coin: Buy / Sell'], ['x', 'Coin: focus amount'], ['1–5', 'Coin: chart ranges'], ['w', 'Coin: watchlist'],
    ['r', 'Coin: Replay'], ['y', 'Coin: Strategy Lab'], ['← / →', 'Chart: step'], ['+ / −', 'Chart: zoom'],
    ['Home / End', 'Chart: first bar / realtime'], ['m', 'Chart: cycle magnet'], ['Delete / Backspace', 'Chart: delete selected drawings'],
    ['⌘Z / Ctrl+Z', 'Chart: undo'], ['⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y', 'Chart: redo'],
    ['Alt+t / h / v / f / r / p / b / e / i / l / s / c / x', 'Chart tools: trend / horizontal / vertical / Fibonacci / rectangle / channel / brush / ellipse / info / long / short / callout / XABCD']
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
    var title = document.createElement('h2'); title.id = 'dlShortcutsTitle'; title.textContent = 'Keyboard shortcuts';
    var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Close'; button.onclick = close;
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
      else if (event.key === 'Tab') { event.preventDefault(); overlay.querySelector('button').focus(); }
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
