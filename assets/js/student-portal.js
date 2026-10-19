/* Student notification controls (the account menu lives in app.js), plus the Anthropotomy Stage
   helpers every student page draws with (icons, card colours, body-system art). */
'use strict';
const ICON_SPRITE = '../assets/icons/interface.svg?v=20261012-icons3';
const icon = name => `<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${ICON_SPRITE}#${name}"/></svg>`;
const plural = (count, word, many = word + 's') => `${count} ${count === 1 ? word : many}`;

// Card colours and renders from the landing page, one per body system.
const CARD_COLOURS = { sky: '#3fb8f5', teal: '#2ccf9a', violet: '#6c63ff', purple: '#8b5cf6', coral: '#f2545b' };
const SYSTEM_LOOKS = {
  skeletal: ['sky', 'skeletal'], muscular: ['purple', 'muscular'], circulatory: ['sky', 'circulatory'],
  nervous: ['violet', 'nervous'], lymphatic: ['coral', 'lymphatic'], respiratory: ['teal', 'respiratory'],
  digestive: ['violet', 'digestive'], urinary: ['sky', 'urinary'], endocrine: ['teal', 'endocrine'],
  reproductive: ['coral', null], 'reproductive-female': ['purple', null],
};
function systemLook(code) {
  const [tone, art] = SYSTEM_LOOKS[code] || ['sky', null];
  return { tone, colour: CARD_COLOURS[tone], art: art ? `../assets/img/hero/${art}.webp` : null };
}

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
