/* ============================================================
   Anthropotomy – Shared App Utilities  (v1.1)
   ============================================================ */

'use strict';

// ── API Base Path ──────────────────────────────────────────────
// Resolves correctly whether we're in /student/, /teacher/, or root.
const API_BASE = new URL('../../api', document.currentScript.src).pathname;

// ── Session Management ──────────────────────────────────────────
// Thrown once a protected page has started redirecting to sign-in, so the rest of the
// page script (its data loads) never runs. Expected, so it is kept out of the console.
class AuthRedirect extends Error {
    constructor() { super('Redirecting to sign-in'); this.name = 'AuthRedirect'; }
}
window.addEventListener('error', event => { if (event.error instanceof AuthRedirect) event.preventDefault(); });

const Auth = {
    /**
     * Get the locally cached user object from sessionStorage.
     * This is a fast sync read used for immediate UI population.
     */
    getUser() {
        try { return JSON.parse(sessionStorage.getItem('anthropotomy_user')); }
        catch (e) { return null; }
    },

    /**
     * Validate session with the server, then enforce role access.
     * Redirects to login if not authenticated or wrong role.
     * Called on every protected page load.
     */
    async requireAuth(role) {
        // First, quick client-side check to avoid flash of content
        const cached = this.getUser();
        if (!cached) {
            this._redirectToLogin();
            return null;
        }

        // Then verify with server (async, authoritative check)
        try {
            const res    = await fetch(`${API_BASE}/auth/session.php`, { credentials: 'same-origin' });
            const result = await res.json();

            if (!result.success) {
                sessionStorage.removeItem('anthropotomy_user');
                this._redirectToLogin();
                return null;
            }

            const user = result.data;

            // Update cached data with fresh server data
            sessionStorage.setItem('anthropotomy_user', JSON.stringify(user));

            // Role check
            if (role && user.role !== role && user.role !== 'admin') {
                this._redirectToLogin();
                return null;
            }

            // Refresh UI with fresh user data
            this._populateUserUI(user);
            return user;

        } catch (err) {
            // Server unreachable — fall back to cached session for development
            console.warn('[Anthropotomy] Server session check failed, using cached session:', err.message);
            if (cached && role && cached.role !== role && cached.role !== 'admin') {
                this._redirectToLogin();
                return null;
            }
            this._populateUserUI(cached);
            return cached;
        }
    },

    /**
     * Synchronous version of requireAuth for inline script usage.
     * Kicks off async server validation in the background.
     */
    requireAuthSync(role) {
        const user = this.getUser();
        if (!user || (role && user.role !== role && user.role !== 'admin')) {
            this._redirectToLogin();
            throw new AuthRedirect();
        }
        // Fire async validation (updates UI when done)
        this.requireAuth(role).catch(() => {});
        return user;
    },

    /**
     * Sign out: destroy server session, clear client data, redirect.
     */
    async logout() {
        try {
            await fetch(`${API_BASE}/auth/logout.php`, {
                method:      'POST',
                credentials: 'same-origin',
            });
        } catch (e) {
            // Best effort
        }
        sessionStorage.removeItem('anthropotomy_user');
        this._redirectToLogin();
    },

    _redirectToLogin() {
        // Determine correct path depth
        window.location.href = API_BASE.replace(/\/api$/, '') + '/login.html';
    },

    _populateUserUI(user) {
        user = user || this.getUser();
        if (!user) return;
        const name     = user.full_name || user.name || user.username || '';
        const subtitle = user.context   || user.role  || '';
        const av       = initials(name);

        document.querySelectorAll('.topbar-user-name').forEach(el => el.textContent = name);
        document.querySelectorAll('.topbar-user-role').forEach(el => el.textContent = subtitle);
        // The uploaded photo when there is one, otherwise initials.
        document.querySelectorAll('.topbar .avatar, [data-user-avatar]').forEach(el => {
            if (user.profile_pic) el.innerHTML = `<img src="${escHtml(user.profile_pic)}" alt="">`;
            else el.textContent = av;
        });

        const pendingAssessments = sessionStorage.getItem('anthropotomy_pending_assessments');
        if (pendingAssessments !== null) {
            document.querySelectorAll('.sidebar-nav a[href*="quiz"] .nav-badge').forEach(b => {
                b.textContent = pendingAssessments;
                b.style.display = parseInt(pendingAssessments) > 0 ? 'inline-block' : 'none';
            });
        }
    }
};

