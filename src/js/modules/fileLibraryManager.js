import { state } from '../state.js';
import { socketManager, torrentManager, uiManager } from '../main.js';
import { checkCodecSupport, fetchCodecs, buildHlsUrl, startHlsPlayback, destroyHls } from './codecUtils.js';

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
        const emptyMsg = (text) => {
            const el = document.createElement('div');
            el.className = 'text-neutral-500 text-center py-2 italic text-xs';
            el.textContent = text;
            return el;
        };

        const uploadedList = document.getElementById('uploadedFilesList');
        if (uploadedList) {
            uploadedList.innerHTML = '';
            if (library.uploads.length === 0) {
                uploadedList.appendChild(emptyMsg('No uploaded files'));
            } else {
                library.uploads.forEach(file => {
                    uploadedList.appendChild(this.createLibraryFileItem(file, 'uploaded'));
                });
            }
        }

        const downloadedList = document.getElementById('downloadedFilesList');
        if (downloadedList) {
            downloadedList.innerHTML = '';
            if (library.downloads.length === 0) {
                downloadedList.appendChild(emptyMsg('No downloaded files'));
            } else {
                library.downloads.forEach(file => {
                    downloadedList.appendChild(this.createLibraryFileItem(file, 'downloaded'));
                });
            }
        }

        const status = document.getElementById('libraryStatus');
        if (status) {
            const total = (library.uploads?.length || 0) + (library.downloads?.length || 0);
            status.textContent = total === 0 ? 'empty' : `${total} file${total !== 1 ? 's' : ''}`;
        }
    }

    createLibraryFileItem(file, type) {
        const fileItem = document.createElement('div');
        fileItem.className = 'flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100/[0.02] transition cursor-pointer';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'flex-1 min-w-0';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'text-sm truncate text-neutral-100';
        nameDiv.textContent = file.originalName;
        nameDiv.title = file.originalName;
        infoDiv.appendChild(nameDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'flex items-center gap-2 text-xs text-neutral-500 font-mono';

        const sizeSpan = document.createElement('span');
        sizeSpan.textContent = uiManager.formatBytes(file.size);
        metaDiv.appendChild(sizeSpan);

        const sep1 = document.createElement('span');
        sep1.className = 'text-neutral-700';
        sep1.textContent = '·';
        metaDiv.appendChild(sep1);

        const typeSpan = document.createElement('span');
        typeSpan.textContent = type === 'uploaded' ? 'uploaded' : 'downloaded';
        metaDiv.appendChild(typeSpan);

        const sep2 = document.createElement('span');
        sep2.className = 'text-neutral-700';
        sep2.textContent = '·';
        metaDiv.appendChild(sep2);

        const dateSpan = document.createElement('span');
        dateSpan.textContent = new Date(file.addedAt).toLocaleDateString();
        metaDiv.appendChild(dateSpan);

        if (type === 'downloaded' && file.folderName) {
            const sep3 = document.createElement('span');
            sep3.className = 'text-neutral-700';
            sep3.textContent = '·';
            metaDiv.appendChild(sep3);
            const folderSpan = document.createElement('span');
            folderSpan.className = 'text-blue-400 truncate';
            folderSpan.textContent = file.folderName;
            metaDiv.appendChild(folderSpan);
        }

        infoDiv.appendChild(metaDiv);

        const playBtn = document.createElement('button');
        playBtn.className = 'text-xs text-primary hover:text-red-300 transition';
        playBtn.textContent = 'Play';
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.playLibraryFile(file.url, file.originalName);
        });

        fileItem.append(infoDiv, playBtn);
        return fileItem;
    }

    async playLibraryFile(fileUrl, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can play files from library');
            return;
        }

        destroyHls();
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        // Extract roomId and filename from URL: /rooms/:roomId/videos/:filename
        const urlParts = fileUrl.split('/');
        const roomId = urlParts[2];
        const filename = urlParts[4];

        // Check codec compatibility
        uiManager.updateMediaStatus(`Analyzing codecs...`);

        const codecs = await fetchCodecs({
            source: 'upload', roomId, filename
        });
        const needs = codecs ? checkCodecSupport(codecs) : null;

        if (needs) {
            const hlsUrl = buildHlsUrl({ source: 'upload', roomId, filename }, needs);
            const transcodingWhat = needs === 'both' ? 'video & audio' : needs;
            uiManager.updateMediaStatus(`Transcoding ${transcodingWhat}...`);
            startHlsPlayback(hlsUrl);
        } else {
            state.videoPlayer.src = fileUrl;
            state.videoPlayer.load();
        }

        state.videoPlayer.onloadedmetadata = () => {
            const suffix = needs ? ' (transcoded)' : '';
            uiManager.updateMediaStatus(`Playing: ${fileName}${suffix}`);
            socketManager.broadcastMediaAction('load-file', {
                fileName: fileName,
                fileSize: 0,
                url: fileUrl,
                filename: filename,
                codecs: codecs
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