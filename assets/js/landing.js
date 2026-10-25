// Landing page behaviour: mobile menu, signed-in state, the hero card carousel, scroll
// reveals, school settings and the practice quiz demo. Small and dependency-free; the
// page is complete without it.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const media = query => window.matchMedia(query);
const reducedMotion = media('(prefers-reduced-motion: reduce)');
const wideNav = media('(min-width: 72rem)');
const ICONS = 'assets/icons/interface.svg?v=20261012-icons3';

function setIcon(svg, name) {
  svg?.querySelector('use')?.setAttribute('href', `${ICONS}#${name}`);
}

// ── Mobile menu: a disclosure button that controls the nav panel. ──
function initMenu() {
  const toggle = $('[aria-controls="siteNav"]');
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
  document.addEventListener('click', event => { if (isOpen() && !event.target.closest('.hx-header')) setOpen(false); });
  // Close when keyboard focus leaves the header entirely.
  $('.hx-header').addEventListener('focusout', event => {
    if (isOpen() && event.relatedTarget && !event.relatedTarget.closest('.hx-header')) setOpen(false);
  });
  wideNav.addEventListener('change', event => { if (event.matches) setOpen(false); });
}

// ── Signed-in visitors see the same page with their own actions: a greeting,
//    a link to their dashboard and Sign out. The static HTML is the signed-out
//    state, so a failed or slow session check changes nothing. ──
function initAuth() {
  fetch('api/auth/session.php', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(response => (response.ok ? response.json() : null))
    .then(result => {
      if (!result?.success || !result.data) return;
      const user = result.data;
      const staff = ['teacher', 'admin'].includes(user.role);
      const firstName = String(user.full_name || user.username || '').trim().split(/\s+/)[0];
      $$('[data-member-name]').forEach(element => { element.textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back'; });
      $$('[data-dashboard-link]').forEach(link => { link.href = `${staff ? 'teacher' : 'student'}/dashboard.html`; });
      if (staff) $$('[data-dashboard-label]').forEach(label => { label.textContent = 'Go to teacher dashboard'; });
      $$('[data-auth="guest"]').forEach(element => { element.hidden = true; });
      $$('[data-auth="member"]').forEach(element => { element.hidden = false; });
      $$('[data-member-initial]').forEach(element => { element.textContent = firstName.charAt(0).toUpperCase(); element.hidden = !firstName; });
    })
    .catch(() => { /* Stay in the signed-out state. */ });

  $$('[data-sign-out]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await fetch('api/auth/logout.php', { method: 'POST', credentials: 'same-origin' }); } catch (_) { /* Best effort. */ }
    try { sessionStorage.removeItem('anthropotomy_user'); } catch (_) { /* Storage may be unavailable. */ }
    location.replace(location.pathname);
  }));
}

// ── Hero cards: a fan carousel. Clicking a side card, the arrow keys, a swipe or the
//    header search brings a system to the front; CSS lifts a card on hover or focus. ──
function initDeck() {
  const deck = $('[data-deck]');
  if (!deck) return;
  const slides = $$('.hx-slide', deck);
  const count = slides.length;
  const half = Math.floor(count / 2);
  let active = 0;
  const show = index => {
    active = (index + count) % count;
    slides.forEach((slide, i) => {
      const offset = ((i - active + count + half) % count) - half;
      const card = $('button', slide);
      slide.style.setProperty('--d', offset);
      slide.toggleAttribute('data-far', Math.abs(offset) > 2);
      card.setAttribute('aria-current', String(offset === 0));
      card.tabIndex = Math.abs(offset) > 2 ? -1 : 0;
    });
  };

  let swiped = false;
  slides.forEach((slide, i) => $('button', slide).addEventListener('click', () => {
    if (swiped) { swiped = false; return; }
    show(i);
  }));
  deck.addEventListener('keydown', event => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    show(active + step);
    $('button', slides[active]).focus();
  });
  let startX = null;
  deck.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') startX = event.clientX; });
  deck.addEventListener('pointerup', event => {
    if (startX === null) return;
    const distance = event.clientX - startX;
    startX = null;
    if (Math.abs(distance) < 40) return;
    swiped = true;
    setTimeout(() => { swiped = false; }, 0);
    show(active + (distance < 0 ? 1 : -1));
  });

  const search = $('[data-deck-search]');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    if (!query) return;
    const match = slides.findIndex(slide => slide.dataset.name.includes(query));
    if (match >= 0) show(match);
  });
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

// ── Body system count from api/config.php; hidden unless the API returns a real number. ──
function initSchoolSettings() {
  $$('[data-current-year]').forEach(element => { if (!element.textContent) element.textContent = String(new Date().getFullYear()); });
  if (typeof SiteConfig === 'undefined' || !SiteConfig.ready) return;
  SiteConfig.ready.then(data => {
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

initMenu();
initAuth();
initDeck();
initReveal();
initSchoolSettings();
initQuizDemo();
