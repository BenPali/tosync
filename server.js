import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NODE_ENV = process.env.NODE_ENV || 'development';
const ENABLE_TORRENTS = process.env.ENABLE_TORRENTS === 'true';
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-not-for-production';
const STATIC_DIR = ENABLE_TORRENTS ? 'private' : 'public';

let ROOM_CODE_LENGTH = ENABLE_TORRENTS ? 32 : 6;
try {
    const configPath = path.join(__dirname, STATIC_DIR, 'js', 'config.js');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const match = configContent.match(/ROOM_CODE_LENGTH:\s*(\d+)/);
    if (match) ROOM_CODE_LENGTH = parseInt(match[1], 10);
} catch (err) {
    console.warn(`Using default ROOM_CODE_LENGTH: ${ROOM_CODE_LENGTH}`);
}

let ADMIN_USERS = {};
try {
    ADMIN_USERS = JSON.parse(process.env.ADMIN_USERS || '{}');
} catch (err) {
    console.error('ADMIN_USERS parse error:', err.message);
}

console.log(`ToSync ${ENABLE_TORRENTS ? 'Private' : 'Public'} - Port ${PORT} - Admins: ${Object.keys(ADMIN_USERS).length}`);

let WebTorrent, torrentClient, activeTorrents;
if (ENABLE_TORRENTS) {
    WebTorrent = (await import('webtorrent')).default;
    torrentClient = new WebTorrent();
    activeTorrents = new Map();
    console.log('WebTorrent enabled');
}

const app = express();
const server = createServer(app);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false
});

const torrentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many torrent requests' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(cookieParser());
app.use(cors({
    origin: ENABLE_TORRENTS
        ? ['https://app.tosync.org', 'http://localhost:3001']
        : ['https://tosync.org', 'https://www.tosync.org', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());
app.use('/api/', apiLimiter);
app.set('trust proxy', 1);

// Create shared session middleware for Express and Socket.IO
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'tosync.sid',
    cookie: {
        secure: NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
});

app.use(sessionMiddleware);

// Static file serving - disable auto index.html for private to allow auth redirect
const staticOptions = ENABLE_TORRENTS ? { index: false } : {};
app.use(express.static(path.join(__dirname, STATIC_DIR), staticOptions));

const socketRoomMembership = new Map();

function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const redirect = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?redirect=${redirect}`);
}

if (ENABLE_TORRENTS) {
    app.get('/login', (req, res) => {
        if (req.session && req.session.isAdmin) {
            return res.redirect('/');
        }
        res.sendFile(path.join(__dirname, STATIC_DIR, 'login.html'));
    });

    app.post('/api/auth/login', authLimiter, async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Credentials required' });
        }

        const storedPassword = ADMIN_USERS[username];
        if (!storedPassword) {
            try {
                await bcrypt.compare(password, '$2b$12$LQv3c1yqBwEHpNxVfLnQKOQMZpz1WxIzyMJtf3Fuz7RB.Iy3GnAkO');
            } catch {}
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        let valid = false;
        if (storedPassword.startsWith('$2')) {
            valid = await bcrypt.compare(password, storedPassword);
        } else {
            console.warn(`WARNING: User "${username}" has plaintext password`);
            valid = password === storedPassword;
        }

        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.isAdmin = true;
        req.session.username = username;
        console.log(`Admin login: ${username} from ${req.ip}`);
        res.json({ success: true, username });
    });

    app.post('/api/auth/logout', (req, res) => {
        const username = req.session?.username;
        req.session.destroy(() => {
            res.clearCookie('tosync.sid');
            if (username) console.log(`Admin logout: ${username}`);
            res.json({ success: true });
        });
    });

    app.get('/api/auth/status', (req, res) => {
        res.json({
            authenticated: !!(req.session && req.session.isAdmin),
            username: req.session?.username || null
        });
    });
}

const roomsDir = path.join(__dirname, 'rooms');
if (!fs.existsSync(roomsDir)) {
    fs.mkdirSync(roomsDir, { recursive: true });
}

function ensureRoomDirectories(roomId) {
    const roomDir = path.join(roomsDir, roomId);
    const videosDir = path.join(roomDir, 'videos');
    const subtitlesDir = path.join(roomDir, 'subtitles');

    [roomDir, videosDir, subtitlesDir].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    return { roomDir, videosDir, subtitlesDir };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomId = req.query.roomId;
        if (!roomId) return cb(new Error('Room ID required'));

        const isSubtitle = file.mimetype === 'application/x-subrip';
        const folder = isSubtitle ? 'subtitles' : 'videos';
        const uploadPath = path.join(roomsDir, roomId, folder);

        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const isSubtitle = file.mimetype === 'application/x-subrip';
        cb(null, isSubtitle ? 'subtitle.srt' : file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|mkv|avi|webm|mov|flv|wmv|m4v/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('video/');
        if (mimetype && extname) return cb(null, true);
        cb(new Error('Only video files allowed'));
    }
});

const subtitleStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomId = req.body.roomId || req.query.roomId;
        if (!roomId) return cb(new Error('Room ID required'));
        const { subtitlesDir } = ensureRoomDirectories(roomId);
        cb(null, subtitlesDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const subtitleUpload = multer({
    storage: subtitleStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /srt|vtt|ass|ssa|sub/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (extname) return cb(null, true);
        cb(new Error('Only subtitle files allowed'));
    }
});

if (ENABLE_TORRENTS) {
    app.get('/api/torrents/auth-check', requireAdmin, (req, res) => {
        res.json({ authorized: true, username: req.session.username });
    });

    app.post('/api/torrents/add', torrentLimiter, requireAdmin, async (req, res) => {
        const { magnetLink, roomId } = req.body;

        if (!magnetLink || !magnetLink.startsWith('magnet:')) {
            return res.status(400).json({ error: 'Invalid magnet link' });
        }

        if (!roomId) {
            return res.status(400).json({ error: 'Room ID required' });
        }

        try {
            let existingTorrent = torrentClient.get(magnetLink);

            if (existingTorrent) {
                if (Array.isArray(existingTorrent)) {
                    existingTorrent = existingTorrent[0];
                }

                if (existingTorrent && typeof existingTorrent.once === 'function') {
                    if (!existingTorrent.ready) {
                        await new Promise(resolve => existingTorrent.once('ready', resolve));
                    }
                    return res.json({
                        infoHash: existingTorrent.infoHash,
                        name: existingTorrent.name || 'Unknown',
                        files: existingTorrent.files.map((f, i) => ({
                            name: f.name,
                            length: f.length,
                            index: i
                        }))
                    });
                }
            }

            const { videosDir } = ensureRoomDirectories(roomId);
            const torrent = torrentClient.add(magnetLink, {
                path: videosDir,
                strategy: 'sequential'
            });

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    torrent.destroy();
                    reject(new Error('Timeout fetching torrent metadata'));
                }, 60000);

                torrent.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                torrent.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            activeTorrents.set(torrent.infoHash, {
                torrent,
                roomId,
                addedAt: Date.now()
            });

            const videoFiles = torrent.files.filter(file => {
                const ext = path.extname(file.name).toLowerCase();
                return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].includes(ext);
            });

            console.log(`Torrent added: ${torrent.name}`);

            res.json({
                infoHash: torrent.infoHash,
                name: torrent.name || 'Unknown',
                files: videoFiles.map(f => ({
                    name: f.name,
                    length: f.length,
                    index: torrent.files.indexOf(f)
                })),
                totalLength: torrent.length || 0
            });

        } catch (error) {
            console.error('Torrent error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/torrents/:infoHash/status', requireAdmin, (req, res) => {
        const torrentInfo = activeTorrents.get(req.params.infoHash);
        if (!torrentInfo) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        const { torrent } = torrentInfo;
        res.json({
            infoHash: torrent.infoHash,
            name: torrent.name,
            progress: torrent.progress,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            numPeers: torrent.numPeers,
            downloaded: torrent.downloaded,
            done: torrent.done
        });
    });

    app.get('/api/torrents/:infoHash/files/:fileIndex/stream', (req, res) => {
        const { infoHash, fileIndex } = req.params;
        const torrentInfo = activeTorrents.get(infoHash);

        if (!torrentInfo) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        const roomId = torrentInfo.roomId;
        const isAdmin = req.session && req.session.isAdmin;

        const viewerSocketId = req.query.socketId || req.headers['x-socket-id'];
        let isRoomMember = false;

        if (viewerSocketId) {
            const memberRoomId = socketRoomMembership.get(viewerSocketId);
            const io = req.app.get('io');
            const socket = io?.sockets?.sockets?.get(viewerSocketId);
            isRoomMember = memberRoomId === roomId && socket?.connected;
        }

        if (!isAdmin && !isRoomMember) {
            return res.status(403).json({ error: 'Join the room first' });
        }

        const file = torrentInfo.torrent.files[parseInt(fileIndex)];
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const ext = path.extname(file.name).toLowerCase();
        const contentType = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime'
        }[ext] || 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
            const chunksize = (end - start) + 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);
            res.setHeader('Content-Length', chunksize);

            const stream = file.createReadStream({ start, end });

            stream.on('error', (err) => {
                console.error('Stream error:', err.message);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Stream failed' });
                }
                stream.destroy();
            });

            res.on('close', () => stream.destroy());
            stream.pipe(res);
        } else {
            res.setHeader('Content-Length', file.length);
            const stream = file.createReadStream();

            stream.on('error', (err) => {
                console.error('Stream error:', err.message);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Stream failed' });
                }
                stream.destroy();
            });

            res.on('close', () => stream.destroy());
            stream.pipe(res);
        }
    });

    setInterval(() => {
        const now = Date.now();
        const maxAge = 3 * 60 * 60 * 1000;

        activeTorrents.forEach((info, hash) => {
            if (now - info.addedAt > maxAge && info.torrent.done) {
                info.torrent.destroy({ destroyStore: false });
                activeTorrents.delete(hash);
                console.log(`Cleaned up torrent: ${hash.substring(0, 8)}...`);
            }
        });
    }, 30 * 60 * 1000);

} else {
    app.use('/api/torrents', (req, res) => {
        res.status(403).json({ error: 'Torrents not available on this instance' });
    });
}

app.post('/upload', (req, res) => {
    req.setTimeout(60 * 60 * 1000);
    res.setTimeout(60 * 60 * 1000);

    upload.single('video')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large. Maximum size is 10GB.' });
            }
            return res.status(500).json({ error: 'Upload failed: ' + err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const roomId = req.body.roomId || req.query.roomId;
        const fileInfo = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            url: `/rooms/${roomId}/videos/${req.file.filename}`,
            roomId: roomId
        };

        console.log('File uploaded:', fileInfo.originalName, 'to room:', roomId);
        res.json(fileInfo);
    });
});

app.post('/upload-subtitle', (req, res) => {
    subtitleUpload.single('subtitle')(req, res, (err) => {
        if (err) {
            console.error('Subtitle upload error:', err);
            return res.status(500).json({ error: 'Upload failed: ' + err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No subtitle file uploaded' });
        }

        const roomId = req.body.roomId || req.query.roomId;
        const subtitleInfo = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            url: `/rooms/${roomId}/subtitles/${req.file.filename}`,
            language: req.body.language || 'Unknown',
            label: req.body.label || req.file.originalname,
            roomId: roomId
        };

        console.log('Subtitle uploaded:', subtitleInfo.originalName, 'to room:', roomId);
        res.json(subtitleInfo);
    });
});

app.use('/rooms/:roomId/videos', (req, res, next) => {
    const roomId = req.params.roomId;
    const videosDir = path.join(roomsDir, roomId, 'videos');
    if (fs.existsSync(videosDir)) {
        express.static(videosDir)(req, res, next);
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

app.use('/rooms/:roomId/subtitles/:filename', async (req, res, next) => {
    try {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        const { roomId, filename } = req.params;
        const subtitlesDir = path.join(roomsDir, roomId, 'subtitles');
        const filePath = path.join(subtitlesDir, filename);
        const ext = path.extname(filename).toLowerCase();

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Subtitle file not found' });
        }

        res.header('Content-Type', 'text/vtt; charset=utf-8');

        if (ext === '.srt') {
            const srtContent = fs.readFileSync(filePath, 'utf8');
            const vttContent = convertSrtToVtt(srtContent);
            res.send(vttContent);
        } else if (ext === '.vtt') {
            const vttContent = fs.readFileSync(filePath, 'utf8');
            res.send(vttContent);
        } else {
            const content = fs.readFileSync(filePath, 'utf8');
            res.send(content);
        }
    } catch (error) {
        console.error('Error serving subtitle:', error);
        res.status(500).json({ error: 'Failed to serve subtitle file' });
    }
});

function convertSrtToVtt(srtContent) {
    let vttContent = 'WEBVTT\n\n';
    const normalizedSrt = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalizedSrt.split(/\n\n+/).filter(block => block.trim());

    blocks.forEach(block => {
        const lines = block.split('\n').filter(line => line.trim());
        if (lines.length >= 2) {
            let timestampIndex = lines.findIndex(line => line.includes('-->'));
            if (timestampIndex !== -1) {
                const timestampLine = lines[timestampIndex];
                const subtitleLines = lines.slice(timestampIndex + 1);
                const convertedTimestamp = timestampLine.replace(/,/g, '.');
                if (subtitleLines.length > 0) {
                    vttContent += `${convertedTimestamp}\n${subtitleLines.join('\n')}\n\n`;
                }
            }
        }
    });

    return vttContent;
}

app.get('/api/health', (req, res) => {
    const health = {
        status: 'ok',
        instance: ENABLE_TORRENTS ? 'private' : 'public',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };

    if (ENABLE_TORRENTS) {
        health.torrents = {
            active: activeTorrents?.size || 0,
            clientReady: !!torrentClient
        };
    }

    res.json(health);
});

const io = new Server(server, {
    cors: {
        origin: ENABLE_TORRENTS
            ? ['https://app.tosync.org', 'http://localhost:3001']
            : ['https://tosync.org', 'https://www.tosync.org', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Make session available to Socket.IO (use the same middleware instance)
io.engine.use(cookieParser());
io.engine.use(sessionMiddleware);

app.set('io', io);

const rooms = new Map();
const users = new Map();

const ROOM_INACTIVITY_TIMEOUT = 5 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL = 60 * 1000;

function promoteNextAdmin(room, currentAdminSocketId) {
    const potentialAdmins = Array.from(room.users.values())
        .filter(user => user.id !== currentAdminSocketId)
        .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    if (potentialAdmins.length > 0) {
        const newAdmin = potentialAdmins[0];
        const oldAdmin = room.users.get(currentAdminSocketId);

        newAdmin.role = 'admin';
        room.adminId = newAdmin.id;
        users.set(newAdmin.id, newAdmin);

        console.log(`${newAdmin.name} promoted to admin in room ${room.id}`);

        io.to(newAdmin.id).emit('admin-transferred', {
            newAdminName: newAdmin.name,
            formerAdminName: oldAdmin ? oldAdmin.name : 'Former Admin',
            isYouNewAdmin: true,
            reason: 'admin-left'
        });

        io.to(room.id).emit('admin-transferred', {
            newAdminName: newAdmin.name,
            formerAdminName: oldAdmin ? oldAdmin.name : 'Former Admin',
            isYouNewAdmin: false,
            reason: 'admin-left'
        });

        io.to(room.id).emit('users-update', {
            users: Array.from(room.users.values()),
            userCount: room.users.size
        });

        return newAdmin;
    }

    room.adminId = null;
    return null;
}

function generateUniqueName(baseName, existingUsers, excludeSocketId) {
    const existingNames = Array.from(existingUsers.values())
        .filter(u => u.id !== excludeSocketId)
        .map(u => u.name);

    if (!existingNames.includes(baseName)) {
        return baseName;
    }

    let counter = 1;
    let newName;
    do {
        newName = `${baseName} (${counter})`;
        counter++;
    } while (existingNames.includes(newName));

    return newName;
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join-room', (userData) => {
        const { roomId, userName, userRole, isCreator } = userData;

        if (!roomId || roomId.length !== ROOM_CODE_LENGTH) {
            socket.emit('error', { message: 'Invalid room code format' });
            return;
        }

        // Check if user is authenticated when trying to create a room on private site
        if (ENABLE_TORRENTS && isCreator && userRole === 'admin') {
            const session = socket.request.session;
            if (!session || !session.isAdmin) {
                socket.emit('error', { message: 'Authentication required to create rooms' });
                console.log(`Unauthorized room creation attempt: ${socket.id}`);
                return;
            }
        }

        socketRoomMembership.set(socket.id, roomId);
        socket.emit('socket-registered', { socketId: socket.id });

        if (!rooms.has(roomId)) {
            if (isCreator && userRole === 'admin') {
                rooms.set(roomId, {
                    id: roomId,
                    users: new Map(),
                    currentMedia: null,
                    videoState: {
                        isPlaying: false,
                        currentTime: 0,
                        playbackRate: 1
                    },
                    adminId: null,
                    currentTorrent: null,
                    subtitles: [],
                    createdAt: Date.now(),
                    lastActivity: Date.now()
                });
                console.log(`Room created: ${roomId} by ${userName}`);
            } else {
                socket.emit('room-not-found');
                return;
            }
        }

        const room = rooms.get(roomId);

        if (users.has(socket.id)) {
            const oldUser = users.get(socket.id);
            if (oldUser.room && oldUser.room !== roomId && rooms.has(oldUser.room)) {
                const oldRoom = rooms.get(oldUser.room);
                oldRoom.users.delete(socket.id);
            }
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
            }
            users.delete(socket.id);
        }

        socket.join(roomId);

        const uniqueName = generateUniqueName(userName, room.users, socket.id);
        let finalRole = userRole;

        if (!room.adminId && room.users.size === 0 && userRole === 'guest') {
            console.log(`Auto-promoting ${uniqueName} to admin in empty room ${roomId}`);
            finalRole = 'admin';
        }

        const user = {
            id: socket.id,
            name: uniqueName,
            role: finalRole,
            room: roomId,
            joinedAt: new Date()
        };

        users.set(socket.id, user);
        room.users.set(socket.id, user);
        room.lastActivity = Date.now();

        if (finalRole === 'admin' && (!room.adminId || isCreator)) {
            room.adminId = socket.id;
        }

        console.log(`${user.name} (${finalRole}) joined room: ${roomId}`);

        socket.emit('room-state', {
            room: roomId,
            users: Array.from(room.users.values()),
            currentMedia: room.currentMedia,
            videoState: room.videoState,
            isAdmin: socket.id === room.adminId,
            currentTorrent: room.currentTorrent ? {
                infoHash: room.currentTorrent.infoHash,
                name: room.currentTorrent.name,
                progress: room.currentTorrent.progress
            } : null,
            subtitles: room.subtitles
        });

        socket.to(roomId).emit('user-joined', {
            user: user,
            userCount: room.users.size
        });

        io.to(roomId).emit('users-update', {
            users: Array.from(room.users.values()),
            userCount: room.users.size
        });
    });

    socket.on('video-action', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const room = rooms.get(user.room);
        if (!room) return;

        room.lastActivity = Date.now();

        const { action, time, playbackRate } = data;

        switch (action) {
            case 'play':
                room.videoState.isPlaying = true;
                room.videoState.currentTime = time || 0;
                break;
            case 'pause':
                room.videoState.isPlaying = false;
                room.videoState.currentTime = time || 0;
                break;
            case 'seek':
                room.videoState.currentTime = time || 0;
                break;
            case 'playback-rate':
                room.videoState.playbackRate = playbackRate || 1;
                room.videoState.currentTime = time || 0;
                break;
        }

        socket.to(user.room).emit('sync-video', {
            action: action,
            time: time,
            playbackRate: playbackRate,
            user: user.name,
            timestamp: Date.now()
        });
    });

    socket.on('media-action', (data) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            socket.emit('error', { message: 'Only admins can manage media' });
            return;
        }

        const room = rooms.get(user.room);
        if (!room) return;

        room.lastActivity = Date.now();

        const { action, mediaData } = data;

        switch (action) {
            case 'load-torrent':
                room.currentMedia = {
                    type: 'torrent',
                    data: mediaData,
                    loadedBy: user.name,
                    loadedAt: new Date()
                };
                break;
            case 'load-file':
                room.currentMedia = {
                    type: 'file',
                    data: mediaData,
                    loadedBy: user.name,
                    loadedAt: new Date()
                };
                break;
            case 'clear-media':
                room.currentMedia = null;
                room.videoState = {
                    isPlaying: false,
                    currentTime: 0,
                    playbackRate: 1
                };
                if (room.currentTorrent) {
                    room.currentTorrent = null;
                }
                break;
        }

        io.to(user.room).emit('media-update', {
            action: action,
            mediaData: room.currentMedia,
            user: user.name
        });
    });

    socket.on('torrent-status', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        socket.to(user.room).emit('torrent-progress', data);
    });

    socket.on('force-sync', (data) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') return;

        const room = rooms.get(user.room);
        if (!room) return;

        room.lastActivity = Date.now();
        room.videoState.currentTime = data.time || 0;
        room.videoState.isPlaying = data.isPlaying || false;

        socket.to(user.room).emit('force-sync', {
            time: data.time,
            isPlaying: data.isPlaying,
            user: user.name
        });
    });

    socket.on('subtitle-upload', (data) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') return;

        const room = rooms.get(user.room);
        if (!room) return;

        room.lastActivity = Date.now();
        room.subtitles.push(data.subtitle);

        io.to(user.room).emit('subtitle-added', {
            subtitle: data.subtitle,
            user: user.name
        });
    });

    socket.on('subtitle-select', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        const room = rooms.get(user.room);
        if (!room) return;

        room.lastActivity = Date.now();

        socket.to(user.room).emit('subtitle-selected', {
            subtitleId: data.subtitleId,
            user: user.name
        });
    });

    socket.on('transfer-admin', (data) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            socket.emit('transfer-admin-error', { message: 'Only admins can transfer permissions' });
            return;
        }

        const room = rooms.get(user.room);
        if (!room) {
            socket.emit('transfer-admin-error', { message: 'Room not found' });
            return;
        }

        const { targetUserName } = data;
        const targetUser = Array.from(room.users.values())
            .find(u => u.name === targetUserName && u.role === 'guest');

        if (!targetUser) {
            socket.emit('transfer-admin-error', { message: 'Target user not found' });
            return;
        }

        user.role = 'guest';
        targetUser.role = 'admin';
        room.adminId = targetUser.id;
        room.lastActivity = Date.now();

        users.set(user.id, user);
        users.set(targetUser.id, targetUser);

        socket.emit('admin-transferred', {
            newAdminName: targetUser.name,
            formerAdminName: user.name,
            isYouFormerAdmin: true,
            isYouNewAdmin: false,
            reason: 'manual-transfer'
        });

        io.to(targetUser.id).emit('admin-transferred', {
            newAdminName: targetUser.name,
            formerAdminName: user.name,
            isYouFormerAdmin: false,
            isYouNewAdmin: true,
            reason: 'manual-transfer'
        });

        socket.to(user.room).emit('admin-transferred', {
            newAdminName: targetUser.name,
            formerAdminName: user.name,
            isYouFormerAdmin: false,
            isYouNewAdmin: false,
            reason: 'manual-transfer'
        });

        io.to(user.room).emit('users-update', {
            users: Array.from(room.users.values()),
            userCount: room.users.size
        });
    });

    socket.on('kick-user', (data) => {
        const admin = users.get(socket.id);
        if (!admin || admin.role !== 'admin') {
            socket.emit('kick-user-error', { message: 'Only admins can kick users' });
            return;
        }

        const room = rooms.get(admin.room);
        if (!room) {
            socket.emit('kick-user-error', { message: 'Room not found' });
            return;
        }

        const { targetUserName } = data;
        const targetUser = Array.from(room.users.values())
            .find(u => u.name === targetUserName);

        if (!targetUser) {
            socket.emit('kick-user-error', { message: 'Target user not found' });
            return;
        }

        if (targetUser.id === admin.id) {
            socket.emit('kick-user-error', { message: 'Cannot kick yourself' });
            return;
        }

        room.users.delete(targetUser.id);
        users.delete(targetUser.id);
        room.lastActivity = Date.now();

        io.to(targetUser.id).emit('user-kicked', {
            kickedUserName: targetUser.name,
            kickedByAdmin: admin.name,
            isYouKicked: true
        });

        const kickedSocket = io.sockets.sockets.get(targetUser.id);
        if (kickedSocket) {
            kickedSocket.disconnect(true);
        }

        socket.to(admin.room).emit('user-kicked', {
            kickedUserName: targetUser.name,
            kickedByAdmin: admin.name,
            isYouKicked: false
        });

        io.to(admin.room).emit('users-update', {
            users: Array.from(room.users.values()),
            userCount: room.users.size
        });
    });

    socket.on('leave-room', () => {
        socketRoomMembership.delete(socket.id);
    });

    socket.on('disconnect', () => {
        socketRoomMembership.delete(socket.id);
        console.log(`Socket disconnected: ${socket.id}`);

        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.room);
            if (room) {
                const wasAdmin = room.adminId === socket.id;
                room.users.delete(socket.id);
                room.lastActivity = Date.now();

                if (wasAdmin && room.users.size > 0) {
                    promoteNextAdmin(room, socket.id);
                } else if (wasAdmin) {
                    room.adminId = null;
                }

                socket.to(user.room).emit('user-left', {
                    user: user,
                    userCount: room.users.size
                });

                if (room.users.size > 0) {
                    socket.to(user.room).emit('users-update', {
                        users: Array.from(room.users.values()),
                        userCount: room.users.size
                    });
                }
            }
            users.delete(socket.id);
        }
    });

    socket.on('validate-room', (data) => {
        const { roomId } = data;
        if (rooms.has(roomId)) {
            socket.emit('room-exists');
        } else {
            socket.emit('room-not-found');
        }
    });
});

function cleanupInactiveRooms() {
    const now = Date.now();
    const roomsToDelete = [];

    rooms.forEach((room, roomId) => {
        if (room.users.size === 0 && (now - room.lastActivity) > ROOM_INACTIVITY_TIMEOUT) {
            roomsToDelete.push(roomId);
        }
    });

    roomsToDelete.forEach(roomId => {
        const room = rooms.get(roomId);

        if (room.currentTorrent) {
            let torrentUsedElsewhere = false;
            rooms.forEach((otherRoom, otherRoomId) => {
                if (otherRoomId !== roomId && otherRoom.currentTorrent === room.currentTorrent) {
                    torrentUsedElsewhere = true;
                }
            });

            if (!torrentUsedElsewhere) {
                room.currentTorrent.destroy({ destroyStore: true });
            }
        }

        const roomDir = path.join(roomsDir, roomId);
        if (fs.existsSync(roomDir)) {
            fs.rm(roomDir, { recursive: true, force: true }, (err) => {
                if (err) {
                    console.error(`Error deleting room directory ${roomId}:`, err);
                } else {
                    console.log(`Deleted room directory: ${roomId}`);
                }
            });
        }

        rooms.delete(roomId);
        console.log(`Cleaned up inactive room: ${roomId}`);
    });
}

setInterval(cleanupInactiveRooms, ROOM_CLEANUP_INTERVAL);

// Root route - MUST come before /:roomCode
app.get('/', (req, res) => {
    // On private instance, redirect to login if not authenticated
    if (ENABLE_TORRENTS && !req.session?.isAdmin) {
        return res.redirect(302, '/login');
    }
    res.sendFile(path.join(__dirname, STATIC_DIR, 'index.html'));
});

// Room code route
app.get('/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;

    const isValidCode = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`, 'i').test(roomCode);

    if (isValidCode) {
        // Allow access to room URLs even without login (guests can join)
        return res.sendFile(path.join(__dirname, STATIC_DIR, 'index.html'));
    }

    const isPublicCode = /^[A-Z0-9]{6}$/i.test(roomCode);
    const isPrivateCode = /^[A-Z0-9]{32}$/i.test(roomCode);

    if (ENABLE_TORRENTS && isPublicCode) {
        return res.redirect(`https://tosync.org/${roomCode}`);
    }
    if (!ENABLE_TORRENTS && isPrivateCode) {
        return res.redirect(`https://app.tosync.org/${roomCode}`);
    }

    res.redirect('/');
});