// ── Account menu ────────────────────────────────────────────────
// The topbar's user block becomes a button that opens Profile, Settings and
// Logout, the same on the student and teacher portals.
const AccountMenu = {
    init() {
        const accountLink = document.querySelector('.topbar .topbar-user');
        if (!accountLink) return;
        const account = document.createElement('div');
        account.className = 'account-menu';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'topbar-user';
        trigger.id = 'accountMenuButton';
        trigger.setAttribute('aria-label', 'Account menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', 'accountDropdown');
        while (accountLink.firstChild) trigger.appendChild(accountLink.firstChild);
        trigger.insertAdjacentHTML('beforeend', '<svg class="account-chevron ui-icon" width="14" height="14" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261112-icons5#caret-down"/></svg>');
        const menu = document.createElement('div');
        menu.className = 'account-dropdown';
        menu.id = 'accountDropdown';
        menu.hidden = true;
        menu.innerHTML = '<a href="settings.html#profile">Profile</a><a href="settings.html#settings">Settings</a><button type="button" data-logout>Logout</button>';
        account.append(trigger, menu);
        accountLink.replaceWith(account);

        const bell = document.getElementById('notifBtn');
        const notifications = document.getElementById('notifDropdown');
        const closeAccount = () => {
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        };
        const openAccount = () => {
            if (notifications) notifications.style.display = 'none';
            bell?.setAttribute('aria-expanded', 'false');
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        };
        const menuItems = [...menu.querySelectorAll('a, button')];
        trigger.addEventListener('click', () => {
            if (menu.hidden) openAccount();
            else closeAccount();
        });
        trigger.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            openAccount();
            menuItems[event.key === 'ArrowUp' ? menuItems.length - 1 : 0].focus();
        });
        menu.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let index = menuItems.indexOf(document.activeElement);
            if (event.key === 'Home') index = 0;
            else if (event.key === 'End') index = menuItems.length - 1;
            else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
            menuItems[index].focus();
        });
        menu.addEventListener('click', event => {
            if (event.target.closest('a, button')) {
                closeAccount();
                trigger.focus({ preventScroll: true });
            }
        });
        const dismissOutside = event => {
            if (!account.contains(event.target)) closeAccount();
        };
        document.addEventListener('pointerdown', dismissOutside);
        document.addEventListener('click', dismissOutside);
        // A pointer press on menu padding can blur the trigger without leaving the
        // account control. Wait for an actual outside focus target before closing.
        document.addEventListener('focusin', dismissOutside);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !menu.hidden) { closeAccount(); trigger.focus(); }
        });
        bell?.addEventListener('click', closeAccount);
    }
};

