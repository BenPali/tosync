import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, subtitleManager, uiManager } from '../main.js';
import { checkCodecSupport, fetchCodecs, buildHlsUrl, startHlsPlayback, destroyHls } from './codecUtils.js';

function buildEpisodeLabel(file) {
    if (file.episode == null) return file.name.replace(/\.[^.]+$/, '');
    const ep = String(file.episode).padStart(2, '0');
    const prefix = file.season != null ? `S${String(file.season).padStart(2, '0')}E${ep}` : `E${ep}`;
    return file.title ? `${prefix} - ${file.title}` : prefix;
}

export class TorrentManager {
    constructor() {
        this._playingFileIndex = null;
        this._lastFilesStatus = null;
    }

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

        uiManager.updateMediaStatus('Processing magnet link...');

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

            if (torrentData.files.length === 1) {
                const firstFile = torrentData.files[0];
                this.playTorrentFile(torrentData.infoHash, firstFile.index, firstFile.name);
            } else if (torrentData.files.length > 1) {
                uiManager.updateMediaStatus(`${torrentData.files.length} files found`);
            }

            this.updateTorrentProgressFromServer();

        } catch (error) {
            uiManager.showError('Failed to add torrent: ' + error.message);
            console.error('Torrent load error:', error);
        }
    }

    async playTorrentFile(infoHash, fileIndex, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can select files');
            return;
        }

        this._playingFileIndex = fileIndex;
        this._selectFile(fileIndex);

        destroyHls();
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        // Check codec compatibility
        const socketId = state.socket ? state.socket.id : '';
        uiManager.updateMediaStatus(`Analyzing codecs...`);

        const codecs = await fetchCodecs({
            source: 'torrent', infoHash, fileIndex, socketId
        });

        const needs = codecs ? checkCodecSupport(codecs) : null;

        if (needs) {
            // Needs transcoding — use HLS
            const hlsUrl = buildHlsUrl({ source: 'torrent', infoHash, fileIndex }, needs);
            const transcodingWhat = needs === 'both' ? 'video & audio' : needs;
            uiManager.updateMediaStatus(`Transcoding ${transcodingWhat}...`);

            if (!startHlsPlayback(hlsUrl)) {
                uiManager.showError('HLS.js is not available for transcoding');
                return;
            }

            state.videoPlayer.onloadedmetadata = () => {
                uiManager.updateMediaStatus(`Streaming: ${fileName} (transcoded)`);
            };
        } else {
            // Compatible — raw stream
            const streamUrl = `/api/torrents/${infoHash}/files/${fileIndex}/stream?socketId=${socketId}`;
            state.videoPlayer.src = streamUrl;
            state.videoPlayer.load();

            state.videoPlayer.onloadedmetadata = () => {
                uiManager.updateMediaStatus(`Streaming: ${fileName}`);
            };
        }

        state.videoPlayer.onerror = (e) => {
            console.error('Video streaming error:', e);
            uiManager.showError('Failed to stream video. The torrent might still be downloading.');
        };

        // Broadcast to other clients — include codecs so they can check independently
        state.videoPlayer.addEventListener('loadedmetadata', () => {
            socketManager.broadcastMediaAction('load-torrent', {
                name: state.currentTorrentInfo.name,
                infoHash: infoHash,
                fileIndex: fileIndex,
                fileName: fileName,
                size: state.currentTorrentInfo.totalLength,
                codecs: codecs
            });

            if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                setTimeout(() => {
                    subtitleManager.selectSubtitle(state.selectedSubtitleId);
                }, 100);
            }
        }, { once: true });
    }

    // -- File picker UI --

    displayTorrentFiles(files) {
        const fileList = document.getElementById('fileList');
        if (!fileList) return;
        fileList.innerHTML = '';

        if (files.length === 0) {
            fileList.innerHTML = '<p class="text-xs text-slate-600 italic">No video files found.</p>';
            return;
        }

        const isAdmin = state.userRole === 'admin';
        const hasSeason = files.some(f => f.season != null);

        if (hasSeason) {
            const seasons = new Map();
            for (const f of files) {
                const s = f.season ?? 0;
                if (!seasons.has(s)) seasons.set(s, []);
                seasons.get(s).push(f);
            }
            const sorted = [...seasons.entries()].sort((a, b) => a[0] - b[0]);
            for (const [season, items] of sorted) {
                items.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
                const details = document.createElement('details');
                details.className = 'group';
                if (sorted.length === 1) details.open = true;

                const summary = document.createElement('summary');
                summary.className = 'cursor-pointer text-xs font-bold text-slate-400 hover:text-white flex justify-between items-center p-2 select-none';
                summary.innerHTML = `<span>${season === 0 ? 'Other Files' : `Season ${season}`}</span><span class="text-slate-600 text-[10px]">${items.length} ep</span>`;
                details.appendChild(summary);

                const list = document.createElement('div');
                list.className = 'space-y-0.5 pb-1';
                for (const f of items) list.appendChild(this._createFileRow(f, isAdmin));
                details.appendChild(list);
                fileList.appendChild(details);
            }
        } else {
            const sorted = [...files].sort((a, b) => {
                if (a.episode != null && b.episode != null) return a.episode - b.episode;
                if (a.episode != null) return -1;
                if (b.episode != null) return 1;
                return a.name.localeCompare(b.name);
            });
            for (const f of sorted) fileList.appendChild(this._createFileRow(f, isAdmin));
        }
    }

    _createFileRow(file, isAdmin) {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 p-2 rounded hover:bg-white/5 transition text-xs group';
        row.dataset.fileIndex = file.index;

        const label = document.createElement('span');
        label.className = 'truncate flex-1 text-slate-300 min-w-0';
        label.textContent = buildEpisodeLabel(file);
        label.title = file.name;

        const size = document.createElement('span');
        size.className = 'text-slate-600 whitespace-nowrap text-[10px] shrink-0';
        size.textContent = uiManager.formatBytes(file.length);

        const progressWrap = document.createElement('div');
        progressWrap.className = 'hidden w-16 h-1 bg-slate-700 rounded overflow-hidden shrink-0';
        progressWrap.dataset.role = 'progress-wrap';
        const progressBar = document.createElement('div');
        progressBar.className = 'h-full bg-emerald-500 transition-all duration-300';
        progressBar.style.width = '0%';
        progressBar.dataset.role = 'progress-bar';
        progressWrap.appendChild(progressBar);

        const statusText = document.createElement('span');
        statusText.className = 'hidden text-[10px] whitespace-nowrap shrink-0';
        statusText.dataset.role = 'status';

        const buttons = document.createElement('div');
        buttons.className = 'flex gap-1 shrink-0';

        if (isAdmin) {
            const dlBtn = document.createElement('button');
            dlBtn.className = 'px-2 py-0.5 rounded text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 transition';
            dlBtn.textContent = 'DL';
            dlBtn.title = 'Download without playing';
            dlBtn.dataset.role = 'dl-btn';
            dlBtn.onclick = (e) => { e.stopPropagation(); this._selectFile(file.index); };

            const playBtn = document.createElement('button');
            playBtn.className = 'px-2 py-0.5 rounded text-[10px] bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-400 transition';
            playBtn.textContent = 'Play';
            playBtn.dataset.role = 'play-btn';
            playBtn.onclick = (e) => { e.stopPropagation(); this.playTorrentFile(state.currentTorrentInfo.infoHash, file.index, file.name); };

            const stopBtn = document.createElement('button');
            stopBtn.className = 'hidden px-2 py-0.5 rounded text-[10px] bg-red-600/30 hover:bg-red-600/50 text-red-400 transition';
            stopBtn.textContent = 'Stop';
            stopBtn.dataset.role = 'stop-btn';
            stopBtn.onclick = (e) => { e.stopPropagation(); this._deselectFile(file.index); };

            buttons.appendChild(dlBtn);
            buttons.appendChild(playBtn);
            buttons.appendChild(stopBtn);
        } else {
            const badge = document.createElement('span');
            badge.className = 'text-[10px] text-slate-600';
            badge.textContent = 'view only';
            buttons.appendChild(badge);
        }

        row.appendChild(label);
        row.appendChild(size);
        row.appendChild(progressWrap);
        row.appendChild(statusText);
        row.appendChild(buttons);
        return row;
    }

    // -- File download controls --

    async _selectFile(fileIndex) {
        if (!state.currentTorrentInfo) return;
        // Instant feedback: mark as selected in cached status
        if (this._lastFilesStatus) {
            const f = this._lastFilesStatus.find(f => f.index === fileIndex);
            if (f) f.selected = true;
        }
        this._updateFileRowStates();
        try {
            await fetch(`/api/torrents/${state.currentTorrentInfo.infoHash}/files/${fileIndex}/select`, {
                method: 'POST', credentials: 'include'
            });
        } catch (e) {
            console.error('Failed to select file:', e);
        }
    }

    async _deselectFile(fileIndex) {
        if (!state.currentTorrentInfo) return;
        // Instant feedback: mark as deselected in cached status
        if (this._lastFilesStatus) {
            const f = this._lastFilesStatus.find(f => f.index === fileIndex);
            if (f) f.selected = false;
        }
        try {
            await fetch(`/api/torrents/${state.currentTorrentInfo.infoHash}/files/${fileIndex}/deselect`, {
                method: 'POST', credentials: 'include'
            });
            if (this._playingFileIndex === fileIndex) {
                this._playingFileIndex = null;
                state.videoPlayer.src = '';
                state.videoPlayer.load();
                uiManager.updateMediaStatus('Playback stopped');
            }
        } catch (e) {
            console.error('Failed to deselect file:', e);
        }
        this._updateFileRowStates();
    }

    async removeTorrent() {
        if (state.userRole !== 'admin' || !state.currentTorrentInfo) return;
        try {
            await fetch(`/api/torrents/${state.currentTorrentInfo.infoHash}`, {
                method: 'DELETE', credentials: 'include'
            });
            this._playingFileIndex = null;
            this._lastFilesStatus = null;
            this.clearTorrentProgress();
            state.currentTorrentInfo = null;
            state.videoPlayer.src = '';
            state.videoPlayer.load();

            socketManager.broadcastMediaAction('clear-media', {});

            const infoBox = document.getElementById('torrentInfo');
            if (infoBox) infoBox.classList.add('hidden');

            uiManager.updateMediaStatus('Torrent removed');
        } catch (e) {
            console.error('Failed to remove torrent:', e);
            uiManager.showError('Failed to remove torrent');
        }
    }

    // -- Progress tracking --

    _updateFileRowStates(filesStatus) {
        if (filesStatus) this._lastFilesStatus = filesStatus;
        const status = filesStatus || this._lastFilesStatus;

        const fileList = document.getElementById('fileList');
        if (!fileList) return;

        // Build lookup map once instead of .find() per row
        const statusMap = new Map();
        if (status) for (const f of status) statusMap.set(f.index, f);

        const rows = fileList.querySelectorAll('[data-file-index]');
        for (const row of rows) {
            const idx = parseInt(row.dataset.fileIndex);
            const fs = statusMap.get(idx);
            const progress = fs ? fs.progress : 0;
            const done = fs ? fs.done : false;
            const isSelected = fs ? !!fs.selected : false;
            const isDownloading = isSelected && !done;
            const isPlaying = this._playingFileIndex === idx;

            // Highlight playing row
            const label = row.querySelector('.truncate');
            if (label) {
                label.className = isPlaying
                    ? 'truncate flex-1 text-emerald-400 font-bold min-w-0'
                    : 'truncate flex-1 text-slate-300 min-w-0';
            }

            // Progress bar
            const progressWrap = row.querySelector('[data-role="progress-wrap"]');
            const progressBar = row.querySelector('[data-role="progress-bar"]');
            if (progressWrap && progressBar) {
                progressWrap.classList.toggle('hidden', !isDownloading);
                if (isDownloading) progressBar.style.width = Math.round(progress * 100) + '%';
            }

            // Status text
            const statusEl = row.querySelector('[data-role="status"]');
            if (statusEl) {
                if (done) {
                    statusEl.classList.remove('hidden');
                    statusEl.className = 'text-[10px] whitespace-nowrap shrink-0 text-emerald-500';
                    statusEl.textContent = 'done';
                } else if (isDownloading) {
                    statusEl.classList.remove('hidden');
                    statusEl.className = 'text-[10px] whitespace-nowrap shrink-0 text-amber-400';
                    statusEl.textContent = Math.round(progress * 100) + '%';
                } else {
                    statusEl.classList.add('hidden');
                }
            }

            // Button visibility: Play always visible (hidden only if playing), DL always visible, Stop when active
            const dlBtn = row.querySelector('[data-role="dl-btn"]');
            const playBtn = row.querySelector('[data-role="play-btn"]');
            const stopBtn = row.querySelector('[data-role="stop-btn"]');
            if (dlBtn && playBtn && stopBtn) {
                playBtn.classList.toggle('hidden', isPlaying);
                dlBtn.classList.toggle('hidden', isPlaying || isDownloading || done);
                stopBtn.classList.toggle('hidden', !isPlaying && !isDownloading);
            }
        }
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
                this._updateFileRowStates(status.files);

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
        state.isLiveStream = false;
        state.currentTorrentInfo = mediaData.data;
        const info = state.currentTorrentInfo;

        if (info.infoHash === undefined || info.fileIndex === undefined) return;

        destroyHls();
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        // Check codec support — use codecs from broadcast if available
        const codecs = info.codecs || null;
        const needs = codecs ? checkCodecSupport(codecs) : null;
        const socketId = state.socket ? state.socket.id : '';

        if (needs) {
            const hlsUrl = buildHlsUrl({ source: 'torrent', infoHash: info.infoHash, fileIndex: info.fileIndex }, needs);
            startHlsPlayback(hlsUrl);
        } else {
            state.videoPlayer.src = `/api/torrents/${info.infoHash}/files/${info.fileIndex}/stream?socketId=${socketId}`;
        }

        state.videoPlayer.currentTime = videoState.currentTime || 0;
        state.videoPlayer.playbackRate = videoState.playbackRate || 1;

        state.videoPlayer.onloadedmetadata = () => {
            const suffix = needs ? ' (transcoded)' : '';
            uiManager.updateMediaStatus(`Watching: ${info.name}${suffix}`);

            if (videoState.isPlaying) {
                state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            }
        };

        if (!needs) state.videoPlayer.load();

        const nameEl = document.getElementById('torrentName');
        if (nameEl) nameEl.textContent = info.name;

        const sizeEl = document.getElementById('torrentSize');
        if (sizeEl) sizeEl.textContent = uiManager.formatBytes(info.size || 0);

        if (state.userRole === 'admin') {
            const torrentInfo = document.getElementById('torrentInfo');
            if (torrentInfo) {
                torrentInfo.classList.remove('hidden');
                this.updateTorrentProgressFromServer();
            }
        }
    }
}
