'use strict';
const SiteConfig = {
    data: {},
    async load() {
        const script = [...document.scripts].find(s => /\/site-config\.js(?:\?|$)/.test(s.src));
        const endpoint = new URL('../../api/config.php', script.src);
        try {
            const response = await fetch(endpoint, { credentials: 'same-origin' });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            this.data = result.data;
            document.querySelectorAll('[data-system-count]').forEach(el => el.textContent = this.data.system_count);
            document.dispatchEvent(new CustomEvent('siteconfigloaded', {detail:this.data}));
        } catch (error) {
            console.error('School settings could not be loaded:', error.message);
        }
        document.querySelectorAll('[data-current-year]').forEach(el => el.textContent = new Date().getFullYear());
        return this.data;
    }
};
SiteConfig.ready = SiteConfig.load();
