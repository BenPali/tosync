// modules/authManager.js - Authentication and role management

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, videoPlayer, torrentManager, uiManager } from '../main.js';

export class AuthManager {
    selectAdmin() {
        if (state.isRoomCreator) {
            // Room creator doesn't need password
            this.setRole('admin', 'Room Creator');
        } else {
            document.getElementById('adminAuth').classList.remove('hidden');
            document.getElementById('guestNameForm').classList.add('hidden');
        }
    }

    selectGuest() {
        document.getElementById('guestNameForm').classList.remove('hidden');
        document.getElementById('adminAuth').classList.add('hidden');
    }

    cancelAuth() {
        document.getElementById('adminAuth').classList.add('hidden');
        document.getElementById('guestNameForm').classList.add('hidden');
        document.getElementById('authError').classList.add('hidden');
    }

    authenticateAdmin() {
        const password = document.getElementById('adminPassword').value;

        if (password === config.ADMIN_PASSWORD) {
            this.setRole('admin', 'Admin');
        } else {
            document.getElementById('authError').classList.remove('hidden');
            document.getElementById('adminPassword').value = '';
        }
    }

    setGuestName() {
        const name = document.getElementById('guestName').value.trim() || 'Anonymous';
        this.setRole('guest', name);
    }

    setRole(role, name) {
        state.userRole = role;
        state.userName = name;

        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');

        const roleIndicator = document.getElementById('roleIndicator');
        const userInfo = document.getElementById('userInfo');

        if (role === 'admin') {
            roleIndicator.textContent = 'Admin';
            roleIndicator.className = 'role-indicator admin';
            userInfo.textContent = `Logged in as ${name}`;
            document.getElementById('adminControls').style.display = 'block';
            document.getElementById('adminControls').classList.remove('hidden');
            document.getElementById('adminPlayerControls').classList.remove('hidden');
        } else {
            roleIndicator.textContent = 'Guest';
            roleIndicator.className = 'role-indicator guest';
            userInfo.textContent = `Connected as ${name}`;
            document.getElementById('adminControls').style.display = 'none';
            document.getElementById('adminControls').classList.add('hidden');
            document.getElementById('adminPlayerControls').classList.add('hidden');
        }

        uiManager.updateMediaStatus(`Ready - ${role} access in room ${state.currentRoomId}`);
        videoPlayer.setupEventListeners();
        socketManager.initializeSocket();
    }

    resetRole() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
        }

        state.currentTorrentInfo = null;
        torrentManager.clearTorrentProgress();
        state.lastMediaAction = null;
        state.availableSubtitles = [];
        state.selectedSubtitleId = null;
        state.userRole = null;
        state.userName = "Anonymous";
        state.isConnected = false;

        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('roleSelector').classList.remove('hidden');
        document.getElementById('adminAuth').classList.add('hidden');
        document.getElementById('guestNameForm').classList.add('hidden');
        document.getElementById('authError').classList.add('hidden');
        document.getElementById('torrentInfo').classList.add('hidden');

        document.getElementById('adminPassword').value = '';
        document.getElementById('guestName').value = '';
        document.getElementById('torrentInput').value = '';
        document.getElementById('fileInput').value = '';

        uiManager.updateMediaStatus('Select your access level to begin');
    }
}