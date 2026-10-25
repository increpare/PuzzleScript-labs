/* Win95 workbench chrome. Commands delegate to the existing MIS controls. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const target = selector => document.querySelector(selector);
  const click = selector => () => target(selector).click();
  const desktop = window.misDesktop;
  const shortcut = text => desktop && desktop.platform === 'darwin' ? text.replace(/Ctrl/g, 'Cmd') : text;
  const menus = [
    ['File', [
      ['Open game…', '#open-btn', 'Ctrl+O'], ['Save game', '#save-btn', 'Ctrl+S'],
      ['Save game as…', () => window.misDocument.save(true), 'Ctrl+Shift+S'], null,
      ['Choose demo…', () => $('demo-select').focus()],
    ]],
    ['Edit', [
      ['Undo level edit', '#undo-btn', 'Ctrl+Z'], ['Redo level edit', '#redo-btn', 'Ctrl+Shift+Z'], null,
      ['New level…', '#new-level'], ['Duplicate level', '#dup-level'], ['Unlock all tiles', '#lock-none'], ['Invert tile locks', '#lock-invert'],
    ]],
    ['View', [
      ['Transform code', '[data-tab="transform"]'], ['Game source', '[data-tab="source"]'],
      ['Blind mode', () => $('blind-toggle').click()],
    ]],
    ['Run', [
      ['Edit level', '[data-mode="edit"]', 'E'], ['Lock tiles', '[data-mode="lock"]', 'L'],
      ['Playtest', '[data-mode="play"]', 'P'], null,
      ['Generate / pause this level', '#gen-btn', 'G'], ['Stop all generation', '#stop-all-generation'], ['Peek a sample', '#peek-btn'],
      ['Watch solution', '#watch-btn'], ['Simplify level', '#simplify-btn'],
    ]],
    ['Help', [['Workbench help', '#help-btn', 'F1'], null, ['About MIS95…', () => $('about-dialog').showModal()]]],
  ];
  if (desktop) menus[0][1].push(null, ['(No recent files)', () => {}], null, ['Exit', () => desktop.close(), desktop.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4']);
  const triggers = [], popups = [];
  let opened = -1, returnFocus = null;
  function close(restore = true) {
    if (opened < 0) return;
    popups[opened].hidden = true;
    triggers[opened].setAttribute('aria-expanded', 'false');
    opened = -1;
    if (restore && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function items() { return [...popups[opened].querySelectorAll('button:not(:disabled)')]; }
  function open(index, focus = true) {
    if (opened < 0) returnFocus = document.activeElement;
    close(false);
    opened = (index + menus.length) % menus.length;
    const popup = popups[opened];
    popup.querySelectorAll('[data-command]').forEach(button => {
      const control = target(button.dataset.command);
      button.disabled = control.disabled || (control.id === 'watch-btn' && control.style.display === 'none');
      if (control.dataset.mode) button.setAttribute('aria-checked', String(control.classList.contains('on')));
    });
    const blind = popup.querySelector('[role=menuitemcheckbox]');
    if (blind) blind.setAttribute('aria-checked', String($('blind-toggle').checked));
    popup.hidden = false;
    popup.style.left = '0px';
    popup.style.maxHeight = Math.max(100, window.innerHeight - popup.getBoundingClientRect().top - 8) + 'px';
    const overflow = popup.getBoundingClientRect().right - window.innerWidth + 4;
    if (overflow > 0) popup.style.left = -overflow + 'px';
    triggers[opened].setAttribute('aria-expanded', 'true');
    if (focus) items()[0].focus();
  }
  menus.forEach(([name, entries], index) => {
    const wrap = document.createElement('div'); wrap.className = 'menu-wrap';
    const trigger = document.createElement('button'); trigger.className = 'menu-trigger';
    trigger.innerHTML = '<span><u>' + name[0] + '</u>' + name.slice(1) + '</span>';
    trigger.setAttribute('aria-label', name);
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'menu-' + name.toLowerCase());
    const popup = document.createElement('div'); popup.className = 'menu-popup'; popup.hidden = true;
    popup.id = 'menu-' + name.toLowerCase(); popup.setAttribute('role', 'menu'); popup.setAttribute('aria-label', name);
    entries.forEach(entry => {
      if (!entry) { const hr = document.createElement('hr'); hr.setAttribute('role', 'separator'); popup.append(hr); return; }
      const [label, action, shortcut] = entry;
      const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      const text = document.createElement('span'); text.textContent = label; button.append(text);
      if (shortcut) { const key = document.createElement('span'); key.className = 'menu-shortcut'; key.textContent = desktop && desktop.platform === 'darwin' ? shortcut.replace(/Ctrl/g, 'Cmd') : shortcut; button.append(key); }
      if (label === '(No recent files)') { button.dataset.recent = ''; button.disabled = true; }
      if (typeof action === 'string') button.dataset.command = action;
      if (typeof action === 'string' && action.startsWith('[data-mode=')) button.setAttribute('role', 'menuitemradio');
      if (label === 'Blind mode') button.setAttribute('role', 'menuitemcheckbox');
      button.addEventListener('click', () => { close(); (typeof action === 'string' ? click(action) : action)(); });
      button.addEventListener('pointermove', event => {
        if (!button.disabled && (event.movementX || event.movementY)) button.focus({ preventScroll: true });
      });
      popup.append(button);
    });
    trigger.addEventListener('click', () => opened === index ? close() : open(index));
    trigger.addEventListener('pointerenter', () => { if (opened >= 0 && opened !== index) open(index); });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); open(index); }
    });
    wrap.append(trigger, popup); $('menubar').append(wrap); triggers.push(trigger); popups.push(popup);
  });
  if (desktop) {
    async function refreshRecents() {
      const recent = await desktop.recentFiles();
      const popup = popups[0], old = popup.querySelectorAll('[data-recent]');
      const anchor = old[old.length - 1].nextSibling;
      old.forEach(item => item.remove());
      (recent.length ? recent : [{ name: '(No recent files)' }]).forEach((file, index) => {
        const button = document.createElement('button');
        button.dataset.recent = file.path || ''; button.tabIndex = -1;
        button.setAttribute('role', 'menuitem'); button.disabled = !file.path;
        button.textContent = file.path ? (index + 1) + ' ' + file.name : file.name;
        button.title = file.path || '';
        button.addEventListener('click', () => { close(); window.misDocument.open(file.path); });
        button.addEventListener('pointermove', event => { if (event.movementX || event.movementY) button.focus({ preventScroll: true }); });
        popup.insertBefore(button, anchor);
      });
    }
    document.addEventListener('mis-recents-changed', () => { refreshRecents().catch(() => {}); });
    refreshRecents().catch(() => {});
    document.body.classList.add('mis-desktop');
    const caption = document.querySelector('.app-caption');
    const controls = document.createElement('div'); controls.className = 'caption-controls';
    [['Minimize', '−', () => desktop.minimize()], ['Maximize', '□', () => desktop.maximize()], ['Close', '×', () => desktop.close()]].forEach(([label, glyph, action]) => {
      const button = document.createElement('button'); button.type = 'button'; button.title = label;
      button.setAttribute('aria-label', label); button.textContent = glyph; button.onclick = action;
      controls.append(button);
    });
    caption.append(controls);
    desktop.onMaximize(on => { const button = controls.children[1]; button.textContent = on ? '❐' : '□'; button.title = on ? 'Restore' : 'Maximize'; button.setAttribute('aria-label', button.title); });
    $('save-btn').title = 'Save game — ' + shortcut('Ctrl+S');
    if (desktop.platform === 'darwin') document.querySelectorAll('[title]').forEach(control => { control.title = shortcut(control.title); });
  }
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#menubar')) close(false); });
  window.addEventListener('blur', () => close(false));
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key.toLowerCase() === 's' && opened < 0) {
      event.preventDefault(); event.stopImmediatePropagation(); window.misDocument.save(true); return;
    }
    const menu = menus.findIndex(([name]) => name[0].toLowerCase() === key.toLowerCase());
    if ((event.altKey && !event.ctrlKey && menu >= 0) || key === 'F10') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (key === 'F10' && opened >= 0) close(); else open(menu >= 0 && key !== 'F10' ? menu : 0);
      return;
    }
    if (opened < 0) {
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'o') {
        event.preventDefault(); event.stopImmediatePropagation(); $('open-btn').click();
      } else if (key === 'F1') { event.preventDefault(); event.stopImmediatePropagation(); $('help-btn').click(); }
      return;
    }
    // Menus own keystrokes, including letters otherwise used by the game.
    event.stopImmediatePropagation();
    if (key === 'Tab') { close(); return; }
    event.preventDefault();
    const choices = items(), current = choices.indexOf(document.activeElement);
    if (key === 'Escape' || key === 'Alt') close();
    else if (key === 'ArrowRight') open(opened + 1);
    else if (key === 'ArrowLeft') open(opened - 1);
    else if (key === 'ArrowDown') choices[(current + 1) % choices.length].focus();
    else if (key === 'ArrowUp') choices[(current - 1 + choices.length) % choices.length].focus();
    else if (key === 'Home') choices[0].focus();
    else if (key === 'End') choices[choices.length - 1].focus();
    else if (key === 'Enter' || key === ' ') { if (current >= 0) choices[current].click(); }
    else if (key.length === 1) {
      if (opened === 0 && /^[1-8]$/.test(key)) {
        const recent = popups[0].querySelectorAll('[data-recent]:not(:disabled)')[Number(key) - 1];
        if (recent) { recent.click(); return; }
      }
      const next = choices.slice(current + 1).concat(choices.slice(0,current + 1)).find(b => b.textContent[0].toLowerCase() === key.toLowerCase());
      if (next) next.focus();
    }
  }, true);

  const tabs = [...$('tabs').children];
  $('tabs').setAttribute('role', 'tablist'); $('tabs').setAttribute('aria-label', 'Code windows');
  tabs.forEach((button, index) => {
    button.id = 'tab-button-' + button.dataset.tab;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'tab-' + button.dataset.tab);
    const panel = $('tab-' + button.dataset.tab);
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); event.stopPropagation(); tabs[next].click(); tabs[next].focus(); }
    });
  });
  function syncTabs() {
    tabs.forEach(button => { const on = button.classList.contains('on'); button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; });
    $('code-caption').textContent = tabs.find(button => button.classList.contains('on')).textContent;
  }
  new MutationObserver(syncTabs).observe($('tabs'), { subtree: true, attributes: true, attributeFilter: ['class'] }); syncTabs();
  function syncModes() {
    [...$('mode-seg').children].forEach(button => {
      const on = button.classList.contains('on'); button.setAttribute('aria-pressed', String(on));
      if (on) $('designer-mode').textContent = '[' + button.textContent.trim() + ']';
    });
  }
  new MutationObserver(syncModes).observe($('mode-seg'), { subtree: true, attributes: true, attributeFilter: ['class'] }); syncModes();
  function syncTitle() {
    const name = $('game-title').textContent || 'Level Designer';
    const dirty = $('dirty-dot').classList.contains('on') ? ' *' : '';
    $('caption-document').textContent = name + dirty;
    $('project-document').textContent = name;
    document.title = name + dirty + ' – MIS95';
  }
  const titleObserver = new MutationObserver(syncTitle);
  titleObserver.observe($('game-title'), { childList: true, characterData: true, subtree: true });
  titleObserver.observe($('dirty-dot'), { attributes: true, attributeFilter: ['class'] }); syncTitle();
  function status(event) {
    const control = event.target.closest('[title]');
    $('ui-status').textContent = control ? control.title : 'Ready';
  }
  document.addEventListener('pointerover', status); document.addEventListener('focusin', status);
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) $('ui-status').textContent = 'Ready'; });
  document.querySelectorAll('.mis-code-editor').forEach(element => {
    const cm = element.misEditor;
    cm.on('cursorActivity', () => { const p = cm.getCursor(); $('cursor-status').textContent = 'Ln ' + (p.line + 1) + ', Col ' + (p.ch + 1); });
  });
  // Existing dynamically generated cards retain their handlers and gain keyboard access.
  function accessibleTiles(root, selector, label) {
    function refresh() {
      root.querySelectorAll(selector).forEach((item, index) => {
        item.tabIndex = 0; item.setAttribute('role', 'button');
        item.setAttribute('aria-label', label + ' ' + (index + 1) + ': ' + item.textContent.trim());
        if (item.classList.contains('level-item')) item.setAttribute('aria-pressed', String(item.classList.contains('current')));
      });
    }
    new MutationObserver(refresh).observe(root, { childList: true, subtree: true }); refresh();
    root.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches(selector)) {
        event.preventDefault(); event.stopPropagation(); event.target.click();
      }
    });
  }
  accessibleTiles($('level-list'), '.level-item', 'Level');
  accessibleTiles($('cards'), '.card', 'Suggestion');
  let dialogFocus = null;
  $('about-dialog').addEventListener('beforetoggle', event => { if (event.newState === 'open') dialogFocus = document.activeElement; });
  $('about-dialog').addEventListener('close', () => { if (dialogFocus && dialogFocus.isConnected) dialogFocus.focus({ preventScroll: true }); });
  // Bounded pointer/keyboard splitters; original GUI95 adaptation.
  function splitter(id, axis, property, bounds, initial) {
    const handle = $(id), host = document.body;
    let value = initial(), drag = null;
    try { const saved = Number(localStorage.getItem('mis-ui-' + id)); if (saved > 0 && Number.isFinite(saved)) value = saved; } catch (_) {}
    function apply(next) {
      const [min, max] = bounds();
      value = Math.round(Math.max(min, Math.min(max, next)));
      host.style.setProperty(property, value + 'px');
      handle.setAttribute('aria-valuemin', min);
      handle.setAttribute('aria-valuemax', max);
      handle.setAttribute('aria-valuenow', value);
      handle.setAttribute('aria-valuetext', value + ' pixels');
    }
    function save() { try { localStorage.setItem('mis-ui-' + id, String(value)); } catch (_) {} }
    function finish(cancel) {
      if (!drag) return;
      const previous = drag.value, pointerId = drag.id; drag = null;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      host.classList.remove('resizing-panes');
      if (cancel) apply(previous); else save();
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.focus();
      drag = { id: event.pointerId, position: axis === 'x' ? event.clientX : event.clientY, value };
      handle.setPointerCapture(event.pointerId);
      host.style.setProperty('--resize-cursor', axis === 'x' ? 'col-resize' : 'row-resize');
      host.classList.add('resizing-panes');
    });
    handle.addEventListener('pointermove', event => { if (drag) apply(drag.value - ((axis === 'x' ? event.clientX : event.clientY) - drag.position)); });
    handle.addEventListener('pointerup', () => finish(false));
    handle.addEventListener('pointercancel', () => finish(true));
    handle.addEventListener('lostpointercapture', () => finish(true));
    window.addEventListener('blur', () => finish(true));
    handle.addEventListener('keydown', event => {
      const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp', forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (![back, forward, 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') finish(true);
      else { apply(event.key === 'Home' ? initial() : event.key === 'End' ? bounds()[1] : value + (event.key === back ? 1 : -1) * (event.shiftKey ? 40 : 10)); save(); }
    });
    window.addEventListener('resize', () => apply(value));
    apply(value);
  }
  splitter('code-splitter', 'x', '--code-width', () => [300, Math.max(300, Math.floor(window.innerWidth * .52))], () => Math.round(window.innerWidth * .34));
  splitter('results-splitter', 'y', '--results-height', () => [160, Math.max(160, Math.floor($('stage').clientHeight * .48))], () => 220);
  const refreshEditors = new ResizeObserver(() => document.querySelectorAll('.mis-code-editor').forEach(element => element.misEditor.refresh()));
  refreshEditors.observe($('side'));

})();