app.get('/api/library/:roomId', (req, res) => {
    try {
        const { roomId } = req.params;
        const { videosDir } = ensureRoomDirectories(roomId);

        const library = { uploads: [], downloads: [] };

        if (fs.existsSync(videosDir)) {
            const videoFiles = fs.readdirSync(videosDir);
            videoFiles.forEach(filename => {
                const filePath = path.join(videosDir, filename);
                const stats = fs.statSync(filePath);

                if (stats.isFile()) {
                    const ext = path.extname(filename).toLowerCase();
                    if (['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v'].includes(ext)) {
                        library.uploads.push({
                            filename: filename,
                            originalName: filename,
                            size: stats.size,
                            url: `/rooms/${roomId}/videos/${filename}`,
                            type: 'video',
                            addedAt: stats.mtime
                        });
                    }
                }
            });

            library.uploads.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
        }

        res.json(library);
    } catch (error) {
        console.error('Error getting library:', error);
        res.status(500).json({ error: 'Failed to get library' });
    }
});

app.get('/api/stats', (req, res) => {
    res.json({
        instance: ENABLE_TORRENTS ? 'private' : 'public',
        uptime: process.uptime(),
        rooms: rooms.size,
        users: users.size,
        torrents: ENABLE_TORRENTS ? activeTorrents?.size || 0 : 0
    });
});

server.listen(PORT, () => {
    console.log(`\nToSync ${ENABLE_TORRENTS ? 'Private' : 'Public'} running on port ${PORT}\n`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    if (ENABLE_TORRENTS && torrentClient) {
        torrentClient.destroy();
    }
    server.close(() => process.exit(0));
});