// ── Sidebar Toggle ──────────────────────────────────────────────
const Sidebar = {
    init() {
        const sidebar   = document.querySelector('.sidebar');
        const toggleBtn = document.querySelector('#sidebarToggle, .topbar-toggle');
        const overlay   = document.querySelector('.sidebar-overlay');
        if (!sidebar) return;
        const syncToggle = () => {
            const open = window.innerWidth > 1024 ? !sidebar.classList.contains('collapsed') : sidebar.classList.contains('mobile-open');
            toggleBtn?.setAttribute('aria-expanded', String(open));
            toggleBtn?.setAttribute('aria-controls', sidebar.id);
            toggleBtn?.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar');
        };
        syncToggle();
        window.addEventListener('resize', syncToggle);

        // Desktop collapse / Mobile drawer
        toggleBtn?.addEventListener('click', () => {
            if (window.innerWidth > 1024) {
                sidebar.classList.toggle('collapsed');
                document.querySelector('.main-content')?.classList.toggle('expanded');
                const topbar = document.querySelector('.topbar');
                if (topbar) {
                    topbar.style.left = sidebar.classList.contains('collapsed')
                        ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)';
                }
            } else {
                sidebar.classList.toggle('mobile-open');
                overlay?.classList.toggle('visible');
            }
            syncToggle();
        });

        // Close on overlay click or swipe
        overlay?.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('visible');
            syncToggle();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
                sidebar.classList.remove('mobile-open');
                overlay?.classList.remove('visible');
                syncToggle();
                toggleBtn?.focus();
            }
        });

        // Swipe left to close on mobile
        let touchStartX = 0;
        sidebar.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
        sidebar.addEventListener('touchend',   e => {
            const delta = touchStartX - e.changedTouches[0].clientX;
            if (delta > 60) {
                sidebar.classList.remove('mobile-open');
                overlay?.classList.remove('visible');
                syncToggle();
            }
        }, { passive: true });

        // Active nav link highlighting
        const currentFile = window.location.pathname.split('/').pop();
        document.querySelectorAll('.nav-item').forEach(link => {
            const href = link.getAttribute('href');
            const active = Boolean(href && new URL(href, location.href).pathname.split('/').pop() === currentFile);
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }
};

