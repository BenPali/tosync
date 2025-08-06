// main.js - Entry point for Tosync application

// Import all modules
import { RoomManager, setupPopStateHandler } from './modules/roomManager.js';
import { SocketManager } from './modules/socketManager.js';
import { VideoPlayer } from './modules/videoPlayer.js';
import { MediaManager } from './modules/mediaManager.js';
import { AuthManager } from './modules/authManager.js';
import { UIManager } from './modules/uiManager.js';
import { SubtitleManager } from './modules/subtitleManager.js';
import { TorrentManager } from './modules/torrentManager.js';
import { FileLibraryManager } from './modules/fileLibraryManager.js';
import { config } from './config.js';
import { state } from './state.js';

// Initialize managers
const roomManager = new RoomManager();
const socketManager = new SocketManager();
const videoPlayer = new VideoPlayer();
const mediaManager = new MediaManager();
const authManager = new AuthManager();
const uiManager = new UIManager();
const subtitleManager = new SubtitleManager();
const torrentManager = new TorrentManager();
const fileLibraryManager = new FileLibraryManager();

// Export managers for use in other modules
export {
    roomManager,
    socketManager,
    videoPlayer,
    mediaManager,
    authManager,
    uiManager,
    subtitleManager,
    torrentManager,
    fileLibraryManager
};

// Enable back/forward browser navigation
setupPopStateHandler(roomManager);

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    state.videoPlayer = document.getElementById('videoPlayer');

    uiManager.initialize();
    uiManager.updateMediaStatus('Select a room to begin');
    subtitleManager.initialize();
    setupUIEventListeners();

    const pathParts = window.location.pathname.split('/');
    const possibleRoomCode = pathParts[1];

    if (possibleRoomCode && possibleRoomCode.length === 6) {
        state.currentRoomId = possibleRoomCode.toUpperCase();
        state.isRoomCreator = false;
        window.history.replaceState({ roomId: state.currentRoomId, isRoomCreator: false }, '', `/${state.currentRoomId}`);
        roomManager.proceedToRoleSelection();
    }
});

function setupUIEventListeners() {
    document.getElementById('createRoomBtn').addEventListener('click', () => roomManager.createRoom());
    document.getElementById('joinRoomBtn').addEventListener('click', () => roomManager.joinRoom());
    document.getElementById('currentRoomCode').addEventListener('click', () => {
        const roomUrl = `${window.location.origin}/${state.currentRoomId}`;
        navigator.clipboard.writeText(roomUrl).then(() => {
            const badge = document.getElementById('currentRoomCode');
            const originalText = badge.textContent;
            badge.textContent = 'URL Copied!';
            setTimeout(() => badge.textContent = originalText, 2000);
        }).catch(err => console.error('Failed to copy:', err));
    });

    document.getElementById('leaveRoomBtn').addEventListener('click', () => roomManager.leaveRoom());
    document.getElementById('uploadBtn').addEventListener('click', () => mediaManager.uploadFile());
    document.getElementById('clearMediaBtn').addEventListener('click', () => mediaManager.clearMedia());
    document.getElementById('loadTorrentBtn').addEventListener('click', () => torrentManager.loadTorrent());
    document.getElementById('uploadSubtitleBtn').addEventListener('click', () => subtitleManager.uploadSubtitle());
    document.getElementById('resetRoleBtn').addEventListener('click', () => authManager.resetRole());
    document.getElementById('refreshLibraryBtn').addEventListener('click', () => fileLibraryManager.loadFileLibrary());
    document.getElementById('togglePlayBtn').addEventListener('click', () => videoPlayer.togglePlay());
    document.getElementById('seekBackBtn').addEventListener('click', () => videoPlayer.seekBackward());
    document.getElementById('seekForwardBtn').addEventListener('click', () => videoPlayer.seekForward());
    document.getElementById('fullscreenBtn').addEventListener('click', () => videoPlayer.toggleFullscreen());
    document.getElementById('syncTimeBtn').addEventListener('click', () => videoPlayer.syncTime());
    document.getElementById('restartBtn').addEventListener('click', () => videoPlayer.restartVideo());
    document.getElementById('rate05Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(0.5));
    document.getElementById('rate1Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(1));
    document.getElementById('rate15Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(1.5));

    document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') roomManager.joinRoom();
    });

    document.getElementById('roomCodeInput').addEventListener('input', (e) => {
        let value = e.target.value;
        if (value.includes('://') || value.includes('/')) {
            const parts = value.split('/');
            const possibleCode = parts[parts.length - 1];
            if (possibleCode && possibleCode.length === 6) value = possibleCode;
        }
        e.target.value = value.toUpperCase().slice(0, 6);
    });

    document.getElementById('roomCodeInput').addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        let roomCode = pastedText;

        if (pastedText.includes('://') || pastedText.includes('/')) {
            const parts = pastedText.split('/');
            const lastSegment = parts[parts.length - 1];
            if (lastSegment && lastSegment.length === 6) {
                roomCode = lastSegment;
            } else {
                const match = pastedText.match(/[A-Z0-9]{6}/i);
                if (match) roomCode = match[0];
            }
        }

        e.target.value = roomCode.toUpperCase().slice(0, 6);
    });

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
