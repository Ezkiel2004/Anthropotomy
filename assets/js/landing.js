// Landing page behaviour: mobile menu, header CTA state, scroll reveals, school
// settings, the practice quiz demo and the optional live 3D hero.
// Small and dependency-free; the page is complete without it.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const media = query => window.matchMedia(query);
const reducedMotion = media('(prefers-reduced-motion: reduce)');
const wideViewport = media('(min-width: 48rem)');
const ICONS = 'assets/icons/interface.svg?v=20261005-landing1';
const HEADER_HEIGHT = 64;

function setIcon(svg, name) {
  svg?.querySelector('use')?.setAttribute('href', `${ICONS}#${name}`);
}

// ── Mobile menu: a disclosure button that controls the nav panel. ──
function initMenu() {
  const toggle = $('.nav-toggle');
  const panel = $('#siteNav');
  if (!toggle || !panel) return;
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
  $('.site-header').addEventListener('focusout', event => {
    if (isOpen() && event.relatedTarget && !event.relatedTarget.closest('.site-header')) setOpen(false);
  });
  wideViewport.addEventListener('change', event => { if (event.matches) setOpen(false); });
}

// ── One primary CTA per viewport: the header CTA stays outlined while the hero
//    or closing CTA is on screen, and fills in once neither is visible. ──
function initHeaderCta() {
  const headerCta = $('[data-header-cta]');
  const primaries = $$('[data-primary-cta]');
  if (!headerCta || !primaries.length || !('IntersectionObserver' in window)) return;
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
    const quiet = visible.size > 0;
    headerCta.classList.toggle('btn-quiet', quiet);
    headerCta.classList.toggle('btn-primary', !quiet);
  }, { rootMargin: `-${HEADER_HEIGHT}px 0px 0px 0px` });
  primaries.forEach(element => observer.observe(element));
}

// ── Reveal feature figures as they scroll in. Skipped entirely with reduced motion. ──
function initReveal() {
  const items = $$('[data-reveal]');
  if (!items.length || reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries, self) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      self.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.documentElement.classList.add('reveal-ready');
  items.forEach(item => observer.observe(item));
}

// ── School settings from api/config.php. Elements stay hidden unless the API
//    returns a real value: no placeholders, no invented numbers. ──
function initSchoolSettings() {
  $$('[data-current-year]').forEach(element => { if (!element.textContent) element.textContent = String(new Date().getFullYear()); });
  if (typeof SiteConfig === 'undefined' || !SiteConfig.ready) return;
  SiteConfig.ready.then(data => {
    if (typeof data.school_name === 'string' && data.school_name.trim()) $$('[data-school-line]').forEach(element => { element.hidden = false; });
    const count = Number(data.system_count);
    if (Number.isInteger(count) && count > 0) $$('[data-system-count-line]').forEach(element => { element.hidden = false; });
  }).catch(() => { /* Settings are optional on this page. */ });
}

// ── Practice quiz demo: four question types, local only, nothing is sent. ──
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
    $('span', status).textContent = saved
      ? 'Answer saved. In a real quiz, refreshing the page keeps it, along with your remaining time.'
      : 'Answer a question to see it save.';
  };
  const markAnswered = (panel, isAnswered = true) => {
    isAnswered ? answered.add(panel.id) : answered.delete(panel.id);
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
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
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
      const step = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -6], ArrowDown: [0, 6] }[event.key];
      if (!step || pin.hidden) return;
      event.preventDefault();
      place(parseFloat(pin.style.left) + step[0], parseFloat(pin.style.top) + step[1]);
    });
  }
}

// ── Live 3D hero: only on capable, wide screens that have not asked for less
//    motion or data. Anything else keeps the finished poster. ──
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
function initHero3d() {
  const plate = $('[data-hero-3d]');
  if (!plate || !('IntersectionObserver' in window)) return;
  if (!wideViewport.matches || reducedMotion.matches || saveData() || !hasWebGL()) return;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    const start = () => import('./landing-hero-3d.js?v=20261005-landing1')
      .then(module => module.mountHero3d(plate, { wideViewport, reducedMotion }))
      .catch(() => { /* The poster is already a finished hero. */ });
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1500 });
    else setTimeout(start, 200);
  }, { threshold: 0.25 });
  observer.observe(plate);
}

initMenu();
initHeaderCta();
initReveal();
initSchoolSettings();
initQuizDemo();
initHero3d();
