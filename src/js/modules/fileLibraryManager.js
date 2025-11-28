import { state } from '../state.js';
import { socketManager, torrentManager, uiManager } from '../main.js';

export class FileLibraryManager {
    async loadFileLibrary() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can access the file library');
            return;
        }

        const statusElement = document.getElementById('libraryStatus');
        if (statusElement) statusElement.textContent = 'Loading file library...';

        try {
            const response = await fetch(`/api/library/${state.currentRoomId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            state.currentLibrary = await response.json();
            this.displayFileLibrary(state.currentLibrary);

            if (statusElement) {
                statusElement.textContent = `Loaded ${state.currentLibrary.uploads.length} uploaded files and ${state.currentLibrary.downloads.length} downloaded files`;
            }

        } catch (error) {
            console.error('Error loading file library:', error);
            if (statusElement) statusElement.textContent = 'Error loading file library';
            uiManager.showError('Failed to load file library: ' + error.message);
        }
    }

    displayFileLibrary(library) {
        const uploadedList = document.getElementById('uploadedFilesList');
        if (uploadedList) {
            uploadedList.innerHTML = '';
            if (library.uploads.length === 0) {
                uploadedList.innerHTML = '<div class="text-slate-500 text-center py-2 italic text-xs">No uploaded files</div>';
            } else {
                library.uploads.forEach(file => {
                    const fileItem = this.createLibraryFileItem(file, 'uploaded');
                    uploadedList.appendChild(fileItem);
                });
            }
        }

        const downloadedList = document.getElementById('downloadedFilesList');
        if (downloadedList) {
            downloadedList.innerHTML = '';
            if (library.downloads.length === 0) {
                downloadedList.innerHTML = '<div class="text-slate-500 text-center py-2 italic text-xs">No downloaded files</div>';
            } else {
                library.downloads.forEach(file => {
                    const fileItem = this.createLibraryFileItem(file, 'downloaded');
                    downloadedList.appendChild(fileItem);
                });
            }
        }
    }

    createLibraryFileItem(file, type) {
        const fileItem = document.createElement('div');
        fileItem.className = `library-file-item ${type} flex justify-between items-center p-2 mb-1 rounded text-xs cursor-pointer text-slate-300`;

        const fileName = file.originalName;
        const fileSize = uiManager.formatBytes(file.size);
        const fileDate = new Date(file.addedAt).toLocaleDateString();

        fileItem.innerHTML = `
            <div class="flex-1 min-w-0 mr-2">
                <div class="font-medium truncate text-white" title="${fileName}">${fileName}</div>
                <div class="flex gap-2 text-[10px] text-slate-500">
                    <span class="text-emerald-500">${fileSize}</span>
                    <span>${fileDate}</span>
                    ${type === 'downloaded' ? `<span class="text-blue-400">📁 ${file.folderName}</span>` : ''}
                </div>
            </div>
            <button class="bg-primary/20 hover:bg-primary/40 text-primary px-2 py-1 rounded transition text-[10px] uppercase font-bold" onclick="playLibraryFile('${file.url}', '${fileName}')">Play</button>
        `;

        return fileItem;
    }

    playLibraryFile(fileUrl, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can play files from library');
            return;
        }

        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        state.videoPlayer.src = fileUrl;
        state.videoPlayer.load();

        state.videoPlayer.onloadedmetadata = () => {
            uiManager.updateMediaStatus(`Playing: ${fileName}`);
            socketManager.broadcastMediaAction('load-file', {
                fileName: fileName,
                fileSize: 0,
                url: fileUrl
            });
        };

        state.videoPlayer.onerror = (e) => {
            console.error('Library file error:', e);
            uiManager.showError('Failed to load library file');
        };

        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
            const torrentInfo = document.getElementById('torrentInfo');
            if (torrentInfo) {
                torrentInfo.classList.add('hidden');
            }
        }
    }
}