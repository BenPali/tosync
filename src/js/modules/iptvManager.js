// modules/iptvManager.js - IPTV playlist browser

import { state } from '../state.js';
import { socketManager, uiManager } from '../main.js';
import { destroyHls } from './codecUtils.js';
import { resetMediaLoad } from './mediaManager.js';

export class IptvManager {
    constructor() {
        this.currentPlaylist = null;
        this.searchTimeout = null;
    }

    async restoreIfCached() {
        if (!state.currentRoomId || this.currentPlaylist) return;
        try {
            const response = await fetch(`/api/stream/playlist/${state.currentRoomId}/groups`, {
                credentials: 'include'
            });
            if (!response.ok) return;
            const data = await response.json();
            this.currentPlaylist = data;
            this.displayChannelBrowser(data.groups);
        } catch (e) {
            // No cached playlist — nothing to restore
        }
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

            uiManager.updateMediaStatus(`Loaded ${data.channelCount} channels in ${data.groups.length} groups`);
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

        // Header: "Channels · N · M groups"
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between px-4 py-3';
        const headerLeft = document.createElement('div');
        headerLeft.className = 'flex items-center gap-2';
        const headerTitle = document.createElement('span');
        headerTitle.className = 'text-sm text-neutral-200';
        headerTitle.textContent = 'Channels';
        const headerMeta = document.createElement('span');
        headerMeta.className = 'text-[10px] text-neutral-500 font-mono';
        const total = groups.reduce((n, g) => n + (g.count || 0), 0);
        headerMeta.textContent = `${total} · ${groups.length} group${groups.length !== 1 ? 's' : ''}`;
        headerLeft.append(headerTitle, headerMeta);
        header.appendChild(headerLeft);
        browser.appendChild(header);

        // Search input — server-side search
        const searchWrap = document.createElement('div');
        searchWrap.className = 'px-4 pb-3 relative';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search channels…';
        searchInput.className =
            'w-full bg-inset border hairline rounded-lg text-xs text-neutral-200 px-3 py-1.5 placeholder:text-neutral-600 transition';
        searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                this.showGroups();
                return;
            }
            this.searchTimeout = setTimeout(() => this.searchChannels(query), 300);
        });
        searchWrap.appendChild(searchInput);
        browser.appendChild(searchWrap);

        // Search results container (hidden by default)
        const searchResults = document.createElement('div');
        searchResults.id = 'iptvSearchResults';
        searchResults.className = 'hidden max-h-64 overflow-y-auto divide-y divide-neutral-100/5';
        browser.appendChild(searchResults);

        // Groups container
        const container = document.createElement('div');
        container.id = 'iptvGroupsContainer';
        container.className = 'max-h-72 overflow-y-auto divide-y divide-neutral-100/5';

        // Group names come verbatim from the M3U's group-title= attribute.
        groups.forEach((group) => {
            const groupEl = document.createElement('details');
            groupEl.dataset.groupName = group.name;

            const summary = document.createElement('summary');
            summary.className =
                'cursor-pointer text-xs flex items-center justify-between px-4 py-2 hover:bg-neutral-100/[0.02] transition select-none';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'text-neutral-300 truncate';
            nameSpan.textContent = group.name;
            const countSpan = document.createElement('span');
            countSpan.className = 'text-neutral-600 font-mono shrink-0 ml-2';
            countSpan.textContent = String(group.count);
            summary.append(nameSpan, countSpan);
            groupEl.appendChild(summary);

            // Placeholder for lazy-loaded channels
            const channelList = document.createElement('div');
            channelList.className = 'pl-3 pr-2 pb-2 space-y-0.5';
            const loadingEl = document.createElement('div');
            loadingEl.className = 'text-xs text-neutral-500 italic p-1';
            loadingEl.textContent = 'Loading…';
            channelList.appendChild(loadingEl);
            groupEl.appendChild(channelList);

            groupEl.addEventListener('toggle', () => {
                if (groupEl.open && channelList.dataset.loaded !== 'true') {
                    this.loadGroupChannels(group.name, channelList);
                }
            });

            container.appendChild(groupEl);
        });

        browser.appendChild(container);
        browser.classList.remove('hidden');
    }

    async loadGroupChannels(groupName, container) {
        try {
            const response = await fetch(
                `/api/stream/playlist/${state.currentRoomId}/group?name=${encodeURIComponent(groupName)}`,
                { credentials: 'include' }
            );
            if (!response.ok) throw new Error('Failed to load group');

            const data = await response.json();
            container.innerHTML = '';
            container.dataset.loaded = 'true';

            data.channels.forEach((channel) => {
                container.appendChild(this.createChannelItem(channel));
            });
        } catch (err) {
            container.innerHTML = '';
            const errEl = document.createElement('div');
            errEl.className = 'text-xs text-red-400 p-1';
            errEl.textContent = 'Failed to load';
            container.appendChild(errEl);
        }
    }

    async searchChannels(query) {
        const searchResults = document.getElementById('iptvSearchResults');
        const groupsContainer = document.getElementById('iptvGroupsContainer');
        if (!searchResults || !groupsContainer) return;

        const statusEl = (text) => {
            const el = document.createElement('div');
            el.className = 'text-xs text-neutral-500 italic p-2';
            el.textContent = text;
            return el;
        };

        searchResults.innerHTML = '';
        searchResults.appendChild(statusEl('Searching…'));
        searchResults.classList.remove('hidden');
        groupsContainer.classList.add('hidden');

        try {
            const response = await fetch(
                `/api/stream/playlist/${state.currentRoomId}/search?q=${encodeURIComponent(query)}`,
                { credentials: 'include' }
            );
            if (!response.ok) throw new Error('Search failed');

            const data = await response.json();
            searchResults.innerHTML = '';

            if (data.results.length === 0) {
                searchResults.appendChild(statusEl('No results'));
                return;
            }

            data.results.forEach((channel) => {
                const item = this.createChannelItem(channel);
                const groupTag = document.createElement('span');
                groupTag.className = 'text-[10px] font-mono text-neutral-600 ml-auto shrink-0';
                groupTag.textContent = channel.group;
                item.appendChild(groupTag);
                searchResults.appendChild(item);
            });
        } catch (err) {
            searchResults.innerHTML = '';
            const errEl = document.createElement('div');
            errEl.className = 'text-xs text-red-400 p-2';
            errEl.textContent = 'Search failed';
            searchResults.appendChild(errEl);
        }
    }

    showGroups() {
        const searchResults = document.getElementById('iptvSearchResults');
        const groupsContainer = document.getElementById('iptvGroupsContainer');
        if (searchResults) searchResults.classList.add('hidden');
        if (groupsContainer) groupsContainer.classList.remove('hidden');
    }

    createChannelItem(channel) {
        // Real <button> so channels are keyboard-reachable (Tab + Enter).
        const chEl = document.createElement('button');
        chEl.type = 'button';
        chEl.className =
            'flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-neutral-100/[0.03] cursor-pointer transition w-full text-left';
        chEl.dataset.channelIndex = channel.index;

        // Logo placeholder — first 1-2 chars of channel name
        const logo = document.createElement('div');
        logo.className =
            'w-5 h-5 rounded bg-neutral-800 flex items-center justify-center text-[9px] font-mono text-neutral-400 shrink-0 overflow-hidden';
        if (channel.logo) {
            const img = document.createElement('img');
            img.src = channel.logo;
            img.alt = '';
            img.className = 'w-full h-full object-cover';
            img.addEventListener('error', () => {
                img.remove();
                logo.textContent = (channel.name || '?').substring(0, 2).toUpperCase();
            });
            logo.appendChild(img);
        } else {
            logo.textContent = (channel.name || '?').substring(0, 2).toUpperCase();
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'flex-1 text-sm text-neutral-300 truncate';
        nameEl.textContent = channel.name;

        chEl.append(logo, nameEl);
        chEl.addEventListener('click', () => this.selectChannel(channel.index, channel.name));
        return chEl;
    }

    async selectChannel(channelIndex, channelName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can select channels');
            return;
        }

        uiManager.updateMediaStatus(`Tuning to ${channelName}...`);

        resetMediaLoad();
        destroyHls();
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
            const relayUrl = `${window.location.origin}${data.relayUrl}`;
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
        document.querySelectorAll('[data-channel-index]').forEach((ch) => {
            const isActive = parseInt(ch.dataset.channelIndex) === activeIndex;
            ch.classList.toggle('bg-primary/[0.08]', isActive);
            // Ensure any lingering "live" marker is cleaned up
            const liveMarker = ch.querySelector('[data-role="live-marker"]');
            if (liveMarker) liveMarker.remove();
            if (isActive) {
                const marker = document.createElement('span');
                marker.dataset.role = 'live-marker';
                marker.className = 'text-[10px] font-mono text-primary';
                marker.textContent = 'live';
                ch.appendChild(marker);
            }
        });
    }
}
