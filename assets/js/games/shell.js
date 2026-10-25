// Game shell core: the game list, settings storage, seeded random and star rating.
// No DOM or window access at import time, so Node unit tests and the gallery/teacher pages can import it.

export const GAMES = {
    'germ-smash': {
        title: 'Germ Smash',
        tagline: 'Smash the germs, spare the good bacteria.',
        card: '../assets/games/germ-smash/card.webp',
        load: () => import('./germ-smash.js')
    }
};

export const DEFAULT_SETTINGS = {sfx: true, sfxVolume: 80, music: true, musicVolume: 50, reduceMotion: false, vibration: true};

const SETTINGS_KEY = 'anthropotomy_game_settings';
const FLAGS = ['sfx', 'music', 'reduceMotion', 'vibration'];
const VOLUMES = ['sfxVolume', 'musicVolume'];

const volume = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback);

export function loadSettings(storage, prefersReducedMotion) {
    const settings = {...DEFAULT_SETTINGS, reduceMotion: !!prefersReducedMotion};
    let stored;
    try {
        stored = JSON.parse(storage.getItem(SETTINGS_KEY));
    } catch {
        return settings;
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return settings;
    for (const key of FLAGS) if (typeof stored[key] === 'boolean') settings[key] = stored[key];
    for (const key of VOLUMES) settings[key] = volume(stored[key], DEFAULT_SETTINGS[key]);
    return settings;
}

export function saveSettings(storage, settings) {
    try {
        const known = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) known[key] = settings[key];
        storage.setItem(SETTINGS_KEY, JSON.stringify(known));
        return true;
    } catch {
        return false;
    }
}

// mulberry32
export function makeRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function starsFor(score, thresholds) {
    return thresholds.filter((threshold) => score >= threshold).length;
}

// Filled in by the shell screens.
export function boot() {}
