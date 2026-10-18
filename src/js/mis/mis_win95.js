/* Win95 workbench chrome. Commands delegate to the existing MIS controls. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const target = selector => document.querySelector(selector);
  const click = selector => () => target(selector).click();
  const menus = [
    ['File', [
      ['Open game…', '#open-btn', 'Ctrl+O'], ['Save game', '#save-btn', 'Ctrl+S'], null,
      ['Choose demo…', () => $('demo-select').focus()],
    ]],
    ['Edit', [
      ['Undo level edit', '#undo-btn', 'Ctrl+Z'], ['Redo level edit', '#redo-btn', 'Ctrl+Shift+Z'], null,
      ['Duplicate level', '#dup-level'], ['Unlock all tiles', '#lock-none'], ['Invert tile locks', '#lock-invert'],
    ]],
    ['View', [
      ['Transform code', '[data-tab="transform"]'], ['Game source', '[data-tab="source"]'],
      ['Blind mode', () => $('blind-toggle').click()],
    ]],
    ['Run', [
      ['Edit level', '[data-mode="edit"]', 'E'], ['Lock tiles', '[data-mode="lock"]', 'L'],
      ['Playtest', '[data-mode="play"]', 'P'], null,
      ['Generate / stop', '#gen-btn', 'G'], ['Peek a sample', '#peek-btn'],
      ['Watch solution', '#watch-btn'], ['Simplify level', '#simplify-btn'],
    ]],
    ['Help', [['Workbench help', '#help-btn', 'F1'], null, ['About PuzzleScript+MIS…', () => $('about-dialog').showModal()]]],
  ];
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
    const overflow = popup.getBoundingClientRect().right - window.innerWidth + 4;
    if (overflow > 0) popup.style.left = -overflow + 'px';
    triggers[opened].setAttribute('aria-expanded', 'true');
    if (focus) items()[0].focus();
  }
  menus.forEach(([name, entries], index) => {
    const wrap = document.createElement('div'); wrap.className = 'menu-wrap';
    const trigger = document.createElement('button'); trigger.className = 'menu-trigger';
    trigger.innerHTML = '<u>' + name[0] + '</u>' + name.slice(1);
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
      if (shortcut) { const key = document.createElement('span'); key.className = 'menu-shortcut'; key.textContent = shortcut; button.append(key); }
      if (typeof action === 'string') button.dataset.command = action;
      if (typeof action === 'string' && action.startsWith('[data-mode=')) button.setAttribute('role', 'menuitemradio');
      if (label === 'Blind mode') button.setAttribute('role', 'menuitemcheckbox');
      button.addEventListener('click', () => { close(); (typeof action === 'string' ? click(action) : action)(); });
      popup.append(button);
    });
    trigger.addEventListener('click', () => opened === index ? close() : open(index));
    trigger.addEventListener('pointerenter', () => { if (opened >= 0 && opened !== index) open(index); });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); open(index); }
    });
    wrap.append(trigger, popup); $('menubar').append(wrap); triggers.push(trigger); popups.push(popup);
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#menubar')) close(false); });
  window.addEventListener('blur', () => close(false));
  document.addEventListener('keydown', event => {
    if ($('about-dialog').open) return;
    const key = event.key;
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
    document.title = name + dirty + ' – PuzzleScript+MIS';
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
  document.querySelectorAll('.CodeMirror').forEach(element => {
    const cm = element.CodeMirror;
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
  $('about-dialog').addEventListener('close', () => { if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true }); });
})();
