// Pure helpers for the landing page. No DOM access, so Node can unit test them.

const TEACHER_ROLES = new Set(['teacher', 'admin']);

// Which portal a signed-in user belongs to. Teachers and admins share the teacher portal.
export function portalFor(role) {
    return TEACHER_ROLES.has(role) ? 'teacher' : 'student';
}

// Links are relative to the site root, where index.html lives.
export function dashboardFor(role) {
    return `${portalFor(role)}/dashboard.html`;
}

export function explorerFor(role) {
    return `${portalFor(role)}/anatomy.html`;
}

export function firstName(fullName) {
    return String(fullName ?? '').trim().split(/\s+/)[0] || '';
}

// Reads the answer from api/auth/session.php. A clear "no session" is different from not being able to ask:
// only the first may sign the page out.
export function sessionCheck(status, body) {
    if (status === 200 && body && body.success && body.data) return {status: 'ok', user: body.data};
    if (status === 401 || status === 403) return {status: 'none'};
    if (status > 0 && status < 500 && body && body.success === false) return {status: 'none'};
    return {status: 'error'};
}

// Combines the user cached at sign-in with the server check. A network or server error keeps the cached
// user, the same way the portal falls back to its cached session when the server cannot be reached.
export function sessionState(cached, check) {
    if (check && check.status === 'ok' && check.user) return {state: 'signed-in', user: check.user};
    if (check && check.status === 'none') return {state: 'signed-out', user: null};
    return cached ? {state: 'signed-in', user: cached} : {state: 'signed-out', user: null};
}

// Part counts per layer from system_model/layers/manifest.json. Entries without a whole-number count are skipped.
export function partTotals(manifest) {
    const systems = Object.entries(manifest && typeof manifest === 'object' ? manifest : {})
        .filter(([, entry]) => entry && Number.isInteger(entry.parts) && entry.parts >= 0)
        .map(([id, entry]) => ({id, parts: entry.parts}));
    return {systems, total: systems.reduce((sum, system) => sum + system.parts, 0)};
}

export function formatParts(count) {
    return `${count.toLocaleString('en-US')} ${count === 1 ? 'part' : 'parts'}`;
}