// ── Notification Dropdown ───────────────────────────────────────
const Notifications = {
    items: [],    // Populated from API
    loaded: false,

    async load(force = false) {
        if (this.loaded && !force) return;
        try {
            const res    = await fetch(`${API_BASE}/notifications.php`, { credentials: 'same-origin' });
            const result = await res.json();
            if (result.success && Array.isArray(result.data)) {
                this.setItems(result.data);
            }
        } catch (e) {
            // Fallback: keep items empty; notifications page handles its own data
            this.loaded = false;
        }
    },

    setItems(items) {
        this.items = items;
        this.loaded = true;
        this.render();
        this._updateBadge();
        document.dispatchEvent(new CustomEvent('notifications:updated', { detail: this.items }));
    },

    render() {
        const list = document.querySelector('#notifDropdown .notif-list');
        if (!list) return;

        if (!this.loaded) {
            list.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted);">Unable to load notifications. Please reopen to try again.</div>';
            return;
        }

        if (this.items.length === 0) {
            list.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted);font-size:0.82rem;">No notifications yet.</div>';
            return;
        }

        list.innerHTML = this.items.slice(0, 6).map(n => `
            <div class="notif-item ${n.unread ? 'unread' : ''}" role="button" tabindex="0" onclick="Notifications.open('${n.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
                <div class="notif-item-icon" style="background:${n.bg || 'rgba(59,130,246,0.15)'};display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">
                    ${n.icon || '<svg width="15" height="15" class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261112-icons5#bell"/></svg>'}
                </div>
                <div class="notif-item-content">
                    <div class="notif-item-title">${escHtml(n.title)}</div>
                    <div class="notif-item-body">${escHtml(n.body)}</div>
                    <div class="notif-item-time">${escHtml(n.time || '')}</div>
                </div>
            </div>
        `).join('');
    },

    async toggle() {
        const dd = document.getElementById('notifDropdown');
        if (!dd) return;
        const isVisible = dd.style.display !== 'none';
        dd.style.display = isVisible ? 'none' : 'block';
        document.getElementById('notifBtn')?.setAttribute('aria-expanded', String(!isVisible));
        if (!isVisible) {
            await this.load(true);
            this.render();
        }
    },

    async open(id) {
        const item = this.items.find(n => n.id === id);
        if (!item) return;
        if (item.unread && !await this.markRead(id)) return;
        if (item.action && item.action !== '#') {
            const destination = new URL(item.action, location.href);
            if (destination.origin === location.origin) location.href = destination.href;
        }
    },

    async markRead(id) {
        return this._saveRead({ id });
    },

    async markAllRead() {
        return this._saveRead({ all: true });
    },

    async _saveRead(body) {
        try {
            const response = await fetch(`${API_BASE}/notifications/mark-read.php`, {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body:        JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('Unable to mark notifications as read.');
            this.setItems(this.items.map(item => body.all || item.id === body.id ? { ...item, unread: false } : item));
            return true;
        } catch (e) {
            showToast('Unable to mark notifications as read. Please try again.', 'error');
            return false;
        }
    },

    _updateBadge() {
        const unread = this.items.filter(n => n.unread).length;
        const dot    = document.querySelector('.notif-dot');
        if (dot) {
            dot.style.display = unread > 0 ? 'flex' : 'none';
            if (document.body.classList.contains('student-dashboard')) dot.textContent = unread;
        }
        document.getElementById('notifBtn')?.setAttribute('aria-label', unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, no unread notifications');

        document.querySelectorAll('.sidebar-nav a[href*="notifications"] .nav-badge').forEach(badge => {
            badge.textContent = unread;
            badge.style.display = unread > 0 ? 'inline-block' : 'none';
        });
    }
};

// ── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span>${escHtml(String(message))}</span>`;
    document.body.appendChild(t);

    // Auto-remove
    const timer = setTimeout(() => removeToast(t), duration);
    t.addEventListener('click', () => { clearTimeout(timer); removeToast(t); });
}
function removeToast(el) {
    el.style.transition = 'all 0.25s ease';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(110%)';
    setTimeout(() => el.remove(), 260);
}

// Comic-style yes/no prompt in the centre of the screen. A modal <dialog> dims the page behind it and
// blocks every click outside its two buttons. Resolves true for the confirm button, false for the
// other button or Escape.
function confirmToast({title, message, confirmText, cancelText}) {
    const open = document.querySelector('dialog.toast-confirm[open]');
    if (open) { open.querySelector('button').focus(); return Promise.resolve(false); }
    const d = document.createElement('dialog');
    d.className = 'toast-confirm';
    d.setAttribute('aria-labelledby', 'toastConfirmTitle');
    d.setAttribute('aria-describedby', 'toastConfirmText');
    d.innerHTML = `<h2 id="toastConfirmTitle">${escHtml(title)}</h2><p id="toastConfirmText">${escHtml(message)}</p>`
        + `<div class="toast-confirm__row"><button type="button" class="toast-confirm__stay" autofocus>${escHtml(cancelText)}</button>`
        + `<button type="button" class="toast-confirm__go">${escHtml(confirmText)}</button></div>`;
    document.body.appendChild(d);
    d.showModal();
    return new Promise(resolve => {
        const close = answer => { d.close(); d.remove(); resolve(answer); };
        d.querySelector('.toast-confirm__stay').addEventListener('click', () => close(false));
        d.querySelector('.toast-confirm__go').addEventListener('click', () => close(true));
        d.addEventListener('cancel', e => { e.preventDefault(); close(false); }); // Escape
    });
}

/* In-app replacement for window.prompt, in the same card as confirmToast. Resolves with the typed
   value, or null when cancelled. validate(value) returns the error to show, or '' to accept it. */
function promptToast({title, message, label, type = 'text', autocomplete = 'off', confirmText, cancelText, validate = () => ''}) {
    const open = document.querySelector('dialog.toast-confirm[open]');
    if (open) { open.querySelector('input, button').focus(); return Promise.resolve(null); }
    const d = document.createElement('dialog');
    d.className = 'toast-confirm';
    d.setAttribute('aria-labelledby', 'toastConfirmTitle');
    d.setAttribute('aria-describedby', 'toastConfirmText');
    d.innerHTML = `<form novalidate><h2 id="toastConfirmTitle">${escHtml(title)}</h2><p id="toastConfirmText">${escHtml(message)}</p>`
        + `<label class="toast-confirm__field"><span>${escHtml(label)}</span><input type="${escHtml(type)}" autocomplete="${escHtml(autocomplete)}" aria-describedby="toastPromptError" autofocus></label>`
        + `<p class="toast-confirm__error" id="toastPromptError" role="alert" hidden></p>`
        + `<div class="toast-confirm__row"><button type="button" class="toast-confirm__stay">${escHtml(cancelText)}</button>`
        + `<button type="submit" class="toast-confirm__go">${escHtml(confirmText)}</button></div></form>`;
    document.body.appendChild(d);
    d.showModal();
    const input = d.querySelector('input'), error = d.querySelector('.toast-confirm__error');
    return new Promise(resolve => {
        const close = answer => { d.close(); d.remove(); resolve(answer); };
        d.querySelector('.toast-confirm__stay').addEventListener('click', () => close(null));
        input.addEventListener('input', () => { error.hidden = true; error.textContent = ''; input.removeAttribute('aria-invalid'); });
        d.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const problem = validate(input.value);
            if (!problem) return close(input.value);
            error.textContent = problem;
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        });
        d.addEventListener('cancel', e => { e.preventDefault(); close(null); }); // Escape
    });
}

