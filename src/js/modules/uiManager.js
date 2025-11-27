// modules/uiManager.js - UI state management and updates

import { state } from '../state.js';

export class UIManager {
    initialize() {
        // Add user management styles
        const userManagementStyles = `
            <style>
            .user-management-menu {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 8px 0;
                min-width: 120px;
            }

            .user-menu-btn {
                width: 100%;
                border: none;
                background: none;
                padding: 8px 16px;
                text-align: left;
                cursor: pointer;
                font-size: 0.9rem;
                transition: background-color 0.2s;
            }

            .user-menu-btn:hover {
                background: #f7fafc;
            }

            .user-menu-btn.make-admin {
                color: #2b6cb0;
            }

            .user-menu-btn.kick-user {
                color: #e53e3e;
            }

            .user-item {
                cursor: pointer;
                transition: background-color 0.2s;
                position: relative;
            }

            .user-item:hover {
                background: #f0f0f0;
            }

            .user-item.admin {
                background: #fed7d7;
                color: #c53030;
            }

            .user-item.admin:hover {
                background: #fbb6ce;
            }

            .user-item.current-user {
                font-weight: bold;
                border: 2px solid #4299e1;
            }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', userManagementStyles);
    }

    updateConnectionStatus(message, status) {
        const statusElement = document.getElementById('connectionStatus');
        statusElement.textContent = message;
        statusElement.className = `connection-status ${status}`;
    }

    updateMediaStatus(message) {
        document.getElementById('mediaStatus').textContent = message;
    }

    updateLastAction(action) {
        document.getElementById('lastAction').textContent = action;
    }

    updateRoomStatus(message) {
        document.getElementById('roomStatus').textContent = message;
        document.getElementById('syncStatus').textContent = 'Active';
    }

    updateUsersList(users) {
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';

        // More robust deduplication - use socket ID as primary key, name as fallback
        const uniqueUsers = new Map();

        users.forEach(user => {
            // Use socket ID as the primary unique identifier
            const key = user.id || user.name;

            // Always keep the most recent version of the user
            if (!uniqueUsers.has(key)) {
                uniqueUsers.set(key, user);
            } else {
                // If we have a duplicate, keep the one with the most recent data
                const existing = uniqueUsers.get(key);
                // Prefer the user object that has more complete information
                if (user.role && user.name && (!existing.role || !existing.name)) {
                    uniqueUsers.set(key, user);
                }
            }
        });

        // Additional cleanup: remove users with duplicate names but keep the admin version
        const nameMap = new Map();
        const finalUsers = [];

        uniqueUsers.forEach(user => {
            const baseName = user.name.replace(/_\d+$/, ''); // Remove _123 suffix

            if (!nameMap.has(baseName)) {
                nameMap.set(baseName, user);
                finalUsers.push(user);
            } else {
                const existing = nameMap.get(baseName);
                // Keep the admin version, or the one without number suffix
                if (user.role === 'admin' || (!user.name.includes('_') && existing.name.includes('_'))) {
                    // Replace the existing one
                    const index = finalUsers.findIndex(u => u === existing);
                    if (index !== -1) {
                        finalUsers[index] = user;
                    }
                    nameMap.set(baseName, user);
                }
                // Otherwise, skip this duplicate
            }
        });

        // Sort users (admins first, then by name)
        finalUsers.sort((a, b) => {
            if (a.role === 'admin' && b.role !== 'admin') return -1;
            if (a.role !== 'admin' && b.role === 'admin') return 1;
            return a.name.localeCompare(b.name);
        });

        // Show admin instructions if current user is admin
        const adminInstructions = document.getElementById('adminUserInstructions');
        if (adminInstructions) {
            adminInstructions.style.display = state.userRole === 'admin' ? 'block' : 'none';
        }

        finalUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = `user-item ${user.role}`;

            // Add current user indicator
            if (user.name === state.userName || user.id === state.socket?.id) {
                userItem.classList.add('current-user');
            }

            userItem.textContent = user.name;

            // Add click handler for admin user management
            if (state.userRole === 'admin' && user.name !== state.userName && user.id !== state.socket?.id) {
                userItem.addEventListener('click', (e) => {
                    import('../main.js').then(({ authManager }) => {
                        authManager.showUserMenu(user.name, user.role, e);
                    });
                });
                userItem.title = 'Click to manage user';
                userItem.style.cursor = 'pointer';
            }

            usersList.appendChild(userItem);
        });

        document.getElementById('connectedUsers').textContent = `${finalUsers.length} user${finalUsers.length !== 1 ? 's' : ''}`;
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