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

        // Display room creation info
        document.getElementById('roomCodeDisplay').textContent = roomCode;
        const roomUrl = `${window.location.origin}/${roomCode}`;
        document.getElementById('roomUrlDisplay').textContent = roomUrl;

        document.getElementById('roomSelector').querySelector('h3').style.display = 'none';
        document.getElementById('roomSelector').querySelector('p').style.display = 'none';
        document.querySelector('.room-options').classList.add('hidden');
        document.getElementById('roomCreatedInfo').classList.remove('hidden');

        // Update URL without reloading
        window.history.pushState({ roomId: roomCode }, '', `/${roomCode}`);
    }

    joinRoom() {
        const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();

        if (!roomCode || roomCode.length !== config.ROOM_CODE_LENGTH) {
            document.getElementById('joinError').classList.remove('hidden');
            return;
        }

        state.currentRoomId = roomCode;
        state.isRoomCreator = false;

        // Update URL without reloading
        window.history.pushState({ roomId: roomCode }, '', `/${roomCode}`);

        // Check if room exists by proceeding to role selection
        this.proceedToRoleSelection();
    }

    proceedToRoleSelection() {
        document.getElementById('roomSelector').classList.add('hidden');
        document.getElementById('roleSelector').classList.remove('hidden');

        // Update room info display
        document.getElementById('roomInfo').textContent = `Room Code: ${state.currentRoomId}`;

        // If user is room creator, automatically set them as admin
        if (state.isRoomCreator) {
            authManager.setRole('admin', 'Room Creator');
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

        // Reset state
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

        // Clear URL
        window.history.pushState({}, '', '/');

        // Reset UI
        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('roomSelector').classList.remove('hidden');
        document.getElementById('roomCreatedInfo').classList.add('hidden');
        document.querySelector('.room-options').classList.remove('hidden');
        document.getElementById('roomSelector').querySelector('h3').style.display = 'block';
        document.getElementById('roomSelector').querySelector('p').style.display = 'block';

        // Clear form inputs
        document.getElementById('roomCodeInput').value = '';
        document.getElementById('joinError').classList.add('hidden');
        document.getElementById('adminPassword').value = '';
        document.getElementById('guestName').value = '';
        document.getElementById('torrentInput').value = '';
        document.getElementById('fileInput').value = '';

        uiManager.updateMediaStatus('Select a room to begin');
    }

    backToRoomSelect() {
        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('roomSelector').classList.remove('hidden');
        state.currentRoomId = null;
        state.isRoomCreator = false;

        // Clear URL
        window.history.pushState({}, '', '/');
    }
}