// ── Modal Helpers ───────────────────────────────────────────────
function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}

// ── Format Helpers ──────────────────────────────────────────────
function fmtDate(dateStr) {
    if (!dateStr) return 'No date';
    return new Date(dateStr).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}
function fmtPct(val, total) {
    return total > 0 ? Math.round((val / total) * 100) : 0;
}
// A study date from the API ('YYYY-MM-DD') as a local Date at midnight.
const parseDay = iso => new Date(iso + 'T00:00');

// Days studied in the last 7 as a percentage, and as a bar with its "n/7" label:
// green from 4 days, amber from 2, red below.
const studyWeekPct = days => Math.round((Number(days) || 0) / 7 * 100);
function studyWeekBar(days) {
    const n = Number(days) || 0;
    const colour = n >= 4 ? 'var(--success)' : n >= 2 ? 'var(--warning)' : 'var(--error)';
    return `<div class="progress-bar" style="flex:1;background:var(--bg-inset);"><div class="progress-fill" style="width:${studyWeekPct(n)}%;background:${colour};"></div></div><span>${n}/7</span>`;
}

// Study days as a row of squares, oldest first, shaded by minutes studied.
// calendar: [{date: 'YYYY-MM-DD', minutes}] from the API (studyCalendar in api/helpers.php).
function studyStrip(calendar = []) {
    const day = iso => parseDay(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const studied = calendar.filter(d => d.minutes > 0).length;
    const cells = calendar.map(d => {
        const level = d.minutes >= 45 ? 3 : d.minutes >= 15 ? 2 : d.minutes > 0 ? 1 : 0;
        return `<i class="study-day" data-level="${level}" title="${day(d.date)}: ${d.minutes ? d.minutes + ' min' : 'no study'}"></i>`;
    }).join('');
    const first = calendar[0];
    return `<div class="study-strip" role="img" aria-label="Studied on ${studied} of the last ${calendar.length} days" style="--n:${calendar.length}">${cells}</div>`
        + (first ? `<div class="study-strip-axis"><span>${day(first.date)}</span><span>Today</span></div>` : '');
}

// A study date ('YYYY-MM-DD') as Today, Yesterday or a date; Never when there is none.
function fmtLastStudied(iso) {
    if (!iso) return 'Never';
    const day = parseDay(iso);
    const ago = Math.round((new Date(new Date().toDateString()) - day) / 864e5);
    return ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : fmtDate(day);
}

// Study time from hours: "45 min" under an hour, otherwise "2.5h".
function fmtStudyTime(hours) {
    const h = Number(hours) || 0;
    return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)}h`;
}

function initials(name = '') {
    return name.trim().split(/\s+/).map(n => n[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}
function escHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Dynamic Greeting ────────────────────────────────────────────
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

// ── Charts – Bar ────────────────────────────────────────────────
// Chart ink follows the page's portal colours, so charts read on the dark Stage and on light pages.
function chartInk(canvas) {
    const css = getComputedStyle(canvas);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return { grid: v('--border', '#e0e3e8'), axis: v('--text-muted', '#8f95a0'), label: v('--text-secondary', '#5f6672'),
             value: v('--text-primary', '#1a1d23'), track: v('--bg-inset', '#f0f1f4'), surface: v('--bg-surface', '#ffffff') };
}
function drawBarChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ink = chartInk(canvas);
    const ctx = canvas.getContext('2d');
    const { labels = [], values = [], color = '#1a6b4a', maxVal } = data;
    const dpr = devicePixelRatio || 1;

    // Responsive resize
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const pad = { top: 20, right: 20, bottom: 40, left: 44 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const max = maxVal || Math.max(...values.map(Number)) * 1.2 || 100;

    ctx.clearRect(0, 0, w, h);

    // Grid lines & Y labels
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + chartH - (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = ink.axis;
        ctx.font = `${10}px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(max / 4 * i), pad.left - 6, y + 4);
    }

    // Bars
    const barW = (chartW / labels.length) * 0.55;
    const gap  = chartW / labels.length;
    labels.forEach((label, i) => {
        const val  = Number(values[i]) || 0;
        const barH = (val / max) * chartH;
        const x = pad.left + gap * i + (gap - barW) / 2;
        const y = pad.top + chartH - barH;

        ctx.fillStyle = color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        } else {
            ctx.rect(x, y, barW, barH);
        }
        ctx.fill();

        // X Label
        ctx.fillStyle = ink.label;
        ctx.font = `11px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barW / 2, pad.top + chartH + 18);

        // Value label
        ctx.fillStyle = ink.value;
        ctx.font = `600 10px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillText(val, x + barW / 2, y - 6);
    });
}

