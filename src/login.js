const REQUIRED_LENGTH = parseInt('{{ROOM_CODE_LENGTH}}');

// Theme toggle on the login page (theme.js bootstrap runs in <head>).
(function setupThemeToggle() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const sync = () => {
        const isLight = document.documentElement.classList.contains('light');
        btn.querySelectorAll('[data-theme-icon]').forEach(icon => {
            const showInLight = icon.dataset.themeIcon === 'light';
            icon.classList.toggle('hidden', showInLight !== isLight);
        });
    };
    if (typeof window.__tosyncToggleTheme === 'function') {
        btn.addEventListener('click', () => window.__tosyncToggleTheme());
    }
    document.addEventListener('theme-change', sync);
    sync();
})();

const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('errorMessage');
const loginBtn = document.getElementById('loginBtn');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    errorMessage.classList.add('hidden');
    loginBtn.disabled = true;
    const originalBtnText = loginBtn.textContent;
    loginBtn.textContent = 'Authenticating...';
    loginBtn.classList.add('opacity-75', 'cursor-not-allowed');
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include',
        });
        const data = await response.json();
        if (response.ok) {
            const urlParams = new URLSearchParams(window.location.search);
            const redirect = urlParams.get('redirect') || '/';
            const allowed = /^\/[a-zA-Z0-9]*$/;
            window.location.href = allowed.test(redirect) ? redirect : '/';
        } else {
            errorMessage.textContent = data.error || 'Invalid credentials';
            errorMessage.classList.remove('hidden');
            loginBtn.disabled = false;
            loginBtn.textContent = originalBtnText;
            loginBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'Connection error. Please try again.';
        errorMessage.classList.remove('hidden');
        loginBtn.disabled = false;
        loginBtn.textContent = originalBtnText;
        loginBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
});

const guestRoomCode = document.getElementById('guestRoomCode');
const guestJoinBtn = document.getElementById('guestJoinBtn');
const guestError = document.getElementById('guestError');

guestRoomCode.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
});

guestRoomCode.addEventListener('paste', (e) => {
    e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
    let roomCode = pastedText.trim();

    if (roomCode.endsWith('/')) {
        roomCode = roomCode.slice(0, -1);
    }

    if (roomCode.includes('://') || roomCode.includes('/')) {
        const parts = roomCode.split('/');
        const lastSegment = parts[parts.length - 1];

        if (lastSegment && lastSegment.length === REQUIRED_LENGTH) {
            roomCode = lastSegment;
        } else {
            const regex = new RegExp(`[A-Z0-9]{${REQUIRED_LENGTH}}`, 'i');
            const match = roomCode.match(regex);
            if (match) roomCode = match[0];
        }
    }

    e.target.value = roomCode.toUpperCase().slice(0, REQUIRED_LENGTH);
});

guestRoomCode.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') guestJoinBtn.click();
});

guestJoinBtn.addEventListener('click', () => {
    const roomCode = guestRoomCode.value.trim().toUpperCase();
    guestError.classList.add('hidden');

    if (roomCode.length !== REQUIRED_LENGTH) {
        guestError.textContent = 'Please enter a valid ' + REQUIRED_LENGTH + '-character room code';
        guestError.classList.remove('hidden');
        return;
    }

    const codeRegex = new RegExp('^[A-Z0-9]{' + REQUIRED_LENGTH + '}$');
    if (!codeRegex.test(roomCode)) {
        guestError.textContent = 'Room code must contain only letters and numbers';
        guestError.classList.remove('hidden');
        return;
    }

    window.location.href = `/${roomCode}`;
});
