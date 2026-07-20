// Theme bootstrap — runs in <head> before the stylesheet loads so the correct
// palette is applied on first paint (no flash of the wrong theme).
// Order of precedence: localStorage ('tosync-theme' = 'light'|'dark')  →
//                      system preference (prefers-color-scheme)        →
//                      default 'dark' (Catppuccin Mocha).
(function () {
    var stored;
    try {
        stored = localStorage.getItem('tosync-theme');
    } catch (e) {
        stored = null;
    }
    var pref = stored;
    if (pref !== 'light' && pref !== 'dark') {
        pref = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    var html = document.documentElement;
    html.classList.toggle('light', pref === 'light');
    html.classList.toggle('dark', pref === 'dark');
})();

// Public helper — used by main.js / login.js to handle toggle clicks.
window.__tosyncToggleTheme = function () {
    var html = document.documentElement;
    var nextLight = !html.classList.contains('light');
    html.classList.toggle('light', nextLight);
    html.classList.toggle('dark', !nextLight);
    try {
        localStorage.setItem('tosync-theme', nextLight ? 'light' : 'dark');
    } catch (e) {
        /* ignore */
    }
    // Broadcast so any open UI (e.g. theme-toggle button icon) can update.
    document.dispatchEvent(new CustomEvent('theme-change', { detail: { theme: nextLight ? 'light' : 'dark' } }));
};
