// modules/iptvManager.js - IPTV playlist browser

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class IptvManager {

    constructor() {
        this.currentPlaylist = null;
    }

    async loadPlaylist() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can load playlists');
            return;
        }

        const input = document.getElementById('iptvPlaylistInput');
        const playlistUrl = input?.value.trim();

        if (!playlistUrl) {
            uiManager.showError('Please enter a playlist URL');
            return;
        }

        if (!playlistUrl.startsWith('http://') && !playlistUrl.startsWith('https://')) {
            uiManager.showError('Invalid URL format');
            return;
        }

        const loadBtn = document.getElementById('loadPlaylistBtn');
        if (loadBtn) {
            loadBtn.disabled = true;
            loadBtn.textContent = 'Loading...';
        }

        uiManager.updateMediaStatus('Loading IPTV playlist...');

        try {
            const response = await fetch('/api/stream/parse-playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    playlistUrl: playlistUrl,
                    roomId: state.currentRoomId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            this.currentPlaylist = data;

            uiManager.updateMediaStatus(`Loaded ${data.channelCount} channels`);
            this.displayChannelBrowser(data.groups);

        } catch (err) {
            console.error('Playlist load error:', err);
            uiManager.showError('Failed to load playlist: ' + err.message);
        } finally {
            if (loadBtn) {
                loadBtn.disabled = false;
                loadBtn.textContent = 'Load Playlist';
            }
        }
    }

    displayChannelBrowser(groups) {
        const browser = document.getElementById('iptvBrowser');
        if (!browser) return;

        browser.innerHTML = '';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search channels...';
        searchInput.className = 'w-full bg-dark border border-slate-700 rounded px-2 py-1 text-xs mb-2 text-slate-300 focus:ring-1 focus:ring-amber-500 outline-none';
        searchInput.addEventListener('input', (e) => this.filterChannels(e.target.value));
        browser.appendChild(searchInput);

        const container = document.createElement('div');
        container.id = 'iptvGroupsContainer';
        container.className = 'max-h-64 overflow-y-auto space-y-1';

        groups.forEach(group => {
            const groupEl = document.createElement('details');
            groupEl.className = 'group';
            groupEl.dataset.groupName = group.name.toLowerCase();

            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer text-xs text-slate-400 hover:text-white flex justify-between items-center p-1.5 bg-slate-800/50 rounded';
            summary.innerHTML = `<span>${this.escapeHtml(group.name)}</span><span class="text-slate-600">${group.channels.length}</span>`;
            groupEl.appendChild(summary);

            const channelList = document.createElement('div');
            channelList.className = 'pl-2 space-y-0.5 mt-1';

            group.channels.forEach(channel => {
                const chEl = document.createElement('div');
                chEl.className = 'flex items-center p-1.5 text-xs text-slate-300 hover:bg-white/5 rounded cursor-pointer transition';
                chEl.dataset.channelName = channel.name.toLowerCase();
                chEl.dataset.channelIndex = channel.index;
                chEl.textContent = channel.name;
                chEl.addEventListener('click', () => this.selectChannel(channel.index, channel.name));
                channelList.appendChild(chEl);
            });

            groupEl.appendChild(channelList);
            container.appendChild(groupEl);
        });

        browser.appendChild(container);
        browser.classList.remove('hidden');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    filterChannels(query) {
        const container = document.getElementById('iptvGroupsContainer');
        if (!container) return;

        const lowerQuery = query.toLowerCase();
        const groups = container.querySelectorAll('details');

        groups.forEach(group => {
            const channels = group.querySelectorAll('[data-channel-name]');
            let visibleCount = 0;

            channels.forEach(ch => {
                const matches = !query || ch.dataset.channelName.includes(lowerQuery);
                ch.style.display = matches ? '' : 'none';
                if (matches) visibleCount++;
            });

            group.style.display = visibleCount > 0 ? '' : 'none';
            if (query && visibleCount > 0) {
                group.open = true;
            }
        });
    }

    async selectChannel(channelIndex, channelName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can select channels');
            return;
        }

        uiManager.updateMediaStatus(`Tuning to ${channelName}...`);

        if (state.hlsInstance) {
            state.hlsInstance.destroy();
            state.hlsInstance = null;
        }
        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        try {
            const response = await fetch('/api/stream/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    channelId: channelIndex,
                    roomId: state.currentRoomId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                uiManager.showError(`Failed to start channel: ${error.error || response.status}`);
                return;
            }

            const data = await response.json();
            const socketId = state.socket ? state.socket.id : '';
            const relayUrl = `${window.location.origin}${data.relayUrl}?socketId=${encodeURIComponent(socketId)}`;
            const streamName = data.streamName || channelName;

            socketManager.broadcastMediaAction('load-stream', {
                streamName: streamName,
                relayUrl: data.relayUrl
            });

            const { mediaManager } = await import('../main.js');
            mediaManager.loadStreamDirect(relayUrl, streamName);

            uiManager.updateMediaStatus(`Watching: ${streamName}`);
            this.highlightActiveChannel(channelIndex);

        } catch (err) {
            console.error('Channel select error:', err);
            uiManager.showError(`Failed to tune channel: ${err.message}`);
        }

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) torrentInfo.classList.add('hidden');
    }

    highlightActiveChannel(activeIndex) {
        const container = document.getElementById('iptvGroupsContainer');
        if (!container) return;

        container.querySelectorAll('[data-channel-index]').forEach(ch => {
            const isActive = parseInt(ch.dataset.channelIndex) === activeIndex;
            ch.classList.toggle('text-amber-400', isActive);
            ch.classList.toggle('font-bold', isActive);
            ch.classList.toggle('text-slate-300', !isActive);
        });
    }
}
