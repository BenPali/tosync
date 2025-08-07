// modules/fileLibraryManager.js - File library management

import { state } from '../state.js';
import { socketManager, torrentManager, uiManager } from '../main.js';

export class FileLibraryManager {
    async loadFileLibrary() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can access the file library');
            return;
        }

        const statusElement = document.getElementById('libraryStatus');
        statusElement.textContent = 'Loading file library...';

        try {
            const response = await fetch(`/api/library/${state.currentRoomId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            state.currentLibrary = await response.json();
            this.displayFileLibrary(state.currentLibrary);
            statusElement.textContent = `Loaded ${state.currentLibrary.uploads.length} uploaded files and ${state.currentLibrary.downloads.length} downloaded files`;

        } catch (error) {
            console.error('Error loading file library:', error);
            statusElement.textContent = 'Error loading file library';
            uiManager.showError('Failed to load file library: ' + error.message);
        }
    }

    displayFileLibrary(library) {
        // Display uploaded files
        const uploadedList = document.getElementById('uploadedFilesList');
        uploadedList.innerHTML = '';

        if (library.uploads.length === 0) {
            uploadedList.innerHTML = '<div style="color: #718096; text-align: center; padding: 20px;">No uploaded files found</div>';
        } else {
            library.uploads.forEach(file => {
                const fileItem = this.createLibraryFileItem(file, 'uploaded');
                uploadedList.appendChild(fileItem);
            });
        }

        // Display downloaded files
        const downloadedList = document.getElementById('downloadedFilesList');
        downloadedList.innerHTML = '';

        if (library.downloads.length === 0) {
            downloadedList.innerHTML = '<div style="color: #718096; text-align: center; padding: 20px;">No downloaded files found</div>';
        } else {
            library.downloads.forEach(file => {
                const fileItem = this.createLibraryFileItem(file, 'downloaded');
                downloadedList.appendChild(fileItem);
            });
        }
    }

    createLibraryFileItem(file, type) {
        const fileItem = document.createElement('div');
        fileItem.className = `library-file-item ${type}`;

        const fileName = type === 'uploaded' ? file.originalName : file.originalName;
        const fileSize = uiManager.formatBytes(file.size);
        const fileDate = new Date(file.addedAt).toLocaleDateString();

        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">${fileName}</div>
                <div class="file-details">
                    <span class="file-size">${fileSize}</span>
                    <span class="file-date">${fileDate}</span>
                    ${type === 'downloaded' ? `<span style="color: #fbb6ce;">📁 ${file.folderName}</span>` : ''}
                </div>
            </div>
            <button class="play-button" onclick="playLibraryFile('${file.url}', '${fileName}')">▶️ Play</button>
        `;

        return fileItem;
    }

    playLibraryFile(fileUrl, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can play files from library');
            return;
        }

        console.log('Playing library file:', fileName, 'from:', fileUrl);

        // Clear previous event listeners
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        state.videoPlayer.src = fileUrl;
        state.videoPlayer.load();

        state.videoPlayer.onloadedmetadata = () => {
            console.log('Library file loaded successfully');
            uiManager.updateMediaStatus(`Playing: ${fileName}`);

            // Broadcast to other users
            socketManager.broadcastMediaAction('load-file', {
                fileName: fileName,
                fileSize: 0, // We don't have size info in this context
                url: fileUrl
            });
        };

        state.videoPlayer.onerror = (e) => {
            console.error('Library file error:', e);
            uiManager.showError('Failed to load library file');
        };

        // Clear torrent info since we're playing a file
        state.currentTorrentInfo = null;
        torrentManager.clearTorrentProgress();
        document.getElementById('torrentInfo').classList.add('hidden');
    }
}