// ── Charts – Donut ──────────────────────────────────────────────
function drawDonut(canvasId, value, max, color = '#1a6b4a') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    const s = canvas.offsetWidth;
    ctx.scale(dpr, dpr);
    const cx = s / 2, cy = s / 2, r = s * 0.38, lw = s * 0.12;
    const pct = Math.min(1, Math.max(0, value / max));
    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = chartInk(canvas).track;
    ctx.lineWidth = lw;
    ctx.stroke();
    // Progress
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();
}

// ── Charts – Line ───────────────────────────────────────────────
function drawLineChart(canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ink = chartInk(canvas);
    const ctx = canvas.getContext('2d');
    const { labels = [], datasets = [] } = data;
    const dpr = devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const pad = { top: 20, right: 20, bottom: 36, left: 44 };
    const cW  = W - pad.left - pad.right;
    const cH  = H - pad.top  - pad.bottom;
    const allVals = datasets.flatMap(d => d.values.map(Number));
    // With no values the scale defaults to 0-100 (Math.max of nothing is -Infinity).
    const max = allVals.length ? (Math.max(...allVals) * 1.15 || 100) : 100;

    ctx.clearRect(0, 0, W, H);

    // Grid & Y labels
    ctx.strokeStyle = ink.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
        ctx.fillStyle = ink.axis;
        ctx.font = `10px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(max - (max / 4) * i), pad.left - 6, y + 4);
    }

    datasets.forEach(ds => {
        const pts = ds.values.map((v, i) => ({
            x: pad.left + (cW / Math.max(labels.length - 1, 1)) * i,
            y: pad.top + cH - (Number(v) / max) * cH
        }));
        if (!pts.length) return; // An empty series draws only the grid.

        // Fill
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pad.top + cH);
        pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, pad.top + cH);
        ctx.closePath();
        ctx.fillStyle = ds.color + '15';
        ctx.fill();

        // Line
        ctx.beginPath();
        pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Data points
        pts.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = ds.color;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = ink.surface;
            ctx.fill();
        });
    });

    // X labels
    ctx.fillStyle = ink.label;
    ctx.font = `10px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = 'center';
    labels.forEach((l, i) => {
        ctx.fillText(l, pad.left + (cW / Math.max(labels.length - 1, 1)) * i, pad.top + cH + 16);
    });
}

