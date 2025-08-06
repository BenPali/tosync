// modules/authManager.js - Authentication and role management

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, videoPlayer, torrentManager, uiManager } from '../main.js';

export class AuthManager {
    setRole(role, name) {
        state.userRole = role;
        state.userName = name;

        // Clean up any existing guest join form
        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) {
            guestJoinForm.remove();
        }

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
        document.getElementById('torrentInfo').classList.add('hidden');

        document.getElementById('torrentInput').value = '';
        document.getElementById('fileInput').value = '';

        uiManager.updateMediaStatus('Select your access level to begin');
    }
}