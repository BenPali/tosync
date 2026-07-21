// modules/videojsProto.js - Feature-flagged Video.js chrome (comparative-study prototype)
//
// Activate by appending ?player=videojs to the room URL. Without the flag this
// module is never even imported — the default player path is untouched.
//
// Integration contract (the in-app proof of proto-videojs/README.md):
// Video.js wraps the EXISTING #videoPlayer element — its html5 tech reuses the
// node rather than replacing it — so `state.videoPlayer`, captured at boot
// before this runs, still points at the same native element. The sync engine
// (videoPlayer.js listeners, seekWhenReady, force-sync) therefore keeps its
// exact native event semantics; only the visual chrome changes. Rollback =
// remove the flag from the URL.
//
// Known scope limits (it is a prototype):
// - Server opt-in required: the CSP allowances for the video.js assets exist
//   only when the private server runs with ENABLE_PLAYER_PROTO=true (the dev
//   compose and the e2e config set it; production does not). Anywhere else the
//   CDN load is CSP-blocked and the app continues on the native player.
// - CDN assets are version-pinned AND SRI-pinned (same supply-chain bar as
//   the static CDN scripts that build.js verifies).
// - Video.js moves the id "videoPlayer" onto its wrapper <div>; nothing in the
//   app reads getElementById('videoPlayer') after boot, but tooling that does
//   must target the <video> inside it.
// - Exercised with file/torrent playback (covered by videojs-proto e2e spec);
//   HLS-transcode and IPTV paths attach to the same element and are expected
//   to work, but are not covered by the spec.

import { state } from '../state.js';
import { videoPlayer, subtitleManager } from '../main.js';

const VJS_VERSION = '8.16.1'; // pinned — same version as the proto-videojs spike
// SRI hashes for the pinned version — runtime-injected tags must meet the same
// supply-chain bar as the static CDN <script>s (which build.js verifies).
const VJS_JS_SRI = 'sha384-aCo58qdPiLmpqWFiZLDPO0DK+QMiF8eZn6Ra2AGFFO3gptxUbme54Rsz12ep3QsN';
const VJS_CSS_SRI = 'sha384-9q8NM8a3us0UFs0v3qzmN4fNiUDdJsQZhSmY9NtV+26DLHvgCO+6gnMOwqz9pWMT';

function loadAsset(tag, attrs) {
    return new Promise((resolve, reject) => {
        const el = document.createElement(tag);
        Object.assign(el, attrs);
        el.crossOrigin = 'anonymous'; // required for SRI on cross-origin loads
        el.onload = resolve;
        el.onerror = () => reject(new Error(`CDN load failed: ${attrs.href || attrs.src}`));
        document.head.appendChild(el);
    });
}

