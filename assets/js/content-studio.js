/* Content studio kit for the teacher Modules and Assessments pages: icons, status labels, the "more"
   menu and the side sheet editor. One global, Studio. Needs app.js (confirmToast) and content-studio.css. */
'use strict';
const Studio = (() => {
  const SPRITE = new URL('../icons/interface.svg?v=20261111-icons4', document.currentScript.src).href;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let uid = 0;

  function icon(name, cls = '') {
    return `<svg class="cs-ico${cls ? ' ' + esc(cls) : ''}" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${SPRITE}#${token(name)}"/></svg>`;
  }

  // A dot and a word: published and active mint, draft amber, closed and archived grey.
  // { plain: true } sits on a raised grey pill for rows and cards without system art behind it.
  const STATUS_LABELS = { published: 'Published', active: 'Active', draft: 'Draft', closed: 'Closed', archived: 'Archived' };
  function status(value, { plain = false } = {}) {
    const key = token(value);
    const label = STATUS_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1).replace(/_/g, ' ') : 'Unknown');
    return `<span class="cs-status${plain ? ' cs-status--plain' : ''} cs-status--${key}">${esc(label)}</span>`;
  }

  // ── Menu ─────────────────────────────────────────────────────
  // One open at a time. Arrow keys, Home and End move between items; Escape, Tab and a click
  // outside close it, and focus goes back to the anchor. Opening the same anchor again closes it.
  let openMenu = null;
  function closeMenu(restoreFocus = true) {
    if (!openMenu) return;
    const { el, anchor, cleanup } = openMenu;
    openMenu = null;
    cleanup();
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
    anchor.removeAttribute('aria-controls');
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function placeMenu(el, anchor) {
    const box = anchor.getBoundingClientRect(), gap = 6, edge = 8;
    const { width, height } = el.getBoundingClientRect();
    let left = Math.min(box.right - width, innerWidth - width - edge);
    let top = box.bottom + gap;
    if (top + height > innerHeight - edge && box.top - height - gap > edge) top = box.top - height - gap;
    el.style.left = Math.max(edge, left) + 'px';
    el.style.top = Math.max(edge, top) + 'px';
  }
  function menu(anchor, items) {
    if (openMenu) {
      const same = openMenu.anchor === anchor;
      closeMenu(same);
      if (same) return;
    }
    const el = document.createElement('div');
    el.className = 'cs-menu';
    el.id = 'cs-menu-' + (++uid);
    el.setAttribute('role', 'menu');
    if (anchor.getAttribute('aria-label')) el.setAttribute('aria-label', anchor.getAttribute('aria-label'));
    items.forEach((item, i) => {
      if (item.danger && i > 0 && !items[i - 1].danger) el.insertAdjacentHTML('beforeend', '<div class="cs-menu-sep" role="separator"></div>');
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'cs-menu-item' + (item.danger ? ' cs-menu-item--danger' : '');
      button.setAttribute('role', 'menuitem');
      button.innerHTML = (item.icon ? icon(item.icon) : '') + `<span>${esc(item.label)}</span>`;
      button.addEventListener('click', () => { closeMenu(true); item.onSelect?.(); });
      el.append(button);
    });
    document.body.append(el);
    placeMenu(el, anchor);
    anchor.setAttribute('aria-haspopup', 'menu');
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', el.id);
    const buttons = [...el.querySelectorAll('[role="menuitem"]')];
    const focusItem = button => button?.focus({ preventScroll: true });
    const move = step => focusItem(buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length]);
    el.addEventListener('keydown', event => {
      const keys = { ArrowDown: () => move(1), ArrowUp: () => move(-1), Home: () => focusItem(buttons[0]), End: () => focusItem(buttons.at(-1)), Escape: () => closeMenu(true), Tab: () => closeMenu(true) };
      if (!keys[event.key]) return;
      event.preventDefault();
      event.stopPropagation();
      keys[event.key]();
    });
    const outside = event => {
      if (el.contains(event.target) || anchor.contains(event.target)) return;
      closeMenu(false);
      setTimeout(() => { if (document.activeElement === document.body && anchor.isConnected) anchor.focus({ preventScroll: true }); });
    };
    const away = () => closeMenu(el.contains(document.activeElement));
    document.addEventListener('pointerdown', outside, true);
    addEventListener('resize', away);
    addEventListener('scroll', away, true);
    openMenu = { el, anchor, cleanup: () => {
      document.removeEventListener('pointerdown', outside, true);
      removeEventListener('resize', away);
      removeEventListener('scroll', away, true);
    } };
    focusItem(buttons[0]);
  }

  // ── Sheet ────────────────────────────────────────────────────
  // A side editor (size 'side') or a centred one (size 'center'); full screen below 640 px. Escape,
  // the scrim and Close all call close(), which asks before discarding unsaved changes. Typing in
  // any field marks it dirty; setDirty(false) after a save lets close() go without asking.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function sheet({ eyebrow = '', title = '', body, footer, size = 'side' }) {
    const opener = document.activeElement;
    const titleId = 'cs-sheet-title-' + (++uid);
    const scrim = document.createElement('div');
    scrim.className = 'cs-scrim';
    const root = document.createElement('div');
    root.className = size === 'center' ? 'cs-modal' : 'cs-sheet';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', titleId);
    root.innerHTML = `<div class="cs-sheet-head"><div>${eyebrow ? `<span class="cs-eyebrow">${esc(eyebrow)}</span>` : ''}<h3 id="${titleId}">${esc(title)}</h3></div>`
      + `<button type="button" class="cs-icon-btn" data-sheet-close aria-label="Close">${icon('x')}</button></div>`;
    if (body) { body.classList.add('cs-sheet-body'); root.append(body); }
    if (footer) { footer.classList.add('cs-sheet-foot'); root.append(footer); }

    // Everything behind the sheet stops taking focus and clicks until it closes.
    const behind = [...document.body.children].filter(el => !el.inert && !/^(SCRIPT|STYLE|LINK|DIALOG)$/.test(el.tagName));
    behind.forEach(el => { el.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.append(scrim, root);

    let dirty = false, closed = false, pending = null, busy = false;
    const markDirty = () => { dirty = true; };
    root.addEventListener('input', markDirty);
    root.addEventListener('change', markDirty);
    const focusables = () => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length);
    const onKey = event => {
      if (closed || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const at = list.indexOf(document.activeElement);
      if (event.shiftKey && at <= 0) { event.preventDefault(); list.at(-1).focus(); }
      else if (!event.shiftKey && (at === -1 || at === list.length - 1)) { event.preventDefault(); list[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', () => close());
    root.querySelector('[data-sheet-close]').addEventListener('click', () => close());

    function teardown() {
      closed = true;
      document.removeEventListener('keydown', onKey);
      scrim.remove();
      root.remove();
      behind.forEach(el => { el.inert = false; });
      document.body.style.overflow = overflow;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    }
    function close() {
      if (closed) return Promise.resolve(true);
      if (busy) return Promise.resolve(false);
      if (pending) return pending;
      pending = (async () => {
        if (dirty) {
          const discard = await confirmToast({ title: 'Discard changes?', message: 'Your changes have not been saved.', confirmText: 'Discard', cancelText: 'Keep editing' });
          if (!discard) return false;
        }
        teardown();
        return true;
      })().finally(() => { pending = null; });
      return pending;
    }

    const first = root.querySelector('[autofocus]') || focusables().find(el => !el.matches('[data-sheet-close]')) || root.querySelector('[data-sheet-close]');
    first.focus({ preventScroll: true });
    if (first.matches('input[type="text"], input:not([type]), textarea')) first.setSelectionRange(first.value.length, first.value.length);
    // setBusy(true) while a save is in flight: close() refuses (Escape, scrim, Close) and the Close button is disabled.
    return { root, close, setDirty(value) { dirty = Boolean(value); }, setBusy(value) { busy = Boolean(value); root.querySelector('[data-sheet-close]').disabled = busy; } };
  }

  return { icon, status, menu, closeMenu, sheet };
})();
