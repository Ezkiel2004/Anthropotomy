// Explorer toolbar and panel icons: Phosphor regular symbols from the shared portal sprite,
// so the explorer matches every other page. Static strings, inserted with innerHTML.
const SPRITE = new URL('../../icons/interface.svg?v=20261012-icons3', import.meta.url).href;
const SYMBOLS = {
    'zoom-in': 'magnifying-glass-plus',
    'zoom-out': 'magnifying-glass-minus',
    reset: 'arrow-counter-clockwise',
    rotate: 'arrows-clockwise',
    save: 'download-simple',
    maximize: 'corners-out',
    minimize: 'corners-in',
    info: 'info',
    x: 'x',
    'chevron-right': 'caret-right',
    check: 'check'
};

export function icon(name) {
    return `<svg class="ui-icon" viewBox="0 0 256 256" width="20" height="20" aria-hidden="true" focusable="false"><use href="${SPRITE}#${SYMBOLS[name] || name}"/></svg>`;
}
