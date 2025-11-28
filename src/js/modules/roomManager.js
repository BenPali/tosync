import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, authManager, torrentManager, uiManager } from '../main.js';

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
            <div id="adminNameForm" class="max-w-md mx-auto mt-10 bg-surface border border-white/5 rounded-2xl p-8 shadow-2xl fade-in">
                <h3 class="text-xl font-bold text-white mb-2">Create New Room</h3>
                <p class="text-slate-400 text-sm mb-6">Enter your display name for this session.</p>

                <div class="mb-6">
                    <label for="adminNameInput" class="block text-xs font-bold text-slate-500 uppercase mb-2">Display Name</label>
                    <input type="text" id="adminNameInput" placeholder="e.g. Admin"
                           class="w-full bg-dark border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary transition text-center">
                </div>

                <div class="flex gap-3">
                    <button id="createRoomWithNameBtn" class="flex-1 bg-primary hover:opacity-90 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-primary/20">
                        Create Room
                    </button>
                    <button id="backToRoomSelectFromAdminBtn" class="px-6 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition">
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
        const adminName = adminNameInput ? (adminNameInput.value.trim() || 'Admin') : 'Admin';

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

        const connectingHtml = `
        <div id="roomValidation" class="max-w-md mx-auto mt-10 text-center fade-in">
            <h3 class="text-xl font-bold text-white mb-2">Connecting...</h3>
            <p class="text-slate-400 text-sm mb-6">Validating room code ${state.currentRoomId}</p>
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
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

        const guestFormHtml = `
        <div id="guestJoinForm" class="max-w-md mx-auto mt-10 bg-surface border border-white/5 rounded-2xl p-8 shadow-2xl fade-in">
            <h3 class="text-xl font-bold text-white mb-2">Join Room ${state.currentRoomId}</h3>
            <p class="text-slate-400 text-sm mb-6">Enter your name to join the party.</p>

            <div class="mb-6">
                <label for="guestNameJoin" class="block text-xs font-bold text-slate-500 uppercase mb-2">Display Name</label>
                <input type="text" id="guestNameJoin" placeholder="e.g. Guest"
                       class="w-full bg-dark border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary transition text-center">
            </div>

            <div class="flex gap-3">
                <button id="joinAsGuestBtn" class="flex-1 bg-primary hover:opacity-90 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-primary/20">
                    Join Now
                </button>
                <button id="backToRoomSelectFromGuestBtn" class="px-6 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl transition">
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
                const name = nameInput ? (nameInput.value.trim() || 'Anonymous') : 'Anonymous';
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
        navigator.clipboard.writeText(text).then(() => {
            const button = document.getElementById(buttonId);
            if (button) {
                const originalText = button.textContent;
                button.textContent = '✓';
                setTimeout(() => {
                    button.textContent = originalText;
                }, 2000);
            }
        }).catch(err => {
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

    leaveRoom() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        state.currentRoomId = null;
        state.isRoomCreator = false;
        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
        }
        state.lastMediaAction = null;
        state.availableSubtitles = [];
        state.selectedSubtitleId = null;
        state.userRole = null;
        state.userName = "Anonymous";
        state.isConnected = false;

        window.history.pushState({}, '', '/');

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

        this.navigateToHome();
    }

    backToRoomSelect() {
        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) guestJoinForm.remove();

        const adminNameForm = document.getElementById('adminNameForm');
        if (adminNameForm) adminNameForm.remove();

        const roleSelector = document.getElementById('roleSelector');
        if (roleSelector) roleSelector.classList.add('hidden');

        state.currentRoomId = null;
        state.isRoomCreator = false;

        window.history.pushState({}, '', '/');

        this.navigateToHome();
    }
}

export function setupPopStateHandler(roomManagerInstance) {
    window.addEventListener('popstate', (event) => {
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
            roomManagerInstance.backToRoomSelect();
        }
    });
}