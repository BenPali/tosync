import { state } from '../state.js';
import { config } from '../config.js';
import { authManager, torrentManager, uiManager } from '../main.js';
import { destroyHls } from './codecUtils.js';

export class RoomManager {
    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < config.ROOM_CODE_LENGTH; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    createRoom() {
        this.showAdminNamePrompt();
    }

    showAdminNamePrompt() {
        // STRICT HIDE: Ensure only this form is visible
        const selector = document.getElementById('roomSelector');
        if (selector) selector.classList.add('hidden');

        const mainApp = document.getElementById('mainApp');
        if (mainApp) mainApp.classList.add('hidden');

        const adminNameFormHtml = `
            <div id="adminNameForm" class="max-w-md mx-auto mt-10 surface border hairline rounded-2xl p-7 shadow-2xl fade-in">
                <h3 class="text-lg font-semibold text-neutral-100 mb-1">Create a room</h3>
                <p class="text-neutral-500 text-sm mb-5">Pick a display name for this session.</p>
                <div class="mb-5">
                    <label for="adminNameInput" class="block text-xs text-neutral-300 mb-1.5">Display name</label>
                    <input type="text" id="adminNameInput" placeholder="Admin"
                           class="w-full bg-inset border hairline rounded-lg px-3 py-2.5 text-neutral-100 transition">
                </div>
                <div class="flex gap-2">
                    <button id="createRoomWithNameBtn" class="flex-1 bg-primary hover:opacity-90 text-neutral-950 font-semibold py-2.5 rounded-lg transition shadow-lg shadow-black/40">
                        Create room
                    </button>
                    <button id="backToRoomSelectFromAdminBtn" class="px-5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/40 text-sm rounded-lg transition">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        const existingForm = document.getElementById('adminNameForm');
        if (existingForm) existingForm.remove();

        if (selector) {
            selector.insertAdjacentHTML('afterend', adminNameFormHtml);
        }

        const createBtn = document.getElementById('createRoomWithNameBtn');
        if (createBtn) createBtn.addEventListener('click', () => this.proceedWithRoomCreation());

        const backBtn = document.getElementById('backToRoomSelectFromAdminBtn');
        if (backBtn) backBtn.addEventListener('click', () => this.backToRoomSelect());

        const nameInput = document.getElementById('adminNameInput');
        if (nameInput) {
            nameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.proceedWithRoomCreation();
            });
            nameInput.focus();
        }
    }

    proceedWithRoomCreation() {
        const adminNameInput = document.getElementById('adminNameInput');
        const adminName = adminNameInput ? adminNameInput.value.trim() || 'Admin' : 'Admin';

        const roomCode = this.generateRoomCode();
        state.currentRoomId = roomCode;
        state.isRoomCreator = true;

        window.history.pushState({ roomId: roomCode, isRoomCreator: true }, '', `/${roomCode}`);

        const form = document.getElementById('adminNameForm');
        if (form) form.remove();

        authManager.setRole('admin', adminName);
    }

    joinRoom() {
        const input = document.getElementById('roomCodeInput');
        if (!input) return;

        const roomCode = input.value.trim().toUpperCase();

        if (!roomCode || roomCode.length !== config.ROOM_CODE_LENGTH) {
            const error = document.getElementById('joinError');
            if (error) error.classList.remove('hidden');
            return;
        }

        state.currentRoomId = roomCode;
        state.isRoomCreator = false;

        window.history.pushState({ roomId: roomCode, isRoomCreator: false }, '', `/${roomCode}`);

        const landingPage = document.getElementById('landingPage');
        if (landingPage) landingPage.classList.add('hidden');

        const roomSelector = document.getElementById('roomSelector');
        if (roomSelector) roomSelector.classList.add('hidden');

        this.showGuestNameForm();
    }

    showGuestNameForm() {
        // STRICT HIDE: Ensure only validation/form is visible
        const selector = document.getElementById('roomSelector');
        if (selector) selector.classList.add('hidden');

        const mainApp = document.getElementById('mainApp');
        if (mainApp) mainApp.classList.add('hidden');

        const existingValidation = document.getElementById('roomValidation');
        if (existingValidation) existingValidation.remove();

        const existingForm = document.getElementById('guestJoinForm');
        if (existingForm) existingForm.remove();

        // state.currentRoomId is validated to [A-Z0-9]+ before this point.
        const connectingHtml = `
        <div id="roomValidation" class="max-w-md mx-auto mt-16 text-center fade-in">
            <div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-neutral-700 border-t-primary mb-4"></div>
            <h3 class="text-base font-medium text-neutral-100 mb-1">Connecting…</h3>
            <p class="text-neutral-500 text-sm">Validating room <span class="font-mono text-neutral-300">${state.currentRoomId}</span></p>
        </div>
        `;

        if (selector) selector.insertAdjacentHTML('afterend', connectingHtml);

        const tempSocket = io();
        tempSocket.emit('validate-room', { roomId: state.currentRoomId });

        tempSocket.on('room-exists', () => {
            tempSocket.disconnect();
            const val = document.getElementById('roomValidation');
            if (val) val.remove();
            this.showActualGuestForm();
        });

        tempSocket.on('room-not-found', () => {
            tempSocket.disconnect();
            const val = document.getElementById('roomValidation');
            if (val) val.remove();

            const notFound = document.getElementById('roomNotFound');
            if (notFound) notFound.classList.remove('hidden');

            const codeSpan = document.getElementById('invalidRoomCode');
            if (codeSpan) codeSpan.textContent = state.currentRoomId;

            const backBtn = document.getElementById('goBackHomeBtn');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    window.history.pushState({}, '', '/');
                    location.reload();
                });
            }
        });
    }

    showActualGuestForm() {
        // Double check Main App is hidden
        const mainApp = document.getElementById('mainApp');
        if (mainApp) mainApp.classList.add('hidden');

        const existingForm = document.getElementById('guestJoinForm');
        if (existingForm) existingForm.remove();

        // state.currentRoomId is validated to [A-Z0-9]+ before this point.
        const guestFormHtml = `
        <div id="guestJoinForm" class="max-w-md mx-auto mt-10 surface border hairline rounded-2xl p-7 shadow-2xl fade-in">
            <h3 class="text-lg font-semibold text-neutral-100 mb-1">Join room <span class="font-mono text-primary">${state.currentRoomId}</span></h3>
            <p class="text-neutral-500 text-sm mb-5">Enter your name to join.</p>
            <div class="mb-5">
                <label for="guestNameJoin" class="block text-xs text-neutral-300 mb-1.5">Display name</label>
                <input type="text" id="guestNameJoin" placeholder="Guest"
                       class="w-full bg-inset border hairline rounded-lg px-3 py-2.5 text-neutral-100 transition">
            </div>
            <div id="guestJoinError" class="hidden mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                Room not found
            </div>
            <div class="flex gap-2">
                <button id="joinAsGuestBtn" class="flex-1 bg-primary hover:opacity-90 text-neutral-950 font-semibold py-2.5 rounded-lg transition shadow-lg shadow-black/40">
                    Join
                </button>
                <button id="backToRoomSelectFromGuestBtn" class="px-5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/40 text-sm rounded-lg transition">
                    Cancel
                </button>
            </div>
        </div>
        `;

        const selector = document.getElementById('roomSelector');
        if (selector) selector.insertAdjacentHTML('afterend', guestFormHtml);

        const joinBtn = document.getElementById('joinAsGuestBtn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                const nameInput = document.getElementById('guestNameJoin');
                const name = nameInput ? nameInput.value.trim() || 'Anonymous' : 'Anonymous';
                authManager.setRole('guest', name);
                const form = document.getElementById('guestJoinForm');
                if (form) form.remove();
            });
        }

        const backBtn = document.getElementById('backToRoomSelectFromGuestBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                const form = document.getElementById('guestJoinForm');
                if (form) form.remove();
                this.backToRoomSelect();
            });
        }

        const nameInput = document.getElementById('guestNameJoin');
        if (nameInput) {
            nameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const name = nameInput.value.trim() || 'Anonymous';
                    authManager.setRole('guest', name);
                    const form = document.getElementById('guestJoinForm');
                    if (form) form.remove();
                }
            });
            nameInput.focus();
        }
    }

    proceedToRoleSelection() {
        if (!state.isRoomCreator) {
            this.showGuestNameForm();
        }
    }

    copyToClipboard(text, buttonId) {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                const button = document.getElementById(buttonId);
                if (button) {
                    const originalText = button.textContent;
                    button.textContent = '✓';
                    setTimeout(() => {
                        button.textContent = originalText;
                    }, 2000);
                }
            })
            .catch((err) => {
                console.error('Failed to copy:', err);
            });
    }

    async navigateToHome() {
        const landingPage = document.getElementById('landingPage');
        const roomSelector = document.getElementById('roomSelector');
        const mainApp = document.getElementById('mainApp');

        if (mainApp) mainApp.classList.add('hidden');

        const roomCodeInput = document.getElementById('roomCodeInput');
        if (roomCodeInput) roomCodeInput.value = '';

        const adminRoomCodeInput = document.getElementById('adminRoomCodeInput');
        if (adminRoomCodeInput) adminRoomCodeInput.value = '';

        const joinError = document.getElementById('joinError');
        if (joinError) joinError.classList.add('hidden');

        if (landingPage) {
            landingPage.classList.remove('hidden');
            if (roomSelector) roomSelector.classList.add('hidden');

            try {
                const response = await fetch('/api/auth/status', { credentials: 'include' });
                const data = await response.json();

                if (data.authenticated) {
                    landingPage.classList.add('hidden');
                    if (roomSelector) roomSelector.classList.remove('hidden');
                    const userSpan = document.getElementById('loggedInUsername');
                    if (userSpan) userSpan.textContent = data.username;
                }
            } catch (error) {
                console.error(error);
            }
        } else {
            if (roomSelector) roomSelector.classList.remove('hidden');
        }

        uiManager.updateMediaStatus('Select a room to begin');
    }

    cleanupSession() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        if (state.videoPlayer) {
            state.videoPlayer.pause();
            state.videoPlayer.src = '';
        }

        destroyHls();

        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        state.currentRoomId = null;
        state.isRoomCreator = false;
        state.isLiveStream = false;
        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
        }
        state.lastMediaAction = null;
        state.availableSubtitles = [];
        state.selectedSubtitleId = null;
        state.userRole = null;
        state.userName = 'Anonymous';
        state.isConnected = false;

        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) guestJoinForm.remove();
        const adminNameForm = document.getElementById('adminNameForm');
        if (adminNameForm) adminNameForm.remove();
        const roleSelector = document.getElementById('roleSelector');
        if (roleSelector) roleSelector.classList.add('hidden');

        const torrentInput = document.getElementById('torrentInput');
        if (torrentInput) torrentInput.value = '';
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';

        const shortcutsHint = document.getElementById('shortcutsHint');
        if (shortcutsHint) shortcutsHint.classList.add('hidden');
        const torrentInfoEl = document.getElementById('torrentInfo');
        if (torrentInfoEl) torrentInfoEl.classList.add('hidden');
        const iptvBrowser = document.getElementById('iptvBrowser');
        if (iptvBrowser) {
            iptvBrowser.classList.add('hidden');
            iptvBrowser.innerHTML = '';
        }
    }

    leaveRoom() {
        this.cleanupSession();
        window.history.pushState({}, '', '/');
        this.navigateToHome();
    }

    backToRoomSelect() {
        this.cleanupSession();
        window.history.pushState({}, '', '/');
        this.navigateToHome();
    }
}

export function setupPopStateHandler(roomManagerInstance) {
    window.addEventListener('popstate', (event) => {
        roomManagerInstance.cleanupSession();

        const roomId = event.state?.roomId;
        const isRoomCreator = event.state?.isRoomCreator ?? false;

        if (roomId) {
            state.currentRoomId = roomId;
            state.isRoomCreator = isRoomCreator;

            if (isRoomCreator) {
                authManager.setRole('admin', 'Admin');
            } else {
                roomManagerInstance.showGuestNameForm();
            }
        } else {
            roomManagerInstance.navigateToHome();
        }
    });
}
