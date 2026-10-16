/* Shared student account menu and notification controls, plus the Anthropotomy Stage
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

    const accountLink = document.querySelector('.topbar-user');
    if (!accountLink) return;
    const account = document.createElement('div');
    account.className = 'student-account';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'topbar-user';
    trigger.id = 'accountMenuButton';
    trigger.setAttribute('aria-label', 'Account menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'accountDropdown');
    while (accountLink.firstChild) trigger.appendChild(accountLink.firstChild);
    trigger.insertAdjacentHTML('beforeend', '<svg class="account-chevron ui-icon" width="14" height="14" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#caret-down"/></svg>');
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
    const closeNotifications = () => {
        if (notifications) notifications.style.display = 'none';
        bell?.setAttribute('aria-expanded', 'false');
    };
    const openAccount = () => {
        closeNotifications();
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
        if (event.key !== 'Escape') return;
        if (!menu.hidden) { closeAccount(); trigger.focus(); }
        if (notifications?.style.display === 'block') { closeNotifications(); bell.focus(); }
    });

    if (bell && notifications) {
        bell.setAttribute('aria-expanded', 'false');
        bell.setAttribute('aria-controls', 'notifDropdown');
        bell.addEventListener('click', closeAccount);
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
