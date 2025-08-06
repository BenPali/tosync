// modules/roomManager.js - Room management functionality

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
        const roomCode = this.generateRoomCode();
        state.currentRoomId = roomCode;
        state.isRoomCreator = true;

        window.history.pushState({ roomId: roomCode, isRoomCreator: true }, '', `/${roomCode}`);

        document.getElementById('roomSelector').classList.add('hidden');
        authManager.setRole('admin', 'Room Creator');
    }

    joinRoom() {
        const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();

        if (!roomCode || roomCode.length !== config.ROOM_CODE_LENGTH) {
            document.getElementById('joinError').classList.remove('hidden');
            return;
        }

        state.currentRoomId = roomCode;
        state.isRoomCreator = false;

        window.history.pushState({ roomId: roomCode, isRoomCreator: false }, '', `/${roomCode}`);

        this.showGuestNameForm();
    }

    showGuestNameForm() {
        document.getElementById('roomSelector').classList.add('hidden');

        const guestFormHtml = `
            <div class="section" id="guestJoinForm" style="max-width: 500px; margin: 40px auto;">
                <h3>Join Room ${state.currentRoomId}</h3>
                <p style="color: #718096; margin-bottom: 24px;">Enter your name to join the room</p>

                <div class="form-group">
                    <label for="guestNameJoin">Your Name:</label>
                    <input type="text" id="guestNameJoin" placeholder="Enter your name or leave blank for Anonymous">
                </div>

                <button class="btn" id="joinAsGuestBtn">Join Room</button>
                <button class="btn secondary" id="backToRoomSelectFromGuestBtn">Cancel</button>

                <div id="guestJoinError" class="alert error hidden" style="margin-top: 12px;">Room not found. Please check the code and try again.</div>
            </div>
        `;

        const existingForm = document.getElementById('guestJoinForm');
        if (existingForm) existingForm.remove();

        const roomSelector = document.getElementById('roomSelector');
        roomSelector.insertAdjacentHTML('afterend', guestFormHtml);

        document.getElementById('joinAsGuestBtn').addEventListener('click', () => {
            const name = document.getElementById('guestNameJoin').value.trim() || 'Anonymous';
            authManager.setRole('guest', name);
            document.getElementById('guestJoinForm').remove();
        });

        document.getElementById('backToRoomSelectFromGuestBtn').addEventListener('click', () => {
            document.getElementById('guestJoinForm').remove();
            this.backToRoomSelect();
        });

        document.getElementById('guestNameJoin').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const name = document.getElementById('guestNameJoin').value.trim() || 'Anonymous';
                authManager.setRole('guest', name);
                document.getElementById('guestJoinForm').remove();
            }
        });

        document.getElementById('guestNameJoin').focus();
    }

    proceedToRoleSelection() {
        if (!state.isRoomCreator) {
            this.showGuestNameForm();
        }
    }

    copyToClipboard(text, buttonId) {
        navigator.clipboard.writeText(text).then(() => {
            const button = document.getElementById(buttonId);
            const originalText = button.textContent;
            button.textContent = '✓';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    leaveRoom() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        state.currentRoomId = null;
        state.isRoomCreator = false;
        state.currentTorrentInfo = null;
        torrentManager.clearTorrentProgress();
        state.lastMediaAction = null;
        state.availableSubtitles = [];
        state.selectedSubtitleId = null;
        state.userRole = null;
        state.userName = "Anonymous";
        state.isConnected = false;

        window.history.pushState({}, '', '/');

        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) guestJoinForm.remove();

        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('roomSelector').classList.remove('hidden');
        document.querySelector('.room-options').classList.remove('hidden');
        document.getElementById('roomSelector').querySelector('h3').style.display = 'block';
        document.getElementById('roomSelector').querySelector('p').style.display = 'block';

        document.getElementById('roomCodeInput').value = '';
        document.getElementById('joinError').classList.add('hidden');
        document.getElementById('torrentInput').value = '';
        document.getElementById('fileInput').value = '';

        uiManager.updateMediaStatus('Select a room to begin');
    }

    backToRoomSelect() {
        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) guestJoinForm.remove();

        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('roomSelector').classList.remove('hidden');
        state.currentRoomId = null;
        state.isRoomCreator = false;

        window.history.pushState({}, '', '/');
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
                authManager.setRole('admin', 'Room Creator');
            } else {
                roomManagerInstance.showGuestNameForm();
            }
        } else {
            roomManagerInstance.backToRoomSelect();
        }
    });
}
