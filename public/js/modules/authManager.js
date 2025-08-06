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

        // Update UI for the role
        this.updateUIForRole(role, name);
        this.hideUserMenu();

        uiManager.updateMediaStatus(`Ready - ${role} access in room ${state.currentRoomId}`);
        videoPlayer.setupEventListeners();
        socketManager.initializeSocket();
    }

    updateUIForRole(role, name) {
        const roleIndicator = document.getElementById('roleIndicator');
        const userInfo = document.getElementById('userInfo');

        if (role === 'admin') {
            roleIndicator.textContent = 'Admin';
            roleIndicator.className = 'role-indicator admin';
            userInfo.textContent = `Connected as ${name}`;
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

        // Update admin instructions visibility
        const adminInstructions = document.getElementById('adminUserInstructions');
        if (adminInstructions) {
            adminInstructions.style.display = role === 'admin' ? 'block' : 'none';
        }
    }

    /**
     * Handle admin role transfer from server
     */
    handleAdminTransferred(data) {
        const { newAdminName, formerAdminName, isYouNewAdmin, isYouFormerAdmin } = data;

        if (isYouNewAdmin) {
            // You are now the admin - update your role immediately
            state.userRole = 'admin';
            this.updateUIForRole('admin', state.userName);
            uiManager.updateLastAction(`You are now the admin (transferred from ${formerAdminName})`);
        } else if (isYouFormerAdmin) {
            // You are now a guest - update your role immediately
            state.userRole = 'guest';
            this.updateUIForRole('guest', state.userName);
            uiManager.updateLastAction(`Admin rights transferred to ${newAdminName}`);
        } else {
            // You are observing the transfer
            uiManager.updateLastAction(`${formerAdminName} transferred admin rights to ${newAdminName}`);
        }

        // Hide any open user management menu
        this.hideUserMenu();
    }

    showUserMenu(userName, userRole, event) {
        // Only admins can manage users, and can't manage themselves
        if (state.userRole !== 'admin' || userName === state.userName) {
            return;
        }

        // Remove existing menu if any
        this.hideUserMenu();

        const menu = document.createElement('div');
        menu.id = 'userManagementMenu';
        menu.className = 'user-management-menu';

        const actions = [];

        // Add transfer admin option for guests
        if (userRole === 'guest') {
            actions.push({
                text: '👑 Make Admin',
                action: 'transfer-admin',
                className: 'make-admin'
            });
        }

        // Add kick option for all users except self
        actions.push({
            text: '🚪 Kick User',
            action: 'kick-user',
            className: 'kick-user'
        });

        actions.forEach(actionItem => {
            const button = document.createElement('button');
            button.className = `user-menu-btn ${actionItem.className}`;
            button.textContent = actionItem.text;
            button.onclick = () => {
                this.handleUserAction(actionItem.action, userName, userRole);
                this.hideUserMenu();
            };
            menu.appendChild(button);
        });

        // Position menu near the clicked user
        const rect = event.target.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.right + 10 + 'px';
        menu.style.top = rect.top + 'px';
        menu.style.zIndex = '1000';

        document.body.appendChild(menu);

        // Close menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener('click', this.hideUserMenu.bind(this), { once: true });
        }, 100);
    }

    hideUserMenu() {
        const menu = document.getElementById('userManagementMenu');
        if (menu) {
            menu.remove();
        }
    }

    handleUserAction(action, targetUserName, targetUserRole) {
        switch (action) {
            case 'transfer-admin':
                this.transferAdminTo(targetUserName);
                break;
            case 'kick-user':
                this.kickUser(targetUserName);
                break;
        }
    }

    transferAdminTo(targetUserName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can transfer permissions');
            return;
        }

        if (!confirm(`Are you sure you want to transfer admin rights to ${targetUserName}? You will become a guest user.`)) {
            return;
        }

        if (state.socket && state.isConnected) {
            state.socket.emit('transfer-admin', {
                targetUserName: targetUserName
            });
        }
    }

    kickUser(targetUserName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can kick users');
            return;
        }

        if (!confirm(`Are you sure you want to kick ${targetUserName} from the room?`)) {
            return;
        }

        if (state.socket && state.isConnected) {
            state.socket.emit('kick-user', {
                targetUserName: targetUserName
            });
        }
    }

    handleUserKicked(data) {
        const { kickedUserName, kickedByAdmin } = data;

        if (data.isYouKicked) {
            // You were kicked
            uiManager.showError(`You were kicked from the room by ${kickedByAdmin}`);
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        } else {
            // Someone else was kicked
            uiManager.updateLastAction(`${kickedUserName} was kicked by ${kickedByAdmin}`);
        }
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

        // Hide user menu
        this.hideUserMenu();

        uiManager.updateMediaStatus('Select your access level to begin');
    }
}