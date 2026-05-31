// modules/authManager.js - Authentication and role management

import { state } from '../state.js';
import { socketManager, videoPlayer, torrentManager, iptvManager, uiManager } from '../main.js';

export class AuthManager {
    setRole(role, name) {
        state.userRole = role;
        state.userName = name;

        const guestJoinForm = document.getElementById('guestJoinForm');
        if (guestJoinForm) guestJoinForm.remove();

        document.getElementById('roleSelector').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');

        const shortcutsHint = document.getElementById('shortcutsHint');
        if (shortcutsHint) shortcutsHint.classList.remove('hidden');

        this.updateUIForRole(role, name);
        this.hideUserMenu();

        uiManager.updateMediaStatus(`Ready — ${role} in ${state.currentRoomId}`);
        videoPlayer.setupEventListeners();
        socketManager.initializeSocket();
    }

    updateUIForRole(role, name) {
        const roleIndicator = document.getElementById('roleIndicator');
        const userInfo = document.getElementById('userInfo');

        const baseChip = 'text-[10px] font-semibold rounded-full px-2.5 py-0.5 uppercase tracking-wider border';
        if (role === 'admin') {
            roleIndicator.textContent = 'Admin';
            roleIndicator.className = `${baseChip} admin-glow text-primary bg-primary/10 border-primary/30`;
        } else {
            roleIndicator.textContent = 'Guest';
            roleIndicator.className = `${baseChip} text-neutral-300 bg-neutral-800/60 border-neutral-100/10`;
        }
        userInfo.textContent = name;

        // Elements that should only be visible (and thus interactive) for admins.
        // Server-side also enforces admin on the matching endpoints — this is the UX hint.
        const adminOnlyIds = ['adminControls', 'adminPlayerControls', 'subtitleUploadForm', 'subtitleTimingControl'];
        const isAdmin = role === 'admin';
        for (const id of adminOnlyIds) {
            document.getElementById(id)?.classList.toggle('hidden', !isAdmin);
        }

        const adminInstructions = document.getElementById('adminUserInstructions');
        if (adminInstructions) {
            adminInstructions.classList.toggle('hidden', role !== 'admin');
        }
    }

    /**
     * Simple admin transfer handler
     */
    handleAdminTransferred(data) {
        const { newAdminName, formerAdminName, isYouNewAdmin, isYouFormerAdmin, reason } = data;

        if (isYouNewAdmin) {
            // You are now the admin
            state.userRole = 'admin';
            this.updateUIForRole('admin', state.userName);

            // Restore torrent UI if a torrent is active. The broadcast payload
            // only carries a single-file pointer, so re-fetch the full file
            // list from the server before rendering the picker.
            if (state.currentTorrentInfo && torrentManager) {
                const info = document.getElementById('torrentInfo');
                if (info) info.classList.remove('hidden');
                const hash = state.currentTorrentInfo.infoHash;
                fetch(`/api/torrents/${hash}/status`, { credentials: 'include' })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (data?.files) torrentManager.displayTorrentFiles(data.files);
                    })
                    .catch(() => {});
                torrentManager.updateTorrentProgressFromServer();
            }

            // Restore IPTV browser if a playlist was loaded
            if (iptvManager) {
                iptvManager.restoreIfCached();
            }

            if (reason === 'admin-left') {
                uiManager.updateLastAction(`You are now the admin (${formerAdminName} left)`);
            } else {
                uiManager.updateLastAction(`You are now the admin (transferred from ${formerAdminName})`);
            }
        } else if (isYouFormerAdmin) {
            // You are now a guest
            state.userRole = 'guest';
            this.updateUIForRole('guest', state.userName);
            uiManager.updateLastAction(`Admin rights transferred to ${newAdminName}`);
        } else {
            // You are observing the transfer
            if (reason === 'admin-left') {
                uiManager.updateLastAction(`${formerAdminName} left. ${newAdminName} is now admin.`);
            } else {
                uiManager.updateLastAction(`${formerAdminName} transferred admin rights to ${newAdminName}`);
            }
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
        menu.className = 'fixed z-[60] surface border hairline rounded-xl shadow-2xl overflow-hidden min-w-[180px] fade-in';

        // Header showing the target user
        const header = document.createElement('div');
        header.className = 'px-3 py-2 border-b hairline text-xs text-neutral-500 flex items-center gap-2';
        const nameEl = document.createElement('span');
        nameEl.className = 'text-neutral-200 font-medium truncate';
        nameEl.textContent = userName;
        header.append(nameEl, (() => {
            const role = document.createElement('span');
            role.className = 'font-mono text-[10px]';
            role.textContent = '· ' + userRole;
            return role;
        })());
        menu.appendChild(header);

        const actions = [];
        if (userRole === 'guest') {
            actions.push({ label: 'Make admin', action: 'transfer-admin', cls: 'text-primary hover:bg-primary/10' });
        }
        actions.push({ label: 'Kick user', action: 'kick-user', cls: 'text-red-400 hover:bg-red-500/10' });

        for (const a of actions) {
            const btn = document.createElement('button');
            btn.className = `w-full text-left text-sm ${a.cls} px-3 py-2 transition`;
            btn.textContent = a.label;
            btn.addEventListener('click', () => {
                this.handleUserAction(a.action, userName, userRole);
                this.hideUserMenu();
            });
            menu.appendChild(btn);
        }

        // Position near the clicked chip; clamp to viewport.
        const rect = event.target.getBoundingClientRect();
        const top = Math.min(rect.bottom + 6, window.innerHeight - 130);
        const left = Math.min(rect.right - 180, window.innerWidth - 200);
        menu.style.left = Math.max(8, left) + 'px';
        menu.style.top = top + 'px';

        document.body.appendChild(menu);

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

}