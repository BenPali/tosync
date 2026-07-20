import { state } from '../state.js';

export class UIManager {
    initialize() {}

    updateConnectionStatus(message, status) {
        const el = document.getElementById('connectionStatus');
        if (!el) return;

        // Preserve the flex-row layout from HTML (dot + text). Only swap the dot
        // color and the text color based on status; never override the sizing /
        // alignment classes that anchor this into the identity strip.
        const connected = status === 'connected';
        el.className =
            'flex items-center gap-2 text-xs ' + (connected ? 'text-neutral-400' : 'text-red-400 animate-pulse');

        el.innerHTML = '';
        const dot = document.createElement('span');
        dot.className = 'w-1.5 h-1.5 rounded-full ' + (connected ? 'bg-emerald-500' : 'bg-red-500');
        el.append(dot, document.createTextNode(' ' + message));
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
        users.forEach((user) => {
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

        uniqueUsers.forEach((user) => {
            const baseName = user.name.replace(/_\d+$/, '');
            if (!nameMap.has(baseName)) {
                nameMap.set(baseName, user);
                finalUsers.push(user);
            } else {
                const existing = nameMap.get(baseName);
                if (user.role === 'admin' || (!user.name.includes('_') && existing.name.includes('_'))) {
                    const index = finalUsers.findIndex((u) => u === existing);
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
            adminInstructions.classList.toggle('hidden', state.userRole !== 'admin');
        }

        // Render as presence chips (overlapping circular initials).
        finalUsers.forEach((user) => {
            const isSelf = user.name === state.userName || user.id === state.socket?.id;
            const isAdmin = user.role === 'admin';
            const canManage = state.userRole === 'admin' && !isSelf;

            const chip = document.createElement('div');
            const base =
                'relative w-7 h-7 rounded-full border-2 border-neutral-950 flex items-center justify-center text-xs font-medium shrink-0';
            const cls = isAdmin
                ? `${base} bg-primary/15 ring-1 ring-primary/40 text-primary`
                : `${base} bg-neutral-800 text-neutral-300`;
            chip.className = cls + (canManage ? ' cursor-pointer hover:ring-1 hover:ring-neutral-500 transition' : '');
            chip.textContent = (user.name || '?').charAt(0).toLowerCase();

            const suffix = isAdmin ? ' · admin' : ' · guest';
            const selfTag = isSelf ? ' (you)' : canManage ? ' · click to manage' : '';
            chip.title = `${user.name}${suffix}${selfTag}`;

            if (canManage) {
                chip.addEventListener('click', (e) => {
                    import('../main.js').then(({ authManager }) => {
                        authManager.showUserMenu(user.name, user.role, e);
                    });
                });
            }

            usersList.appendChild(chip);
        });

        const connectedCount = document.getElementById('connectedUsers');
        if (connectedCount) {
            connectedCount.textContent = `${finalUsers.length} connected`;
        }
    }

    showError(message) {
        this.toast('error', message);
        console.error(message);
    }

    /**
     * Emit a toast into #toastStack.
     * kind: 'info' | 'success' | 'error' | 'warn'
     * opts.timeout: ms until auto-dismiss (default 4000, 0 = sticky)
     */
    toast(kind, message, opts = {}) {
        const stack = document.getElementById('toastStack');
        if (!stack) {
            console.log(`[toast:${kind}]`, message);
            return;
        }

        const palette = {
            error: { border: 'border-red-500/40', text: 'text-red-200', dot: 'bg-red-500' },
            warn: { border: 'border-amber-500/40', text: 'text-amber-200', dot: 'bg-amber-500' },
            success: { border: 'border-emerald-500/40', text: 'text-emerald-200', dot: 'bg-emerald-500' },
            info: { border: 'border-neutral-100/10', text: 'text-neutral-200', dot: 'bg-neutral-500' }
        }[kind] || { border: 'border-neutral-100/10', text: 'text-neutral-200', dot: 'bg-neutral-500' };

        const toast = document.createElement('div');
        toast.className = `surface border ${palette.border} rounded-lg px-3 py-2.5 shadow-2xl flex items-start gap-2.5 pointer-events-auto fade-in`;

        const dot = document.createElement('span');
        dot.className = `mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${palette.dot}`;

        const text = document.createElement('div');
        text.className = `flex-1 text-sm ${palette.text}`;
        text.textContent = message;

        const close = document.createElement('button');
        close.className = 'text-neutral-500 hover:text-neutral-100 transition text-xs leading-none -mr-1';
        close.textContent = '✕';
        close.addEventListener('click', () => toast.remove());

        toast.append(dot, text, close);
        stack.appendChild(toast);

        const timeout = opts.timeout === 0 ? 0 : opts.timeout || 4000;
        if (timeout > 0) {
            setTimeout(() => {
                toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(8px)';
                setTimeout(() => toast.remove(), 200);
            }, timeout);
        }
    }

    showShortcutsOverlay() {
        this.hideShortcutsOverlay();
        const overlay = document.createElement('div');
        overlay.id = 'shortcutsOverlay';
        overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in';

        const card = document.createElement('div');
        card.className = 'surface border hairline rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl';
        card.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.className = 'text-sm font-medium text-neutral-100 mb-4';
        title.textContent = 'Keyboard shortcuts';
        card.appendChild(title);

        const rows = [
            ['Space', 'Play / pause'],
            ['← / →', 'Seek −10s / +10s'],
            ['F', 'Fullscreen'],
            ['S', 'Toggle subtitles'],
            ['?', 'Show this help'],
            ['Esc', 'Close dialogs']
        ];
        for (const [key, desc] of rows) {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-1.5 text-sm';
            const keySpan = document.createElement('kbd');
            keySpan.className =
                'font-mono text-[11px] text-neutral-300 bg-neutral-800 border hairline rounded px-2 py-0.5';
            keySpan.textContent = key;
            const descSpan = document.createElement('span');
            descSpan.className = 'text-neutral-400';
            descSpan.textContent = desc;
            row.append(keySpan, descSpan);
            card.appendChild(row);
        }

        const hint = document.createElement('div');
        hint.className = 'text-[11px] text-neutral-600 mt-4 text-center';
        hint.textContent = 'Shortcuts fire only when focus is not on an input.';
        card.appendChild(hint);

        overlay.appendChild(card);
        overlay.addEventListener('click', () => this.hideShortcutsOverlay());
        document.body.appendChild(overlay);
    }

    hideShortcutsOverlay() {
        const existing = document.getElementById('shortcutsOverlay');
        if (existing) existing.remove();
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
