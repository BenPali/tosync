// main.js - Entry point for Tosync application

// Import all modules
import { RoomManager } from './modules/roomManager.js';
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize video player element
    state.videoPlayer = document.getElementById('videoPlayer');

    // Initialize UI
    uiManager.initialize();
    uiManager.updateMediaStatus('Select a room to begin');

    // Initialize subtitle support
    subtitleManager.initialize();

    // Setup all event listeners
    setupUIEventListeners();

    // Check if URL contains a room code
    const pathParts = window.location.pathname.split('/');
    const possibleRoomCode = pathParts[1];

    if (possibleRoomCode && possibleRoomCode.length === 6) {
        // Auto-join room from URL
        state.currentRoomId = possibleRoomCode.toUpperCase();
        state.isRoomCreator = false;
        roomManager.proceedToRoleSelection();
    }
});

// Setup all UI event listeners
function setupUIEventListeners() {
    // Room selection buttons
    document.getElementById('createRoomBtn').addEventListener('click', () => roomManager.createRoom());
    document.getElementById('joinRoomBtn').addEventListener('click', () => roomManager.joinRoom());
    document.getElementById('proceedToRoomBtn').addEventListener('click', () => roomManager.proceedToRoleSelection());
    document.getElementById('copyCodeBtn').addEventListener('click', () => {
        roomManager.copyToClipboard(state.currentRoomId, 'copyCodeBtn');
    });
    document.getElementById('copyUrlBtn').addEventListener('click', () => {
        roomManager.copyToClipboard(`${window.location.origin}/${state.currentRoomId}`, 'copyUrlBtn');
    });
    document.getElementById('leaveRoomBtn').addEventListener('click', () => roomManager.leaveRoom());
    document.getElementById('backToRoomSelectBtn').addEventListener('click', () => roomManager.backToRoomSelect());

    // Role selection buttons
    document.getElementById('adminBtn').addEventListener('click', () => authManager.selectAdmin());
    document.getElementById('guestBtn').addEventListener('click', () => authManager.selectGuest());

    // Authentication buttons
    document.getElementById('authenticateBtn').addEventListener('click', () => authManager.authenticateAdmin());
    document.getElementById('cancelAuthBtn').addEventListener('click', () => authManager.cancelAuth());
    document.getElementById('setGuestNameBtn').addEventListener('click', () => authManager.setGuestName());
    document.getElementById('cancelGuestBtn').addEventListener('click', () => authManager.cancelAuth());

    // Admin control buttons
    document.getElementById('uploadBtn').addEventListener('click', () => mediaManager.uploadFile());
    document.getElementById('clearMediaBtn').addEventListener('click', () => mediaManager.clearMedia());
    document.getElementById('loadTorrentBtn').addEventListener('click', () => torrentManager.loadTorrent());
    document.getElementById('uploadSubtitleBtn').addEventListener('click', () => subtitleManager.uploadSubtitle());
    document.getElementById('resetRoleBtn').addEventListener('click', () => authManager.resetRole());

    // File library buttons
    document.getElementById('refreshLibraryBtn').addEventListener('click', () => fileLibraryManager.loadFileLibrary());

    // Video control buttons
    document.getElementById('togglePlayBtn').addEventListener('click', () => videoPlayer.togglePlay());
    document.getElementById('seekBackBtn').addEventListener('click', () => videoPlayer.seekBackward());
    document.getElementById('seekForwardBtn').addEventListener('click', () => videoPlayer.seekForward());
    document.getElementById('fullscreenBtn').addEventListener('click', () => videoPlayer.toggleFullscreen());

    // Admin video control buttons
    document.getElementById('syncTimeBtn').addEventListener('click', () => videoPlayer.syncTime());
    document.getElementById('restartBtn').addEventListener('click', () => videoPlayer.restartVideo());
    document.getElementById('rate05Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(0.5));
    document.getElementById('rate1Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(1));
    document.getElementById('rate15Btn').addEventListener('click', () => videoPlayer.setPlaybackRate(1.5));

    // Enter key support
    document.getElementById('adminPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') authManager.authenticateAdmin();
    });

    document.getElementById('guestName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') authManager.setGuestName();
    });

    document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') roomManager.joinRoom();
    });

    // Auto-uppercase room code input
    document.getElementById('roomCodeInput').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName.toLowerCase() !== 'input') {
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    videoPlayer.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    videoPlayer.seekBackward();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    videoPlayer.seekForward();
                    break;
                case 'KeyF':
                    e.preventDefault();
                    videoPlayer.toggleFullscreen();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    subtitleManager.toggleSubtitles();
                    break;
            }
        }
    });
}

// Make playLibraryFile available globally for onclick handlers
window.playLibraryFile = (fileUrl, fileName) => fileLibraryManager.playLibraryFile(fileUrl, fileName);