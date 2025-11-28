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

export {
    roomManager, socketManager, videoPlayer, mediaManager,
    authManager, uiManager, subtitleManager, torrentManager, fileLibraryManager
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

function setupUIEventListeners() {
    console.log('[SETUP] Events initialized');

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
                const originalText = badge.textContent;
            badge.textContent = 'URL Copied!';
                setTimeout(() => badge.textContent = originalText, 2000);
            }).catch(err => console.error('Failed to copy:', err));
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
    addListener('resetRoleBtn', () => authManager.resetRole());
    addListener('refreshLibraryBtn', () => fileLibraryManager.loadFileLibrary());

    addListener('togglePlayBtn', () => videoPlayer.togglePlay());
    addListener('seekBackBtn', () => videoPlayer.seekBackward());
    addListener('seekForwardBtn', () => videoPlayer.seekForward());
    addListener('fullscreenBtn', () => videoPlayer.toggleFullscreen());
    addListener('syncTimeBtn', () => videoPlayer.syncTime());
    addListener('restartBtn', () => videoPlayer.restartVideo());
    addListener('rate05Btn', () => videoPlayer.setPlaybackRate(0.5));
    addListener('rate1Btn', () => videoPlayer.setPlaybackRate(1));
    addListener('rate15Btn', () => videoPlayer.setPlaybackRate(1.5));

    if (config.ENABLE_TORRENTS && torrentManager) {
        addListener('loadTorrentBtn', () => torrentManager.loadTorrent());
    }

    const roomInput = document.getElementById('roomCodeInput');
    if (roomInput) {
        roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') roomManager.joinRoom();
        });

        roomInput.addEventListener('input', (e) => {
            let value = e.target.value;
            if (value.includes('://') || value.includes('/')) {
                const parts = value.split('/');
                const possibleCode = parts[parts.length - 1];
                if (possibleCode && possibleCode.length === config.ROOM_CODE_LENGTH) value = possibleCode;
            }
            e.target.value = value.toUpperCase().slice(0, config.ROOM_CODE_LENGTH);
        });

        roomInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            let roomCode = pastedText;

            if (pastedText.includes('://') || pastedText.includes('/')) {
                const parts = pastedText.split('/');
                const lastSegment = parts[parts.length - 1];
                if (lastSegment && lastSegment.length === config.ROOM_CODE_LENGTH) {
                    roomCode = lastSegment;
                } else {
                    const match = pastedText.match(new RegExp(`[A-Z0-9]{${config.ROOM_CODE_LENGTH}}`, 'i'));
                    if (match) roomCode = match[0];
                }
            }

            e.target.value = roomCode.toUpperCase().slice(0, config.ROOM_CODE_LENGTH);
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName.toLowerCase() !== 'input') {
            switch (e.code) {
                case 'Space': e.preventDefault(); videoPlayer.togglePlay(); break;
                case 'ArrowLeft': e.preventDefault(); videoPlayer.seekBackward(); break;
                case 'ArrowRight': e.preventDefault(); videoPlayer.seekForward(); break;
                case 'KeyF': e.preventDefault(); videoPlayer.toggleFullscreen(); break;
                case 'KeyS': e.preventDefault(); subtitleManager.toggleSubtitles(); break;
            }
        }
    });
}

window.playLibraryFile = (fileUrl, fileName) => fileLibraryManager.playLibraryFile(fileUrl, fileName);