/* Student notification controls (the account menu lives in app.js), plus the Anthropotomy Stage
   helpers every student page draws with (icons, card colours, body-system art). */
'use strict';
const ICON_SPRITE = '../assets/icons/interface.svg?v=20261112-icons5';
const icon = name => `<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${ICON_SPRITE}#${name}"/></svg>`;
const plural = (count, word, many = word + 's') => `${count} ${count === 1 ? word : many}`;

// Card colours and body-system looks live in content-format.js; these keep the names the pages already use.
const CARD_COLOURS = ContentFormat.CARD_COLOURS;
const systemLook = code => ContentFormat.systemLook(code);

(() => {
    if (!document.body.classList.contains('student-dashboard')) return;

    const bell = document.getElementById('notifBtn');
    const notifications = document.getElementById('notifDropdown');
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || notifications?.style.display !== 'block') return;
        notifications.style.display = 'none';
        bell.setAttribute('aria-expanded', 'false');
        bell.focus();
    });

    if (bell && notifications) {
        bell.setAttribute('aria-expanded', 'false');
        bell.setAttribute('aria-controls', 'notifDropdown');
        notifications.querySelector('.notif-header').innerHTML = '<span>Notifications</span><button type="button" class="notif-mark-read">Mark all read</button>';
        notifications.querySelector('.notif-mark-read').addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            await Notifications.markAllRead();
            button.disabled = false;
        });
        if (!notifications.querySelector('.notif-footer')) {
            notifications.insertAdjacentHTML('beforeend', '<div class="notif-footer"><a href="notifications.html">View all notifications</a></div>');
        }
    }
    // Refresh unread receipts and newly arrived notifications when returning to the portal.
    window.addEventListener('focus', () => Notifications.load(true));
})();

// Shelves (.sd-shelf) scroll sideways with no visible scrollbar. Touch swipes them natively; a mouse
// wheel moves them sideways (until an end is reached, then the page scrolls on) and a mouse drag pans them.
(() => {
    document.querySelectorAll('.sd-shelf').forEach(shelf => {
        shelf.addEventListener('wheel', event => {
            if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return; // pinch zoom, or already sideways
            const max = shelf.scrollWidth - shelf.clientWidth;
            if (max <= 0) return;
            if ((event.deltaY < 0 && shelf.scrollLeft <= 0) || (event.deltaY > 0 && shelf.scrollLeft >= max - 1)) return;
            event.preventDefault();
            shelf.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 40 : 1);
        }, { passive: false });

        let drag = null;
        const swallowClick = event => { event.preventDefault(); event.stopPropagation(); };
        shelf.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button === 0) drag = { id: event.pointerId, x: event.clientX, left: shelf.scrollLeft, moved: false };
        });
        shelf.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x;
            if (!drag.moved) {
                if (Math.abs(dx) < 6) return;
                drag.moved = true;
                shelf.setPointerCapture(event.pointerId);
                shelf.classList.add('is-dragging');
            }
            shelf.scrollLeft = drag.left - dx;
        });
        const endDrag = () => {
            if (drag?.moved) {
                shelf.classList.remove('is-dragging');
                // The click that ends a drag must not open the card under the pointer.
                shelf.addEventListener('click', swallowClick, { capture: true });
                setTimeout(() => shelf.removeEventListener('click', swallowClick, { capture: true }));
            }
            drag = null;
        };
        shelf.addEventListener('pointerup', endDrag);
        shelf.addEventListener('pointercancel', endDrag);
        shelf.addEventListener('dragstart', event => event.preventDefault()); // links and images would start a native drag
    });
})();