// ── Chart Resize Handler ────────────────────────────────────────
// Pages that draw charts call this with their redraw function
function initChartResize(redrawFn, debounceMs = 200) {
    let timeout;
    window.addEventListener('resize', () => {
        clearTimeout(timeout);
        timeout = setTimeout(redrawFn, debounceMs);
    });
}

// ── Study time ──────────────────────────────────────────────────
// Lessons are slide decks, so instead of lesson completion the portal records how often
// students study: one beat a minute while a student page is visible and in use (input in
// the last five minutes, or a video playing). Opening a lesson or material calls reading(),
// which keeps the beats going for 30 minutes even while the deck is open in another window.
// api/study.php turns beats into minutes per day.
const StudyClock = {
    readingUntil: 0,
    reading() { this.readingUntil = Date.now() + 30 * 60 * 1000; },
    init() {
        if (Auth.getUser()?.role !== 'student') return;
        let lastInput = Date.now();
        const touch = () => { lastInput = Date.now(); };
        ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(type => addEventListener(type, touch, { passive: true, capture: true }));
        setInterval(() => {
            const playing = [...document.querySelectorAll('video')].some(v => !v.paused);
            const inUse = !document.hidden && (playing || Date.now() - lastInput < 5 * 60 * 1000);
            if (!inUse && Date.now() > this.readingUntil) return;
            fetch(`${API_BASE}/study.php`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
        }, 60 * 1000);
    }
};

// ── Init on DOM Ready ───────────────────────────────────────────
function initApp() {
    Sidebar.init();
    AccountMenu.init();
    StudyClock.init();

    // Populate user info immediately from cache (fast path)
    const cached = Auth.getUser();
    if (cached) Auth._populateUserUI(cached);

    // Update greeting if element exists
    document.querySelectorAll('.greeting-text').forEach(el => {
        el.textContent = getGreeting();
    });

    // Notification toggle & badge initialization
    if (cached) {
        Notifications.load().catch(() => {});
    }
    document.querySelector('.notif-btn')?.addEventListener('click', () => Notifications.toggle());
    document.addEventListener('click', e => {
        const dd = document.getElementById('notifDropdown');
        if (dd && !dd.contains(e.target) && !e.target.closest('.notif-btn')) {
            dd.style.display = 'none';
            document.getElementById('notifBtn')?.setAttribute('aria-expanded', 'false');
        }
    });

    // Profile photo: a file input marked data-photo-input uploads on change.
    document.querySelectorAll('[data-photo-input]').forEach(input => input.addEventListener('change', async () => {
        if (!input.files[0]) return;
        const body = new FormData();
        body.append('photo', input.files[0]);
        input.value = '';
        try {
            const res  = await fetch(`${API_BASE}/settings.php`, { method: 'POST', body, credentials: 'same-origin' });
            const json = await res.json();
            if (!json.success) throw new Error(json.message);
            const user = { ...Auth.getUser(), profile_pic: json.data.profile_pic };
            sessionStorage.setItem('anthropotomy_user', JSON.stringify(user));
            Auth._populateUserUI(user);
            showToast('Profile photo updated.', 'success');
        } catch (err) {
            showToast(err.message || 'Could not upload the photo.', 'error');
        }
    }));

    // Logout button (all pages)
    document.querySelectorAll('.logout-btn, [data-logout]').forEach(el => {
        el.addEventListener('click', async () => {
            if (await confirmToast({title: 'Leaving already?!', message: "Come back soon. There's more to explore!", confirmText: 'Sign out', cancelText: 'Keep exploring'})) {
                await Auth.logout();
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
