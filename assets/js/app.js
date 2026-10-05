/* ============================================================
   Anthropotomy – Shared App Utilities  (v1.1)
   ============================================================ */

'use strict';

// ── API Base Path ──────────────────────────────────────────────
// Resolves correctly whether we're in /student/, /teacher/, or root.
const API_BASE = new URL('../../api', document.currentScript.src).pathname;

// ── Session Management ──────────────────────────────────────────
const Auth = {
    /**
     * Get the locally cached user object from sessionStorage.
     * This is a fast sync read used for immediate UI population.
     */
    getUser() {
        try { return JSON.parse(sessionStorage.getItem('anatomiq_user')); }
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
                sessionStorage.removeItem('anatomiq_user');
                this._redirectToLogin();
                return null;
            }

            const user = result.data;

            // Update cached data with fresh server data
            sessionStorage.setItem('anatomiq_user', JSON.stringify(user));

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
        if (!user) { this._redirectToLogin(); return null; }
        if (role && user.role !== role && user.role !== 'admin') {
            this._redirectToLogin(); return null;
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
        sessionStorage.removeItem('anatomiq_user');
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
        document.querySelectorAll('.user-name').forEach(el        => el.textContent = name);
        document.querySelectorAll('.user-role').forEach(el        => el.textContent = subtitle);
        document.querySelectorAll('.sidebar-footer .avatar').forEach(el => el.textContent = av);
        document.querySelectorAll('.topbar .avatar').forEach(el   => el.textContent = av);

        const pendingAssessments = sessionStorage.getItem('anatomiq_pending_assessments');
        if (pendingAssessments !== null) {
            document.querySelectorAll('.sidebar-nav a[href*="quiz"] .nav-badge').forEach(b => {
                b.textContent = pendingAssessments;
                b.style.display = parseInt(pendingAssessments) > 0 ? 'inline-block' : 'none';
            });
        }
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
                    ${n.icon || '<svg width="15" height="15" class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20260914-icons1#bell"/></svg>'}
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
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}
function fmtPct(val, total) {
    return total > 0 ? Math.round((val / total) * 100) : 0;
}
function initials(name = '') {
    return name.trim().split(/\s+/).map(n => n[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}
function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ── Dynamic Greeting ────────────────────────────────────────────
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
}

// ── Charts – Bar ────────────────────────────────────────────────
function drawBarChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
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
    ctx.strokeStyle = '#e0e3e8';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + chartH - (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = '#8f95a0';
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
        ctx.fillStyle = '#5f6672';
        ctx.font = `11px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barW / 2, pad.top + chartH + 18);

        // Value label
        ctx.fillStyle = '#1a1d23';
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
    ctx.strokeStyle = '#f0f1f4';
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
    const max = Math.max(...allVals) * 1.15 || 100;

    ctx.clearRect(0, 0, W, H);

    // Grid & Y labels
    ctx.strokeStyle = '#e0e3e8';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
        ctx.fillStyle = '#8f95a0';
        ctx.font = `10px 'Plus Jakarta Sans', sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(max - (max / 4) * i), pad.left - 6, y + 4);
    }

    datasets.forEach(ds => {
        const pts = ds.values.map((v, i) => ({
            x: pad.left + (cW / Math.max(labels.length - 1, 1)) * i,
            y: pad.top + cH - (Number(v) / max) * cH
        }));

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
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        });
    });

    // X labels
    ctx.fillStyle = '#5f6672';
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

// ── Init on DOM Ready ───────────────────────────────────────────
function initApp() {
    Sidebar.init();

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

    // Logout button (all pages)
    document.querySelectorAll('.logout-btn, [data-logout]').forEach(el => {
        el.addEventListener('click', async () => {
            if (confirm('Are you sure you want to sign out?')) {
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
