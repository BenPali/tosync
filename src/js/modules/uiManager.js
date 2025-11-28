import { state } from '../state.js';

export class UIManager {
    initialize() {
    }

    updateConnectionStatus(message, status) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = message;
            if (status === 'connected') {
                statusElement.className = 'mb-4 text-center text-xs text-emerald-400 font-bold';
            } else {
                statusElement.className = 'mb-4 text-center text-xs text-red-400 animate-pulse';
            }
        }
    }

    updateMediaStatus(message) {
        const el = document.getElementById('mediaStatus');
        if (el) el.textContent = message;
    }

    updateLastAction(action) {
        const el = document.getElementById('lastAction');
        if (el) el.textContent = action;
    }

    updateRoomStatus(message) {
        const el = document.getElementById('roomStatus');
        if (el) el.textContent = message;

        const syncEl = document.getElementById('syncStatus');
        if (syncEl) syncEl.textContent = 'Active';

        // SIMPLE UPDATE: Just set the text. No toggling classes needed.
        if (state.currentRoomId) {
            const badgeCode = document.getElementById('currentRoomCode');
            // We need to find the span inside the button that holds the code
            if (badgeCode) {
                // The structure is Button > Span(Label) > Span(Code) > Span(Icon)
                // We target the 2nd span (index 1) which holds the "..." placeholder
                const codeSpan = badgeCode.querySelectorAll('span')[1];
                if (codeSpan) codeSpan.textContent = state.currentRoomId;
                else badgeCode.textContent = state.currentRoomId; // Fallback
            }
        }
    }

    updateUsersList(users) {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        usersList.innerHTML = '';

        const uniqueUsers = new Map();
        users.forEach(user => {
            const key = user.id || user.name;
            if (!uniqueUsers.has(key)) {
                uniqueUsers.set(key, user);
            } else {
                const existing = uniqueUsers.get(key);
                if (user.role && user.name && (!existing.role || !existing.name)) {
                    uniqueUsers.set(key, user);
                }
            }
        });

        const nameMap = new Map();
        const finalUsers = [];

        uniqueUsers.forEach(user => {
            const baseName = user.name.replace(/_\d+$/, '');
            if (!nameMap.has(baseName)) {
                nameMap.set(baseName, user);
                finalUsers.push(user);
            } else {
                const existing = nameMap.get(baseName);
                if (user.role === 'admin' || (!user.name.includes('_') && existing.name.includes('_'))) {
                    const index = finalUsers.findIndex(u => u === existing);
                    if (index !== -1) finalUsers[index] = user;
                    nameMap.set(baseName, user);
                }
            }
        });

        finalUsers.sort((a, b) => {
            if (a.role === 'admin' && b.role !== 'admin') return -1;
            if (a.role !== 'admin' && b.role === 'admin') return 1;
            return a.name.localeCompare(b.name);
        });

        const adminInstructions = document.getElementById('adminUserInstructions');
        if (adminInstructions) {
            adminInstructions.style.display = state.userRole === 'admin' ? 'block' : 'none';
        }

        finalUsers.forEach(user => {
            const userItem = document.createElement('div');

            let classes = 'flex items-center justify-between p-2 rounded text-xs transition border border-transparent mb-1 ';

            if (user.role === 'admin') {
                classes += 'bg-red-500/10 text-red-300 border-red-500/10 ';
            } else {
                classes += 'bg-slate-700/30 text-slate-300 ';
            }

            if (user.name === state.userName || user.id === state.socket?.id) {
                classes += 'ring-1 ring-blue-500 font-bold ';
            }

            userItem.className = classes;
            userItem.textContent = user.name + (user.role === 'admin' ? ' 👑' : '');

            if (state.userRole === 'admin' && user.name !== state.userName && user.id !== state.socket?.id) {
                userItem.classList.add('cursor-pointer', 'hover:bg-white/10');
                userItem.addEventListener('click', (e) => {
                    import('../main.js').then(({ authManager }) => {
                        authManager.showUserMenu(user.name, user.role, e);
                    });
                });
                userItem.title = 'Click to manage user';
            }

            usersList.appendChild(userItem);
        });

        const connectedCount = document.getElementById('connectedUsers');
        if (connectedCount) {
            connectedCount.textContent = `${finalUsers.length} user${finalUsers.length !== 1 ? 's' : ''}`;
        }
    }

    showError(message) {
        this.updateMediaStatus(`Error: ${message}`);
        console.error(message);
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}