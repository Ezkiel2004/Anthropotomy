// Landing page behaviour: the menu, the signed-in state, the header button, part counts, scroll
// reveals, the practice quiz, the school name and the start of the 3D demo.
// The page is complete without it; everything here only adds to the finished markup.
import {dashboardFor, explorerFor, firstName, sessionCheck, sessionState, partTotals, formatParts} from './landing-core.js?v=20261011-atlas1';

const VERSION = '20261011-atlas1';
const ICONS = `assets/icons/interface.svg?v=${VERSION}`;
const USER_KEY = 'anatomiq_user'; // written by login.js and the portal; the server session stays authoritative
const HEADER_HEIGHT = 64;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const wideViewport = matchMedia('(min-width: 48rem)');

function setIcon(svg, name) {
  svg?.querySelector('use')?.setAttribute('href', `${ICONS}#${name}`);
}

const cachedUser = {
  read() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY)) || null; } catch (_) { return null; }
  },
  write(user) {
    try {
      if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      else sessionStorage.removeItem(USER_KEY);
    } catch (_) { /* Without storage the page still follows the server session. */ }
  },
};

// ── Signed-in state: the cached user first, then the server's answer. ──
function applyAuth({state, user}) {
  const root = document.documentElement;
  if (state === 'signed-in') root.dataset.authState = 'signed-in';
  else delete root.dataset.authState;
  $$('[data-dashboard-link]').forEach(link => { link.href = dashboardFor(user?.role); });
  $$('[data-explorer-link]').forEach(link => { link.href = explorerFor(user?.role); });
  const name = firstName(user?.full_name);
  $$('[data-first-name]').forEach(element => { element.textContent = name; });
  $$('[data-greeting]').forEach(element => { element.hidden = !name; });
}

async function checkSession() {
  try {
    const response = await fetch('api/auth/session.php', {credentials: 'same-origin', headers: {Accept: 'application/json'}});
    const body = await response.json().catch(() => null);
    return sessionCheck(response.status, body);
  } catch (_) {
    return sessionCheck(0, null);
  }
}

function announce(message) {
  const status = $('[data-auth-status]');
  if (!status) return;
  status.textContent = '';
  setTimeout(() => { status.textContent = message; }, 50);
}

async function initAuth() {
  const cached = cachedUser.read();
  applyAuth(sessionState(cached, undefined));
  const result = sessionState(cached, await checkSession());
  if (result.state === 'signed-in') cachedUser.write(result.user); // lets the portal open in this tab
  else if (cached) cachedUser.write(null);
  applyAuth(result);

  $$('[data-sign-out]').forEach(button => button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await fetch('api/auth/logout.php', {method: 'POST', credentials: 'same-origin'});
    } catch (_) { /* Best effort, as in the portal. */ }
    cachedUser.write(null);
    applyAuth({state: 'signed-out', user: null});
    button.disabled = false;
    announce('You are signed out.');
    $('.nav-actions[data-auth="signed-out"] a')?.focus();
  }));
}

// ── Menu below 768 px: a disclosure button that controls the nav panel. ──
function initMenu() {
  const toggle = $('.nav-toggle');
  const panel = $('#siteNav');
  const header = $('.site-header');
  if (!toggle || !panel || !header) return;
  const label = $('span', toggle);
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('is-open', open);
    label.textContent = open ? 'Close' : 'Menu';
    setIcon($('svg', toggle), open ? 'x' : 'list');
  };
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  panel.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener('click', event => { if (isOpen() && !event.target.closest('.site-header')) setOpen(false); });
  // Close when keyboard focus leaves the header entirely.
  header.addEventListener('focusout', event => {
    if (isOpen() && event.relatedTarget && !event.relatedTarget.closest('.site-header')) setOpen(false);
  });
  wideViewport.addEventListener('change', event => { if (event.matches) setOpen(false); });
}

// ── One main button per screen: the header button stays outlined while the hero or closing
//    button is visible, and fills in once neither is. ──
function initHeaderCta() {
  const headerButtons = $$('[data-header-cta]');
  const primaries = $$('[data-primary-cta]');
  if (!headerButtons.length || !primaries.length || !('IntersectionObserver' in window)) return;
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
    const quiet = visible.size > 0;
    headerButtons.forEach(button => {
      button.classList.toggle('btn-quiet', quiet);
      button.classList.toggle('btn-primary', !quiet);
    });
  }, {rootMargin: `-${HEADER_HEIGHT}px 0px 0px 0px`});
  primaries.forEach(element => observer.observe(element));
}

// ── Part counts from the layer manifest. A count that cannot be read stays hidden. ──
async function initPartCounts() {
  const slots = $$('[data-parts]');
  if (!slots.length) return;
  try {
    const response = await fetch('system_model/layers/manifest.json', {credentials: 'same-origin'});
    if (!response.ok) return;
    const counts = new Map(partTotals(await response.json()).systems.map(system => [system.id, system.parts]));
    for (const slot of slots) {
      const count = counts.get(slot.dataset.parts);
      if (count === undefined) continue;
      slot.textContent = formatParts(count);
      slot.hidden = false;
    }
  } catch (_) { /* The names and images are enough without counts. */ }
}

// ── Reveal section visuals once as they scroll in. Skipped entirely with reduced motion. ──
function initReveal() {
  const items = $$('[data-reveal]');
  if (!items.length || reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries, self) => {
    entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
      entry.target.style.transitionDelay = `${index * 40}ms`;
      entry.target.classList.add('is-visible');
      self.unobserve(entry.target);
    });
  }, {rootMargin: '0px 0px -8% 0px'});
  document.documentElement.classList.add('reveal-ready');
  items.forEach(item => observer.observe(item));
}

