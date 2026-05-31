import { RoomManager, setupPopStateHandler } from './modules/roomManager.js';
import { SocketManager } from './modules/socketManager.js';
import { VideoPlayer } from './modules/videoPlayer.js';
import { MediaManager } from './modules/mediaManager.js';
import { AuthManager } from './modules/authManager.js';
import { UIManager } from './modules/uiManager.js';
import { SubtitleManager } from './modules/subtitleManager.js';
import { FileLibraryManager } from './modules/fileLibraryManager.js';
import { config } from './config.js';
import { state } from './state.js';

const roomManager = new RoomManager();
const socketManager = new SocketManager();
const videoPlayer = new VideoPlayer();
const mediaManager = new MediaManager();
const authManager = new AuthManager();
const uiManager = new UIManager();
const subtitleManager = new SubtitleManager();
const fileLibraryManager = new FileLibraryManager();

let torrentManager = null;
let iptvManager = null;

export {
    roomManager, socketManager, videoPlayer, mediaManager,
    authManager, uiManager, subtitleManager, torrentManager, fileLibraryManager,
    iptvManager
};

setupPopStateHandler(roomManager);

document.addEventListener('DOMContentLoaded', async () => {
    state.videoPlayer = document.getElementById('videoPlayer');

    uiManager.initialize();
    uiManager.updateMediaStatus('Select a room to begin');
    subtitleManager.initialize();

    if (config.ENABLE_TORRENTS) {
        try {
            const { TorrentManager } = await import('./modules/torrentManager.js');
            torrentManager = new TorrentManager();
        } catch (error) {
            console.error('Failed to load TorrentManager:', error);
        }
        try {
            const { IptvManager } = await import('./modules/iptvManager.js');
            iptvManager = new IptvManager();
        } catch (error) {
            console.error('Failed to load IptvManager:', error);
        }
    }

    setupUIEventListeners();

    if (config.ENABLE_TORRENTS) {
        await checkAuthStatus();
    }

    const pathParts = window.location.pathname.split('/');
    const possibleRoomCode = pathParts[1];

    if (possibleRoomCode && possibleRoomCode.length === config.ROOM_CODE_LENGTH) {
        state.currentRoomId = possibleRoomCode.toUpperCase();
        state.isRoomCreator = false;
        window.history.replaceState({ roomId: state.currentRoomId, isRoomCreator: false }, '', `/${state.currentRoomId}`);
        roomManager.proceedToRoleSelection();
    }
});

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status', { credentials: 'include' });
        const data = await response.json();

        if (data.authenticated) {
            const selector = document.getElementById('roomSelector');
            if (selector) selector.classList.remove('hidden');

            const usernameSpan = document.getElementById('loggedInUsername');
            if (usernameSpan) usernameSpan.textContent = data.username;

            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

function syncThemeIcons() {
    const isLight = document.documentElement.classList.contains('light');
    document.querySelectorAll('[data-theme-icon]').forEach(icon => {
        const showInLight = icon.dataset.themeIcon === 'light';
        icon.classList.toggle('hidden', showInLight !== isLight);
    });
}

function setupUIEventListeners() {

    // Theme toggle — theme.js handles the actual class swap + persistence.
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn && typeof window.__tosyncToggleTheme === 'function') {
        themeBtn.addEventListener('click', () => window.__tosyncToggleTheme());
    }
    document.addEventListener('theme-change', syncThemeIcons);
    syncThemeIcons();

    if (config.ENABLE_TORRENTS) {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    }

    const createBtn = document.getElementById('createRoomBtn');
    if (createBtn) createBtn.addEventListener('click', () => roomManager.createRoom());

    const joinBtn = document.getElementById('joinRoomBtn');
    if (joinBtn) joinBtn.addEventListener('click', () => roomManager.joinRoom());

    const adminJoinBtn = document.getElementById('adminJoinRoomBtn');
    if (adminJoinBtn) adminJoinBtn.addEventListener('click', () => {
        const adminCode = document.getElementById('adminRoomCodeInput').value;
        const mainInput = document.getElementById('roomCodeInput');
        if (mainInput) mainInput.value = adminCode;
        roomManager.joinRoom();
    });

    const badge = document.getElementById('currentRoomCode');
    if (badge) {
        badge.addEventListener('click', () => {
            const roomUrl = `${window.location.origin}/${state.currentRoomId}`;
            navigator.clipboard.writeText(roomUrl).then(() => {
                uiManager.toast('success', 'Room URL copied');
            }).catch(err => {
                console.error('Failed to copy:', err);
                uiManager.toast('error', 'Could not copy URL');
            });
        });
    }

    const addListener = (id, action) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', action);
    };

    addListener('leaveRoomBtn', () => roomManager.leaveRoom());
    addListener('uploadBtn', () => mediaManager.uploadFile());
    addListener('clearMediaBtn', () => mediaManager.clearMedia());
    addListener('uploadSubtitleBtn', () => subtitleManager.uploadSubtitle());
    addListener('subtitleOffsetUpBtn', () => subtitleManager.adjustSubtitleOffset(0.5));
    addListener('subtitleOffsetDownBtn', () => subtitleManager.adjustSubtitleOffset(-0.5));
    addListener('refreshLibraryBtn', () => fileLibraryManager.loadFileLibrary());

    addListener('togglePlayBtn', () => videoPlayer.togglePlay());
    addListener('seekBackBtn', () => videoPlayer.seekBackward());
    addListener('seekForwardBtn', () => videoPlayer.seekForward());
    addListener('fullscreenBtn', () => videoPlayer.toggleFullscreen());
    addListener('syncTimeBtn', () => videoPlayer.syncTime());
    addListener('restartBtn', () => videoPlayer.restartVideo());
    addListener('rate1Btn', () => videoPlayer.setPlaybackRate(1));
    addListener('rate15Btn', () => videoPlayer.setPlaybackRate(1.5));

    if (config.ENABLE_TORRENTS) {
        if (torrentManager) {
            addListener('loadTorrentBtn', () => torrentManager.loadTorrent());
            addListener('removeTorrentBtn', () => torrentManager.removeTorrent());
        }
        if (iptvManager) {
            addListener('loadPlaylistBtn', () => iptvManager.loadPlaylist());
        }
    }

    const roomInput = document.getElementById('roomCodeInput');
    if (roomInput) {
        roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') roomManager.joinRoom();
        });

        roomInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, config.ROOM_CODE_LENGTH);
        });

        roomInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const raw = (e.clipboardData || window.clipboardData).getData('text').trim();
            let code = raw;

            if (raw.includes('/')) {
                try {
                    const url = new URL(raw);
                    const segments = url.pathname.split('/').filter(Boolean);
                    if (segments.length) code = segments[segments.length - 1];
                } catch {
                    const cleaned = raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
                    code = cleaned.split('/').pop() || raw;
                }
            }

            e.target.value = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, config.ROOM_CODE_LENGTH);
        });
    }

    document.addEventListener('keydown', (e) => {
        // Esc always closes the shortcut overlay, even when focus is on input
        if (e.key === 'Escape') {
            const overlay = document.getElementById('shortcutsOverlay');
            if (overlay) { e.preventDefault(); uiManager.hideShortcutsOverlay(); return; }
        }
        // e.target can be the document (no tagName) when an event is dispatched
        // programmatically. Guard with optional chaining.
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); videoPlayer.togglePlay(); break;
            case 'ArrowLeft': e.preventDefault(); videoPlayer.seekBackward(); break;
            case 'ArrowRight': e.preventDefault(); videoPlayer.seekForward(); break;
            case 'KeyF': e.preventDefault(); videoPlayer.toggleFullscreen(); break;
            case 'KeyS': e.preventDefault(); subtitleManager.toggleSubtitles(); break;
            case 'Slash':
                if (e.shiftKey) { e.preventDefault(); uiManager.showShortcutsOverlay(); }
                break;
        }
    });

    // "?" shortcuts pill click → overlay
    const shortcutsHint = document.getElementById('shortcutsHint');
    if (shortcutsHint) {
        shortcutsHint.addEventListener('click', () => uiManager.showShortcutsOverlay());
    }
}