// modules/uiManager.js - UI state management and updates

import { state } from '../state.js';

export class UIManager {
    initialize() {
        // Any UI initialization code here
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

        users.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = `user-item ${user.role}`;
            userItem.textContent = user.name;
            usersList.appendChild(userItem);
        });

        document.getElementById('connectedUsers').textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;
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