// ── School name from api/config.php; hidden unless a real name is configured. ──
async function initSchool() {
  $$('[data-current-year]').forEach(element => { element.textContent = String(new Date().getFullYear()); });
  try {
    const response = await fetch('api/config.php', {credentials: 'same-origin'});
    const result = await response.json();
    const name = typeof result?.data?.school_name === 'string' ? result.data.school_name.trim() : '';
    if (!result?.success || !name) return;
    $$('[data-school-name]').forEach(element => { element.textContent = name; });
    $$('[data-school-line]').forEach(element => { element.hidden = false; });
  } catch (_) { /* The school name is optional on this page. */ }
}

// ── Practice quiz: four question types, local only, nothing is sent. ──
function initQuizDemo() {
  const demo = $('[data-quiz-demo]');
  if (!demo) return;
  const tabs = $$('[role="tab"]', demo);
  const status = $('[data-demo-status]', demo);
  const answered = new Set();
  const panelOf = tab => document.getElementById(tab.getAttribute('aria-controls'));

  const showStatus = panel => {
    const saved = answered.has(panel.id);
    status.classList.toggle('is-saved', saved);
    setIcon($('svg', status), saved ? 'check-circle' : 'clock');
    $('span', status).textContent = saved ? 'Answer saved.' : 'Answer a question to see it save.';
  };
  const markAnswered = (panel, isAnswered = true) => {
    if (isAnswered) answered.add(panel.id); else answered.delete(panel.id);
    showStatus(panel);
  };
  const select = (tab, moveFocus) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      panelOf(other).hidden = !selected;
    }
    if (moveFocus) tab.focus();
    showStatus(panelOf(tab));
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', event => {
      const keys = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
      let next = null;
      if (event.key in keys) next = tabs[(index + keys[event.key] + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next, true);
    });
  });

  let typingTimer = 0;
  $$('[data-demo-answer]', demo).forEach(input => {
    const panel = input.closest('[role="tabpanel"]');
    if (input.type === 'text') {
      input.addEventListener('input', () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => markAnswered(panel, input.value.trim() !== ''), 400);
      });
    } else {
      input.addEventListener('change', () => markAnswered(panel));
    }
  });

  const hotspot = $('[data-demo-hotspot]', demo);
  const pin = hotspot && $('.hotspot-pin', hotspot);
  if (hotspot && pin) {
    const panel = hotspot.closest('[role="tabpanel"]');
    const place = (x, y) => {
      pin.style.left = `${Math.min(Math.max(x, 2), 98)}%`;
      pin.style.top = `${Math.min(Math.max(y, 3), 97)}%`;
      pin.hidden = false;
      markAnswered(panel);
    };
    hotspot.addEventListener('click', event => {
      // A keyboard "click" has no pointer position; start from the centre.
      if (event.detail === 0) { if (pin.hidden) place(50, 50); return; }
      const rect = hotspot.getBoundingClientRect();
      place((event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100);
    });
    hotspot.addEventListener('keydown', event => {
      const step = {ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -6], ArrowDown: [0, 6]}[event.key];
      if (!step || pin.hidden) return;
      event.preventDefault();
      place(parseFloat(pin.style.left) + step[0], parseFloat(pin.style.top) + step[1]);
    });
  }
}

// ── 3D demo: starts by itself on screens 768 px and wider once the hero is visible and the page is
//    idle, unless the visitor prefers reduced motion or saves data. Everywhere else a button loads it
//    on request. Without WebGL the poster is the hero. ──
function saveData() {
  const connection = navigator.connection;
  return Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
}
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch (_) {
    return false;
  }
}
function initDemo() {
  const demo = $('[data-demo]');
  if (!demo || !hasWebGL()) return;
  const tryButton = $('[data-demo-try]', demo);
  const tryLabel = $('[data-try-label]', tryButton);
  const tryText = tryLabel.textContent;
  let running = false;
  const showTry = () => { tryButton.disabled = false; tryLabel.textContent = tryText; tryButton.hidden = false; };
  const start = async automatic => {
    if (running) return;
    running = true;
    if (!automatic) { tryButton.disabled = true; tryLabel.textContent = 'Loading 3D…'; }
    try {
      const {mountDemo} = await import(`./landing-hero-3d.js?v=${VERSION}`);
      const view = await mountDemo(demo, {
        automatic, wideViewport, reducedMotion,
        onProgress: fraction => { if (!automatic) tryLabel.textContent = `Loading 3D ${Math.round(fraction * 100)}%`; },
        onEnd: reason => {
          running = false;
          // Only a phone-sized screen or leaving the page stops a working demo; offer it again then.
          if (reason === 'narrow' || reason === 'pagehide') showTry(); else tryButton.hidden = true;
        },
      });
      if (view) tryButton.hidden = true;
    } catch (error) {
      running = false;
      tryButton.hidden = true;
      console.info('3D demo unavailable; the poster stays.', error?.message || error);
    }
  };
  tryButton.addEventListener('click', () => start(false));
  const automatic = wideViewport.matches && !reducedMotion.matches && !saveData();
  if (!automatic || !('IntersectionObserver' in window)) { showTry(); return; }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    const go = () => start(true);
    if ('requestIdleCallback' in window) requestIdleCallback(go, {timeout: 1500});
    else setTimeout(go, 200);
  }, {threshold: 0.25});
  observer.observe(demo);
}

initAuth();
initMenu();
initHeaderCta();
initPartCounts();
initReveal();
initSchool();
initQuizDemo();
initDemo();
