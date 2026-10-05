'use strict';
const APP_BASE = new URL('../../', document.currentScript.src).pathname.replace(/\/$/, '');
const API_BASE = APP_BASE + '/api';
const byId = id => document.getElementById(id);
const eye = hidden => `<svg viewBox="0 0 256 256" aria-hidden="true"><use href="assets/icons/interface.svg#${hidden ? 'eye' : 'eye-slash'}"/></svg>`;
function togglePassword(id, button) {
    const input = byId(id);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.innerHTML = eye(!visible);
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
}
// Buttons keep their markup (label and icon) so it can be restored after a request.
const buttonLabels = new Map();
document.querySelectorAll('#loginBtn, #registerBtn, #resetBtn').forEach(button => buttonLabels.set(button, button.innerHTML));
function restoreLabel(button) {
    button.disabled = false;
    button.innerHTML = buttonLabels.get(button);
}
function notice(id, message, error = false) {
    const el = byId(id);
    el.textContent = message;
    el.className = 'notice ' + (error ? 'error' : 'success');
    el.hidden = !message;
}
function fieldError(input, message) {
    const id = input.id + 'Error';
    let error = byId(id);
    if (!error) {
        error = document.createElement('span');
        error.id = id;
        error.className = 'field-error';
        input.closest('.field').appendChild(error);
    }
    const descriptions = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    descriptions.add(id);
    input.setAttribute('aria-describedby', [...descriptions].join(' '));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    error.textContent = message;
}
function validate(form) {
    let first;
    form.querySelectorAll('input, select').forEach(input => {
        if (input.type === 'checkbox' && !input.required) return;
        let message = '';
        if (input.required && (input.type === 'checkbox' ? !input.checked : !input.value.trim())) message = input.type === 'checkbox' ? 'Please agree to the Terms and Conditions to register.' : 'Please complete this field.';
        else if (input.validity.typeMismatch) message = 'Enter a valid email address, such as name@example.com.';
        else if (input.id === 'regUsername' && !/^[A-Za-z0-9_.-]{3,50}$/.test(input.value)) message = 'Use 3–50 letters, numbers, periods, underscores or hyphens.';
        else if (input.id === 'contactNo' && (!/^[+\d\s().-]+$/.test(input.value) || input.value.replace(/\D/g, '').length < 7)) message = 'Enter a valid contact number with at least 7 digits.';
        else if (input.id === 'regPassword' && (input.value.length < 8 || new TextEncoder().encode(input.value).length > 72)) message = 'Use at least 8 characters and no more than 72 bytes.';
        else if (input.id === 'confirmPassword' && input.value !== byId('regPassword').value) message = 'Your passwords do not match. Please try again.';
        else if (!input.validity.valid) message = 'Please check this field and its required length.';
        fieldError(input, message);
        if (message && !first) first = input;
    });
    first?.focus();
    return !first;
}
async function request(path, body) {
    const response = await fetch(API_BASE + path, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Unable to complete your request. Please try again.');
    return result;
}
function destination(role) { return `${APP_BASE}/${['teacher','admin'].includes(role) ? 'teacher' : 'student'}/dashboard.html`; }
async function handleLogin(event) {
    event?.preventDefault();
    if (byId('loginBtn').disabled || !validate(byId('loginForm'))) return;
    notice('loginError', ''); notice('loginSuccess', '');
    const button = byId('loginBtn');
    button.disabled = true; button.textContent = 'Signing in…';
    try {
        const username = byId('username').value.trim();
        const result = await request('/auth/login.php', {username, password:byId('password').value});
        try {
            sessionStorage.setItem('anatomiq_user', JSON.stringify(result.data));
            if (byId('rememberMe').checked) localStorage.setItem('anatomiq_remember', username);
            else localStorage.removeItem('anatomiq_remember');
        } catch (_) { /* The server session remains authoritative when browser storage is unavailable. */ }
        notice('loginSuccess', `Welcome, ${result.data.full_name}! Opening your dashboard…`);
        location.assign(destination(result.data.role));
    } catch (error) {
        notice('loginError', error instanceof TypeError || error instanceof SyntaxError ? 'We couldn’t connect. Please try again in a moment.' : error.message, true);
        restoreLabel(button);
    }
}
async function handleRegister(event) {
    event.preventDefault();
    if (byId('registerBtn').disabled || !validate(byId('registerForm'))) return;
    const button = byId('registerBtn');
    button.disabled = true; button.textContent = 'Creating your account…';
    notice('registerError', '');
    const body = Object.fromEntries(new FormData(byId('registerForm')));
    body.terms = byId('terms').checked;
    try {
        await request('/auth/register.php', body);
        byId('username').value = body.username;
        byId('password').value = '';
        byId('registerForm').reset();
        updateStrength();
        location.hash = 'login';
        switchView();
        notice('loginSuccess', 'Your student account is ready! Sign in with your student ID or username.');
        byId('password').focus();
    } catch (error) {
        notice('registerError', error instanceof TypeError || error instanceof SyntaxError ? 'We couldn’t connect. Please try again in a moment.' : error.message, true);
    } finally {
        restoreLabel(button);
    }
}
function updateStrength() {
    const password = byId('regPassword').value;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password) && /[^\w\s]/.test(password)) score++;
    byId('passwordStrength').value = score;
    byId('strengthText').textContent = password ? ['Very weak', 'Fair', 'Good', 'Strong', 'Very strong'][score] : 'Password strength';
}
function switchView(focus = true) {
    const register = location.hash === '#register';
    byId('loginView').hidden = register;
    byId('registerView').hidden = !register;
    document.body.classList.toggle('register-mode', register);
    for (const id of ['loginTab', 'registerTab']) byId(id).removeAttribute('aria-current');
    byId(register ? 'registerTab' : 'loginTab').setAttribute('aria-current','page');
    document.title = register ? 'Create your student account – Anthropotomy' : 'Sign in – Anthropotomy';
    if (location.hash === '#terms') {
        // Deep link from the landing page footer: show the terms over the sign-in view.
        if (!byId('termsModal').open) byId('termsModal').showModal();
        return;
    }
    if (focus) byId(register ? 'registerView' : 'loginView').querySelector('h1').focus({preventScroll:true});
}
byId('loginForm').addEventListener('submit', handleLogin);
byId('registerForm').addEventListener('submit', handleRegister);
byId('regPassword').addEventListener('input', updateStrength);
document.querySelectorAll('.password-toggle').forEach(button => {
    button.innerHTML = eye(true);
    button.addEventListener('click', () => togglePassword(button.dataset.password, button));
});
document.querySelectorAll('input, select').forEach(input => input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') fieldError(input, '');
}));
for (const [trigger, modal] of [['forgotLink','forgotModal'],['termsLink','termsModal']]) {
    byId(trigger).addEventListener('click', () => byId(modal).showModal());
    byId(modal).querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => byId(modal).close()));
}
// Closing the deep-linked terms leaves the sign-in view, so a reload does not reopen them.
byId('termsModal').addEventListener('close', () => {
    if (location.hash === '#terms') history.replaceState(null, '', '#login');
});
byId('forgotPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('resetBtn');
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Loading instructions…';
    try {
        const result = await request('/auth/reset-password.php', {action:'request', identifier:byId('resetIdentifier').value.trim()});
        notice('resetResult', result.message);
    } catch (error) {
        notice('resetResult', error instanceof TypeError || error instanceof SyntaxError ? 'We couldn’t connect. Please try again shortly.' : error.message, true);
    } finally { restoreLabel(button); }
});
window.addEventListener('hashchange', () => switchView());
switchView(false);
try {
    const remembered = localStorage.getItem('anatomiq_remember');
    if (remembered) { byId('username').value = remembered; byId('rememberMe').checked = true; }
} catch (_) { /* Remembering a username is optional. */ }
// Reuse the school's configured grade when it differs from the standard options.
document.addEventListener('siteconfigloaded', event => {
    // Show the school name only when one is configured; never a placeholder.
    if (event.detail.school_name && byId('schoolLine')) byId('schoolLine').hidden = false;
    const grade = event.detail.grade_level;
    if (grade && ![...byId('gradeLevel').options].some(option => option.value === grade)) byId('gradeLevel').add(new Option(grade, grade));
});
fetch(API_BASE + '/auth/session.php', {credentials:'same-origin'}).then(response => response.json()).then(result => {
    if (result.success) location.replace(destination(result.data.role));
}).catch(() => { /* Keep the form available during a connection failure. */ });