export async function enableVideoJsProto() {
    await Promise.all([
        loadAsset('link', {
            rel: 'stylesheet',
            href: `https://cdn.jsdelivr.net/npm/video.js@${VJS_VERSION}/dist/video-js.min.css`,
            integrity: VJS_CSS_SRI
        }),
        loadAsset('script', {
            src: `https://cdn.jsdelivr.net/npm/video.js@${VJS_VERSION}/dist/video.min.js`,
            integrity: VJS_JS_SRI
        })
    ]);
    const videojs = window.videojs;

    // In-bar ±10s controls — the capability the study showed native controls
    // cannot offer (ToSync's page-level buttons vanish in fullscreen). They
    // call the app's own guarded seek methods, so a click flows through the
    // exact same native `seeked` -> broadcast path as any scrub.
    const Button = videojs.getComponent('Button');
    class SeekButton extends Button {
        constructor(player, options) {
            super(player, options);
            this.controlText(options.delta > 0 ? 'Forward 10 seconds' : 'Back 10 seconds');
        }
        createEl() {
            const el = super.createEl();
            el.querySelector('.vjs-icon-placeholder').textContent = this.options_.delta > 0 ? '+10' : '-10';
            return el;
        }
        handleClick() {
            if (this.options_.delta > 0) videoPlayer.seekForward();
            else videoPlayer.seekBackward();
        }
    }
    videojs.registerComponent('SeekButton', SeekButton);

    const MenuButton = videojs.getComponent('MenuButton');
    const MenuItem = videojs.getComponent('MenuItem');

    // CC button — opens a Stremio-style PANEL (built below), not a flat menu:
    // track list, upload, room-synced timing offset, local size.
    class CcButton extends Button {
        constructor(player, options) {
            super(player, options);
            this.controlText('Subtitles');
        }
        handleClick(event) {
            // Keyboard-synthesized clicks carry detail 0; pointer clicks >= 1.
            const keyboard = !event || !event.detail;
            this.options_.onToggle(undefined, { keyboard });
            // Pointer only: drop focus after the toggle — the retained focus
            // ring reads as the button "glowing" once the panel is dismissed.
            // Keyboard users keep their tab position (or land in the panel).
            if (!keyboard) this.el().blur();
        }
    }
    videojs.registerComponent('CcButton', CcButton);

    // Settings (YouTube-style gear) — extra room actions. Both methods are
    // role-gated in the app itself (guests get the error toast).
    class ActionMenuItem extends MenuItem {
        constructor(player, options) {
            super(player, { ...options, selectable: false });
        }
        handleClick() {
            this.options_.run();
        }
    }
    class SettingsMenuButton extends MenuButton {
        constructor(player, options) {
            super(player, options);
            this.controlText('Settings');
        }
        createItems() {
            return [
                new ActionMenuItem(this.player(), { label: 'Force sync room', run: () => videoPlayer.syncTime() }),
                new ActionMenuItem(this.player(), { label: 'Restart video', run: () => videoPlayer.restartVideo() })
            ];
        }
    }
    videojs.registerComponent('SettingsMenuButton', SettingsMenuButton);

    // The 'video-js' class is the baseline hook all Video.js CSS keys off —
    // the wrapper inherits the element's classes, so add it before init or
    // the whole chrome renders unstyled/invisible.
    state.videoPlayer.classList.add('video-js');
    // playbackRates: the built-in rate menu writes element.playbackRate, so the
    // native ratechange event broadcasts through the sync engine untouched.
    // (Same client-side exposure as Chrome's own native rate menu.)
    const player = videojs(state.videoPlayer, {
        controls: true,
        fill: true,
        playbackRates: [0.5, 1, 1.5, 2],
        // Our CC menu is the room-synced one; the built-in local-only captions
        // button would duplicate it as soon as a track loads.
        controlBar: { subsCapsButton: false }
    });
    // ---- Stremio-style subtitle panel -------------------------------------
    const panelCss = document.createElement('style');
    panelCss.textContent = `
.vjs-proto-cc-panel { position:absolute; right:.8em; bottom:4.2em; width:250px;
  background:rgba(15,15,15,.96); border:1px solid rgba(255,255,255,.08);
  border-radius:10px; padding:10px; z-index:2; font-size:13px; color:#ddd; text-align:left; }
.vjs-proto-cc-panel .row { display:flex; align-items:center; gap:8px; width:100%;
  padding:6px 8px; border-radius:6px; cursor:pointer; background:none; border:0;
  color:#ddd; font:inherit; text-align:left; }
.vjs-proto-cc-panel .row:hover { background:rgba(255,255,255,.06); }
.vjs-proto-cc-panel .row.sel { color:#fff; font-weight:600; }
.vjs-proto-cc-panel button:focus-visible { outline:2px solid #e11d48; outline-offset:1px; }
.vjs-proto-cc-panel hr { border:0; border-top:1px solid rgba(255,255,255,.08); margin:8px 0; }
.vjs-proto-cc-panel .adj { display:flex; align-items:center; gap:6px; padding:4px 8px; }
.vjs-proto-cc-panel .adj .lbl { flex:1; color:#999; }
.vjs-proto-cc-panel .adj button { background:#2a2a2a; color:#eee; border:0;
  border-radius:5px; width:24px; height:24px; cursor:pointer; font-size:14px; }
.vjs-proto-cc-panel .adj .val { min-width:56px; text-align:center; font-family:monospace; }
.vjs-proto-cc-panel .head { display:flex; justify-content:space-between; align-items:center; padding:0 8px 4px; }
.vjs-proto-cc-panel .toggle { background:#2a2a2a; border:0; color:#eee; border-radius:6px;
  padding:3px 10px; cursor:pointer; font-weight:600; }
.vjs-proto-cc-panel .toggle.on { background:#e11d48; color:#fff; }`;
    document.head.appendChild(panelCss);

    const panel = document.createElement('div');
    panel.className = 'vjs-proto-cc-panel';
    // Dialog, not menu: the panel mixes widget types (toggle, option rows,
    // spin controls) — menu semantics would promise menuitem-only content.
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Subtitle settings');
    panel.style.display = 'none';

    // Local-only cue size (per-viewer, like caption size in any player).
    let cueSizePct = 100;
    const cueStyle = document.createElement('style');
    document.head.appendChild(cueStyle);
    const applyCueSize = () => {
        cueStyle.textContent = `video::cue { font-size: ${cueSizePct}%; }`;
    };

    // Upload reuses the app's #subtitleInput; the app's own flow is two-step
    // (pick, then press its upload button) — from the panel we auto-upload on
    // pick. One armed listener at a time so a cancelled chooser can't stack.
    let pendingSubUpload = null;
    const uploadFlow = () => {
        const input = document.getElementById('subtitleInput');
        if (!input) return;
        if (pendingSubUpload) input.removeEventListener('change', pendingSubUpload);
        pendingSubUpload = () => {
            pendingSubUpload = null;
            subtitleManager.uploadSubtitle();
        };
        input.addEventListener('change', pendingSubUpload, { once: true });
        input.click();
    };

    const mk = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    };

    // All content is DOM-built with textContent (subtitle labels are user data
    // — no innerHTML injection surface). Every interactive element is a real
    // <button>: native focusability and Enter/Space activation for free.
    const focusables = () => [...panel.querySelectorAll('button')];
    const render = () => {
        // Keyboard users may be mid-navigation when a re-render replaces the
        // DOM — restore focus to the same position afterwards.
        const focusIdx = panel.contains(document.activeElement) ? focusables().indexOf(document.activeElement) : -1;
        panel.innerHTML = '';
        const isOn = state.selectedSubtitleId && state.selectedSubtitleId !== 'none';

        const head = mk('div', 'head');
        head.appendChild(mk('span', null, 'Subtitles'));
        const tgl = mk('button', 'toggle' + (isOn ? ' on' : ''), isOn ? 'ON' : 'OFF');
        tgl.setAttribute('aria-pressed', String(!!isOn));
        tgl.setAttribute('aria-label', 'Subtitles on/off');
        tgl.onclick = () => {
            if (isOn) subtitleManager.selectSubtitle('none');
            else if (state.availableSubtitles[0]) subtitleManager.selectSubtitle(state.availableSubtitles[0].filename);
            render();
        };
        head.appendChild(tgl);
        panel.appendChild(head);
        panel.appendChild(mk('hr'));

        if (state.availableSubtitles.length === 0) {
            panel.appendChild(mk('div', 'row', 'No subtitles in the room yet'));
        }
        for (const s of state.availableSubtitles) {
            const sel = state.selectedSubtitleId === s.filename;
            const row = mk('button', 'row' + (sel ? ' sel' : ''), (sel ? '✓ ' : '') + (s.label || s.filename));
            row.setAttribute('aria-pressed', String(!!sel));
            row.onclick = () => {
                subtitleManager.selectSubtitle(sel ? 'none' : s.filename);
                render();
            };
            panel.appendChild(row);
        }
        const up = mk('button', 'row', '+ Upload subtitle…');
        up.onclick = uploadFlow;
        panel.appendChild(up);
        panel.appendChild(mk('hr'));

        // Timing — the app's room-synced offset (same API as its G/H buttons).
        const off = state.subtitleOffset || 0;
        const t = mk('div', 'adj');
        t.appendChild(mk('span', 'lbl', 'Timing'));
        const tM = mk('button', null, '−');
        tM.onclick = () => {
            subtitleManager.adjustSubtitleOffset(-0.5);
            render();
        };
        const tV = mk('span', 'val', `${off >= 0 ? '+' : ''}${off.toFixed(1)} s`);
        const tP = mk('button', null, '+');
        tP.onclick = () => {
            subtitleManager.adjustSubtitleOffset(0.5);
            render();
        };
        t.append(tM, tV, tP);
        panel.appendChild(t);

        // Size — local-only cue scaling.
        const z = mk('div', 'adj');
        z.appendChild(mk('span', 'lbl', 'Size'));
        const zM = mk('button', null, '−');
        zM.onclick = () => {
            cueSizePct = Math.max(50, cueSizePct - 10);
            applyCueSize();
            render();
        };
        const zV = mk('span', 'val', `${cueSizePct} %`);
        const zP = mk('button', null, '+');
        zP.onclick = () => {
            cueSizePct = Math.min(200, cueSizePct + 10);
            applyCueSize();
            render();
        };
        z.append(zM, zV, zP);
        panel.appendChild(z);

        if (focusIdx >= 0) {
            const f = focusables();
            (f[Math.min(focusIdx, f.length - 1)] || panel).focus();
        }
    };

    let panelRefresh = null;
    const togglePanel = (force, { keyboard = false } = {}) => {
        const open = force !== undefined ? force : panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
        // ccBtn is created below; by the time any toggle runs it exists.
        ccBtn.el().setAttribute('aria-expanded', String(open));
        clearInterval(panelRefresh);
        panelRefresh = null;
        if (open) {
            render();
            // Keyboard open: move focus into the panel (standard popup
            // behavior); pointer users keep their mouse flow.
            if (keyboard) focusables()[0]?.focus();
            // Room subtitle list/offset can change while open (another admin
            // uploads/adjusts) — keep the open panel fresh, but never yank the
            // DOM out from under a keyboard user mid-navigation.
            panelRefresh = setInterval(() => {
                if (!panel.contains(document.activeElement)) render();
            }, 1500);
        }
    };

    // Keyboard operability: arrows move between controls, Esc closes and
    // returns focus to the CC button, Tab is trapped inside while open.
    panel.addEventListener('keydown', (e) => {
        // Keyboard use inside the panel is user activity — without this, the
        // stopPropagation below hides it from Video.js and the inactivity
        // timer yanks the panel away mid-navigation during playback.
        player.reportUserActivity();
        const f = focusables();
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            // Focus the button BEFORE hiding the panel: hiding a subtree that
            // still contains focus makes the browser reset focus to <body>
            // asynchronously, which would clobber the focus() call.
            ccBtn.el().focus();
            togglePanel(false);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation(); // don't let the player's seek bar react
            // With nothing focused (i === -1), Down enters at the first
            // control and Up at the last — not one past the wrap point.
            const next =
                e.key === 'ArrowDown' ? (i + 1) % f.length : i === -1 ? f.length - 1 : (i - 1 + f.length) % f.length;
            f[next].focus();
        } else if (e.key === 'Tab') {
            if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
                e.preventDefault();
                f[0].focus();
            } else if (e.shiftKey && document.activeElement === f[0]) {
                e.preventDefault();
                f[f.length - 1].focus();
            }
        }
    });

    const bar = player.getChild('controlBar');
    bar.addChild('SeekButton', { delta: -10 }, 1);
    bar.addChild('SeekButton', { delta: 10 }, 2);
    // CC + gear just before picture-in-picture/fullscreen, YouTube-style.
    // Icons come from the Video.js icon FONT (same sizing pipeline as
    // volume/PiP/fullscreen) — a raw text glyph renders undersized.
    const iconify = (cmp, iconClass) => {
        const ph = cmp.el().querySelector('.vjs-icon-placeholder');
        if (ph) ph.classList.add(iconClass);
    };
    const fsIdx = bar.children().indexOf(bar.getChild('fullscreenToggle'));
    const ccBtn = bar.addChild(
        'CcButton',
        { onToggle: (force, opts) => togglePanel(force, opts) },
        fsIdx > 0 ? fsIdx - 1 : undefined
    );
    iconify(ccBtn, 'vjs-icon-subtitles');
    ccBtn.el().setAttribute('aria-haspopup', 'dialog');
    ccBtn.el().setAttribute('aria-expanded', 'false');
    const gearBtn = bar.addChild('SettingsMenuButton', {}, fsIdx > 0 ? fsIdx : undefined);
    iconify(gearBtn, 'vjs-icon-cog');

    player.el().appendChild(panel);
    // Outside-click closes the panel (capture phase; the CC button itself is
    // excluded — its own handler owns the toggle).
    document.addEventListener(
        'click',
        (e) => {
            // The upload flow's programmatic #subtitleInput click bubbles here
            // too — it must not count as an outside click, or the panel closes
            // the moment the file chooser opens.
            if (e.target.id === 'subtitleInput') return;
            if (panel.style.display !== 'none' && !panel.contains(e.target) && !ccBtn.el().contains(e.target)) {
                togglePanel(false);
            }
        },
        true
    );
    // The panel belongs to the control bar visually — when Video.js fades the
    // bar out (user inactivity DURING PLAYBACK), dismiss the panel with it.
    // While paused the bar never fades, so the panel stays too.
    player.on('userinactive', () => {
        if (!player.paused()) togglePanel(false);
    });

    console.log(`[proto] Video.js ${videojs.VERSION} chrome active — sync engine still on the native element`);
    return player;
}
