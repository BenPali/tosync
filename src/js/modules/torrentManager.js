import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, subtitleManager, uiManager } from '../main.js';

export class TorrentManager {
    async loadTorrent() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can load torrents');
            return;
        }

        const torrentInput = document.getElementById('torrentInput');
        if (!torrentInput) return;

        const magnet = torrentInput.value.trim();

        if (!magnet) {
            uiManager.showError('Please enter a magnet link');
            return;
        }

        if (!magnet.startsWith('magnet:')) {
            uiManager.showError('Please enter a valid magnet link');
            return;
        }

        uiManager.updateMediaStatus('🧲 Processing magnet link...');

        try {
            const response = await fetch('/api/torrents/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ magnetLink: magnet, roomId: state.currentRoomId })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add torrent');
            }

            const torrentData = await response.json();
            state.currentTorrentInfo = torrentData;

            const nameEl = document.getElementById('torrentName');
            if (nameEl) nameEl.textContent = torrentData.name;

            const sizeEl = document.getElementById('torrentSize');
            if (sizeEl) sizeEl.textContent = uiManager.formatBytes(torrentData.totalLength);

            if (state.userRole === 'admin') {
                const infoBox = document.getElementById('torrentInfo');
                if (infoBox) infoBox.classList.remove('hidden');
                this.displayTorrentFiles(torrentData.files);
            }

            if (torrentData.files.length > 0) {
                const firstFile = torrentData.files[0];
                this.playTorrentFile(torrentData.infoHash, firstFile.index, firstFile.name);
            }

            this.updateTorrentProgressFromServer();

        } catch (error) {
            uiManager.showError('Failed to add torrent: ' + error.message);
            console.error('Torrent load error:', error);
        }
    }

    playTorrentFile(infoHash, fileIndex, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can select files');
            return;
        }

        const socketId = state.socket ? state.socket.id : '';
        const streamUrl = `/api/torrents/${infoHash}/files/${fileIndex}/stream?socketId=${socketId}`;

        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        state.videoPlayer.src = streamUrl;
        state.videoPlayer.load();

        state.videoPlayer.onloadedmetadata = () => {
            uiManager.updateMediaStatus(`Streaming: ${fileName}`);

            socketManager.broadcastMediaAction('load-torrent', {
                name: state.currentTorrentInfo.name,
                infoHash: infoHash,
                fileIndex: fileIndex,
                fileName: fileName,
                streamUrl: streamUrl,
                size: state.currentTorrentInfo.totalLength
            });

            if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                setTimeout(() => {
                    subtitleManager.selectSubtitle(state.selectedSubtitleId);
                }, 100);
            }
        };

        state.videoPlayer.onerror = (e) => {
            console.error('Video streaming error:', e);
            uiManager.showError('Failed to stream video. The torrent might still be downloading.');
        };
    }

    displayTorrentFiles(files) {
        const fileList = document.getElementById('fileList');
        if (!fileList) return;

        fileList.innerHTML = '<h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Available Files</h4>';

        if (files.length === 0) {
            fileList.innerHTML += '<p class="text-xs text-slate-600 italic">No video files found.</p>';
            return;
        }

        files.forEach((file) => {
            const fileItem = document.createElement('div');
            let classes = 'flex justify-between items-center p-2 border-b border-white/5 hover:bg-white/5 transition text-xs text-slate-300 ';

            if (state.userRole === 'guest') {
                classes += 'opacity-50 cursor-not-allowed ';
            } else {
                classes += 'cursor-pointer ';
            }

            fileItem.className = classes;

            fileItem.innerHTML = `
                <span class="truncate mr-2">${file.name}</span>
                <span class="text-slate-500 whitespace-nowrap">${uiManager.formatBytes(file.length)}</span>
            `;

            if (state.userRole === 'admin') {
                fileItem.onclick = () => this.playTorrentFile(state.currentTorrentInfo.infoHash, file.index, file.name);
            } else {
                fileItem.title = 'Only admins can select files';
            }

            fileList.appendChild(fileItem);
        });
    }

    async updateTorrentProgressFromServer() {
        if (!state.currentTorrentInfo || !state.currentTorrentInfo.infoHash) return;

        this.clearTorrentProgress();

        const updateProgress = async () => {
            try {
                const response = await fetch(`/api/torrents/${state.currentTorrentInfo.infoHash}/status`, { credentials: 'include' });
                if (!response.ok) return;

                const status = await response.json();
                this.updateTorrentProgressUI(status);

                if (state.userRole === 'admin' && state.socket && state.isConnected) {
                    state.socket.emit('torrent-status', status);
                }
            } catch (error) {
                console.error('Error fetching torrent status:', error);
            }
        };

        updateProgress();
        state.torrentProgressInterval = setInterval(updateProgress, config.TORRENT_UPDATE_INTERVAL);
    }

    updateTorrentProgressUI(status) {
        const progress = Math.round(status.progress * 100);

        const fill = document.getElementById('progressFill');
        if (fill) fill.style.width = progress + '%';

        const dl = document.getElementById('downloaded');
        if (dl) dl.textContent = uiManager.formatBytes(status.downloaded);

        const spd = document.getElementById('downloadSpeed');
        if (spd) spd.textContent = uiManager.formatBytes(status.downloadSpeed) + '/s';

        const peers = document.getElementById('numPeers');
        if (peers) peers.textContent = `${status.numPeers}`;

        if (status.numPeers === 0 && progress < 100) {
            uiManager.updateMediaStatus(`🔍 Searching for peers... (${progress}%)`);
        } else if (progress < 100) {
            uiManager.updateMediaStatus(`⬇️ Downloading: ${status.name} (${progress}%, ${uiManager.formatBytes(status.downloadSpeed)}/s)`);
        } else {
            uiManager.updateMediaStatus(`✅ Complete: ${status.name} (Seeding to ${status.numPeers})`);
        }
    }

    clearTorrentProgress() {
        if (state.torrentProgressInterval) {
            clearInterval(state.torrentProgressInterval);
            state.torrentProgressInterval = null;
        }
        const fill = document.getElementById('progressFill');
        if (fill) fill.style.width = '0%';
    }

    restoreTorrentMedia(mediaData, videoState) {
        state.currentTorrentInfo = mediaData.data;

        if (state.currentTorrentInfo.streamUrl) {
            state.videoPlayer.onloadedmetadata = null;
            state.videoPlayer.onerror = null;

            let url = state.currentTorrentInfo.streamUrl;
            if (url.includes('?socketId=')) {
                url = url.split('?')[0];
            }
            const socketId = state.socket ? state.socket.id : '';
            state.videoPlayer.src = `${url}?socketId=${socketId}`;

            state.videoPlayer.currentTime = videoState.currentTime || 0;
            state.videoPlayer.playbackRate = videoState.playbackRate || 1;

            state.videoPlayer.onloadedmetadata = () => {
                uiManager.updateMediaStatus(`Watching: ${state.currentTorrentInfo.name}`);

                if (videoState.isPlaying) {
                    state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                }
            };

            state.videoPlayer.load();

            const nameEl = document.getElementById('torrentName');
            if (nameEl) nameEl.textContent = state.currentTorrentInfo.name;

            const sizeEl = document.getElementById('torrentSize');
            if (sizeEl) sizeEl.textContent = uiManager.formatBytes(state.currentTorrentInfo.size || 0);

            if (state.userRole === 'admin') {
                const info = document.getElementById('torrentInfo');
                if (info) {
                    info.classList.remove('hidden');
                    this.updateTorrentProgressFromServer();
                }
            }
        }
    }
}