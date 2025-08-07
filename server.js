// server.js - Enhanced Tosync Backend Server
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import WebTorrent from 'webtorrent';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import subtitle from 'subtitle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// WebTorrent client for server-side torrent handling
const torrentClient = new WebTorrent();
const activeTorrents = new Map();

// Create rooms base directory if it doesn't exist
const roomsDir = path.join(__dirname, 'rooms');
if (!fs.existsSync(roomsDir)) {
    fs.mkdirSync(roomsDir);
}

// Helper function to ensure room directories exist
function ensureRoomDirectories(roomId) {
    const roomDir = path.join(roomsDir, roomId);
    const videosDir = path.join(roomDir, 'videos');
    const subtitlesDir = path.join(roomDir, 'subtitles');

    if (!fs.existsSync(roomDir)) {
        fs.mkdirSync(roomDir, { recursive: true });
    }
    if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
    }
    if (!fs.existsSync(subtitlesDir)) {
        fs.mkdirSync(subtitlesDir, { recursive: true });
    }

    return { roomDir, videosDir, subtitlesDir };
}

// Configure multer for file uploads with room-based storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomId = req.query.roomId;
        if (!roomId) {
            return cb(new Error('Room ID is required'));
        }

        const isSubtitle = file.mimetype === 'application/x-subrip';
        const folder = isSubtitle ? 'subtitles' : 'videos';
        const uploadPath = path.join(roomsDir, roomId, folder);

        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const isSubtitle = file.mimetype === 'application/x-subrip';
        const filename = isSubtitle ? 'subtitle.srt' : file.originalname;
        cb(null, filename);
    }
});


const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 * 1024 // 10GB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /mp4|mkv|avi|webm|mov|flv|wmv|m4v/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('video/');

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only video files are allowed!'));
        }
    }
});

// Configure multer for subtitle uploads with room-based storage
const subtitleStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const roomId = req.body.roomId || req.query.roomId;
        if (!roomId) {
            return cb(new Error('Room ID is required'));
        }
        const { subtitlesDir } = ensureRoomDirectories(roomId);
        cb(null, subtitlesDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const subtitleUpload = multer({
    storage: subtitleStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit for subtitle files
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /srt|vtt|ass|ssa|sub/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype === 'text/plain' || file.mimetype === 'application/x-subrip' ||
            file.mimetype === 'text/vtt' || file.mimetype === 'application/x-subrip';

        if (mimetype || extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only subtitle files are allowed! (.srt, .vtt, .ass, .ssa, .sub)'));
        }
    }
});

// Enhanced CORS middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve room-based video files
app.use('/rooms/:roomId/videos', (req, res, next) => {
    const roomId = req.params.roomId;
    const videosDir = path.join(roomsDir, roomId, 'videos');
    if (fs.existsSync(videosDir)) {
        express.static(videosDir)(req, res, next);
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Serve subtitle files with conversion and proper MIME types
app.use('/rooms/:roomId/subtitles/:filename', async (req, res, next) => {
    try {
        // Set CORS headers
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');

        // Handle OPTIONS requests
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        const { roomId, filename } = req.params;
        const subtitlesDir = path.join(roomsDir, roomId, 'subtitles');
        const filePath = path.join(subtitlesDir, filename);
        const ext = path.extname(filename).toLowerCase();

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Subtitle file not found' });
        }

        // Always serve as WebVTT for browser compatibility
        res.header('Content-Type', 'text/vtt; charset=utf-8');

        // If it's an SRT file, convert it to VTT
        if (ext === '.srt') {
            try {
                console.log(`Converting SRT to VTT: ${filename} in room ${roomId}`);

                // Read the SRT file
                const srtContent = fs.readFileSync(filePath, 'utf8');

                // Use the fallback conversion which is more reliable
                const vttContent = convertSrtToVttFallback(srtContent);

                console.log(`Successfully converted SRT to VTT: ${filename}`);

                // Send the converted content
                res.send(vttContent);

            } catch (conversionError) {
                console.error(`Error converting SRT to VTT for ${filename}:`, conversionError);
                res.status(500).json({ error: 'Failed to convert subtitle file' });
            }
        } else if (ext === '.vtt') {
            // Already VTT, serve directly
            const vttContent = fs.readFileSync(filePath, 'utf8');
            res.send(vttContent);
        } else {
            // For other formats, try to convert or serve as-is
            const content = fs.readFileSync(filePath, 'utf8');

            if (ext === '.ass' || ext === '.ssa') {
                // For ASS/SSA, serve as plain text (browsers might not support these)
                res.header('Content-Type', 'text/plain; charset=utf-8');
                res.send(content);
            } else {
                // For other formats, try to serve as VTT
                res.send(content);
            }
        }

    } catch (error) {
        console.error('Error serving subtitle file:', error);
        res.status(500).json({ error: 'Failed to serve subtitle file' });
    }
});

// Fallback SRT to VTT conversion function
function convertSrtToVttFallback(srtContent) {
    try {
        // Start with WEBVTT header
        let vttContent = 'WEBVTT\n\n';

        // Normalize line endings
        const normalizedSrt = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Split into subtitle blocks (handling various formats)
        const blocks = normalizedSrt.split(/\n\n+/).filter(block => block.trim());

        blocks.forEach(block => {
            const lines = block.split('\n').filter(line => line.trim());

            if (lines.length >= 2) {
                // Find the timestamp line (contains --> )
                let timestampIndex = lines.findIndex(line => line.includes('-->'));

                if (timestampIndex !== -1) {
                    const timestampLine = lines[timestampIndex];
                    const subtitleLines = lines.slice(timestampIndex + 1);

                    // Convert timestamp format from SRT (,) to VTT (.)
                    const convertedTimestamp = timestampLine
                        .replace(/,/g, '.');  // Replace comma with period

                    if (subtitleLines.length > 0) {
                        vttContent += `${convertedTimestamp}\n${subtitleLines.join('\n')}\n\n`;
                    }
                }
            }
        });

        console.log(`Converted SRT to VTT, length: ${vttContent.length} chars`);
        return vttContent;

    } catch (error) {
        console.error('Fallback SRT to VTT conversion failed:', error);
        // Return minimal valid VTT if conversion fails
        return 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSubtitle conversion failed\n\n';
    }
}

// Room state management
const rooms = new Map();
const users = new Map();

// Room cleanup settings
const ROOM_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const ROOM_CLEANUP_INTERVAL = 60 * 1000; // Check every minute

// Helper function to promote next admin in room
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

        // Simple notification
        io.to(newAdmin.id).emit('admin-transferred', {
            newAdminName: newAdmin.name,
            formerAdminName: oldAdmin ? oldAdmin.name : 'Former Admin',
            isYouNewAdmin: true,
            reason: 'admin-left'
        });

        // Notify others
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

// File upload endpoint
app.post('/upload', (req, res) => {
    req.setTimeout(60 * 60 * 1000);
    res.setTimeout(60 * 60 * 1000);

    upload.single('video')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large. Maximum size is 10GB.' });
            }
            if (err.message === 'Only video files are allowed!') {
                return res.status(400).json({ error: 'Only video files are allowed.' });
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

        console.log('File uploaded successfully:', fileInfo.originalName, 'to room:', roomId);
        res.json(fileInfo);
    });
});

// Subtitle upload endpoint
app.post('/upload-subtitle', (req, res) => {
    subtitleUpload.single('subtitle')(req, res, (err) => {
        if (err) {
            console.error('Subtitle upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
            }
            if (err.message.includes('Only subtitle files are allowed')) {
                return res.status(400).json({ error: err.message });
            }
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

        console.log('Subtitle uploaded successfully:', subtitleInfo.originalName, 'to room:', roomId);
        res.json(subtitleInfo);
    });
});

// Torrent endpoints
app.post('/api/torrents/add', async (req, res) => {
    const { magnetLink, roomId } = req.body;

    if (!magnetLink || !magnetLink.startsWith('magnet:')) {
        return res.status(400).json({ error: 'Invalid magnet link' });
    }

    if (!roomId || !rooms.has(roomId)) {
        return res.status(404).json({ error: 'Room not found' });
    }

    try {
        const room = rooms.get(roomId);

        // Check if torrent already exists
        const existingTorrent = torrentClient.get(magnetLink);
        if (existingTorrent && typeof existingTorrent.ready !== 'undefined') {
            if (!existingTorrent.ready) {
                await new Promise(resolve => existingTorrent.once('ready', resolve));
            }

            return res.json({
                infoHash: existingTorrent.infoHash,
                name: existingTorrent.name || 'Unknown',
                files: existingTorrent.files.map((f, index) => ({
                    name: f.name,
                    length: f.length,
                    index: index
                }))
            });
        }

        console.log('Adding new torrent:', magnetLink);

        // Add new torrent
        const { videosDir } = ensureRoomDirectories(roomId);
        const torrent = torrentClient.add(magnetLink, {
            path: videosDir,
            strategy: 'sequential'
        });

        // Wait for torrent to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                torrent.destroy();
                reject(new Error('Timeout: Could not fetch torrent metadata.'));
            }, 60000);

            torrent.once('ready', () => {
                clearTimeout(timeout);
                console.log('Torrent ready:', torrent.name);
                resolve();
            });

            torrent.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        // Store torrent reference
        activeTorrents.set(torrent.infoHash, {
            torrent,
            roomId,
            addedAt: Date.now()
        });

        room.currentTorrent = torrent;

        // Find video files
        const videoFiles = torrent.files.filter(file => {
            const ext = path.extname(file.name).toLowerCase();
            return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.mpg', '.mpeg'].includes(ext);
        });

        console.log(`Found ${videoFiles.length} video files in torrent`);

        res.json({
            infoHash: torrent.infoHash,
            name: torrent.name || 'Unknown',
            files: videoFiles.map(f => ({
                name: f.name,
                length: f.length,
                index: torrent.files.indexOf(f)
            })),
            totalLength: torrent.length || 0,
            pieceLength: torrent.pieceLength || 0
        });

    } catch (error) {
        console.error('Error adding torrent:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get torrent status
app.get('/api/torrents/:infoHash/status', (req, res) => {
    const { infoHash } = req.params;
    const torrentInfo = activeTorrents.get(infoHash);

    if (!torrentInfo) {
        return res.status(404).json({ error: 'Torrent not found' });
    }

    const { torrent } = torrentInfo;

    res.json({
        infoHash: torrent.infoHash,
        name: torrent.name || 'Unknown',
        progress: torrent.progress || 0,
        downloadSpeed: torrent.downloadSpeed || 0,
        uploadSpeed: torrent.uploadSpeed || 0,
        numPeers: torrent.numPeers || 0,
        downloaded: torrent.downloaded || 0,
        uploaded: torrent.uploaded || 0,
        ratio: torrent.ratio || 0,
        timeRemaining: torrent.timeRemaining || Infinity,
        done: torrent.done || false
    });
});

// Stream video file
app.get('/api/torrents/:infoHash/files/:fileIndex/stream', (req, res) => {
    const { infoHash, fileIndex } = req.params;
    const torrentInfo = activeTorrents.get(infoHash);

    if (!torrentInfo) {
        return res.status(404).json({ error: 'Torrent not found' });
    }

    const file = torrentInfo.torrent.files[parseInt(fileIndex)];
    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }

    console.log(`Streaming file: ${file.name}`);

    const ext = path.extname(file.name).toLowerCase();
    const contentType = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.m4v': 'video/x-m4v',
        '.mpg': 'video/mpeg',
        '.mpeg': 'video/mpeg'
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
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    } else {
        res.setHeader('Content-Length', file.length);
        const stream = file.createReadStream();
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });

    // User joins room
    socket.on('join-room', (userData) => {
        try {
            const { roomId, userName, userRole, isCreator } = userData;

            if (!roomId || roomId.length !== 6) {
                socket.emit('error', { message: 'Invalid room code' });
                return;
            }

            // Create room if it doesn't exist
            if (!rooms.has(roomId)) {
                if (isCreator || userRole === 'admin') {
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
                    console.log(`Room created: ${roomId}`);
                } else {
                    socket.emit('room-not-found');
                    return;
                }
            }

            const room = rooms.get(roomId);

            // CRITICAL: Clean up any existing user with this socket ID first
            if (users.has(socket.id)) {
                const oldUser = users.get(socket.id);
                console.log(`Cleaning up existing user ${oldUser.name} for socket ${socket.id}`);

                // Remove from old room if different
                if (oldUser.room && oldUser.room !== roomId && rooms.has(oldUser.room)) {
                    const oldRoom = rooms.get(oldUser.room);
                    oldRoom.users.delete(socket.id);
                    console.log(`Removed user from old room: ${oldUser.room}`);
                }

                // Remove from current room
                if (room.users.has(socket.id)) {
                    room.users.delete(socket.id);
                    console.log(`Removed user from current room: ${roomId}`);
                }

                users.delete(socket.id);
            }

            // Also remove from current room if exists (double safety)
            if (room.users.has(socket.id)) {
                room.users.delete(socket.id);
            }

            socket.join(roomId);

            // Create fresh user object with join timestamp for admin succession
            const uniqueName = generateUniqueName(userName, room.users, socket.id);
            const user = {
                id: socket.id,
                name: uniqueName,
                role: userRole,
                room: roomId,
                joinedAt: new Date()
            };


            // Add user to maps
            users.set(socket.id, user);
            room.users.set(socket.id, user);
            room.lastActivity = Date.now();

            // Set admin if appropriate
            if (userRole === 'admin' && (!room.adminId || isCreator)) {
                room.adminId = socket.id;
            }

            console.log(`${user.name} (${userRole}) joined room: ${roomId} [Socket: ${socket.id}] at ${user.joinedAt}`);

            // Send room state to new user
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

            // Notify others
            socket.to(roomId).emit('user-joined', {
                user: user,
                userCount: room.users.size
            });

            // Send clean users list to everyone
            io.to(roomId).emit('users-update', {
                users: Array.from(room.users.values()),
                userCount: room.users.size
            });

        } catch (error) {
            console.error('Error in join-room:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });


    // Handle video actions
    socket.on('video-action', (data) => {
        try {
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

            console.log(`${user.name} performed: ${action} at ${time}s in room ${user.room}`);
        } catch (error) {
            console.error('Error in video-action:', error);
        }
    });

    // Handle media actions
    socket.on('media-action', (data) => {
        try {
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
                        // Note: We don't destroy the torrent here as it might be used by other rooms
                        room.currentTorrent = null;
                    }
                    break;
            }

            io.to(user.room).emit('media-update', {
                action: action,
                mediaData: room.currentMedia,
                user: user.name
            });

            console.log(`${user.name} performed media action: ${action} in room ${user.room}`);
        } catch (error) {
            console.error('Error in media-action:', error);
            socket.emit('error', { message: 'Failed to perform media action' });
        }
    });

    // Handle torrent status updates
    socket.on('torrent-status', (data) => {
        try {
            const user = users.get(socket.id);
            if (!user) return;

            socket.to(user.room).emit('torrent-progress', data);
        } catch (error) {
            console.error('Error in torrent-status:', error);
        }
    });

    // Handle force sync
    socket.on('force-sync', (data) => {
        try {
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

            console.log(`${user.name} forced sync at ${data.time}s in room ${user.room}`);
        } catch (error) {
            console.error('Error in force-sync:', error);
        }
    });

    // Handle subtitle upload
    socket.on('subtitle-upload', (data) => {
        try {
            const user = users.get(socket.id);
            if (!user || user.role !== 'admin') return;

            const room = rooms.get(user.room);
            if (!room) return;

            room.lastActivity = Date.now();

            // Add subtitle to room's subtitle list
            room.subtitles.push(data.subtitle);

            // Broadcast to all users in the room
            io.to(user.room).emit('subtitle-added', {
                subtitle: data.subtitle,
                user: user.name
            });

            console.log(`${user.name} added subtitle: ${data.subtitle.label} in room ${user.room}`);
        } catch (error) {
            console.error('Error in subtitle-upload:', error);
        }
    });

    // Handle subtitle selection
    socket.on('subtitle-select', (data) => {
        try {
            const user = users.get(socket.id);
            if (!user) return;

            const room = rooms.get(user.room);
            if (!room) return;

            room.lastActivity = Date.now();

            // Broadcast subtitle selection to other users
            socket.to(user.room).emit('subtitle-selected', {
                subtitleId: data.subtitleId,
                user: user.name
            });

            console.log(`${user.name} selected subtitle: ${data.subtitleId} in room ${user.room}`);
        } catch (error) {
            console.error('Error in subtitle-select:', error);
        }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
        try {
            console.log(`User ${socket.id} disconnected. Reason: ${reason}`);

            const user = users.get(socket.id);
            if (user) {
                const room = rooms.get(user.room);
                if (room) {
                    const wasAdmin = room.adminId === socket.id;

                    // Remove user from room
                    room.users.delete(socket.id);
                    room.lastActivity = Date.now();

                    // Handle admin promotion if needed
                    if (wasAdmin && room.users.size > 0) {
                        console.log(`Admin ${user.name} left. Promoting next admin...`);
                        promoteNextAdmin(room, socket.id);
                    } else if (wasAdmin) {
                        room.adminId = null;
                    }

                    // Notify remaining users
                    socket.to(user.room).emit('user-left', {
                        user: user,
                        userCount: room.users.size
                    });

                    // Update users list
                    if (room.users.size > 0) {
                        socket.to(user.room).emit('users-update', {
                            users: Array.from(room.users.values()),
                            userCount: room.users.size
                        });
                    }

                    console.log(`${user.name} left room ${user.room}. Admin: ${room.adminId}`);
                }

                users.delete(socket.id);
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });

    // Handle admin transfer
    socket.on('transfer-admin', (data) => {
        try {
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

            // Find the target user in the room by name
            const targetUser = Array.from(room.users.values())
                .find(u => u.name === targetUserName && u.role === 'guest');

            if (!targetUser) {
                socket.emit('transfer-admin-error', { message: 'Target user not found or is already an admin' });
                return;
            }

            // Update roles
            user.role = 'guest';
            targetUser.role = 'admin';
            room.adminId = targetUser.id;
            room.lastActivity = Date.now();

            // Update users map
            users.set(user.id, user);
            users.set(targetUser.id, targetUser);

            console.log(`Admin transferred from ${user.name} to ${targetUser.name} in room ${user.room}`);

            // Send specific notifications to the involved users
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

            // Notify other users in the room (excluding the two involved)
            socket.to(user.room).emit('admin-transferred', {
                newAdminName: targetUser.name,
                formerAdminName: user.name,
                isYouFormerAdmin: false,
                isYouNewAdmin: false,
                reason: 'manual-transfer'
            });

            // Update users list for all clients
            io.to(user.room).emit('users-update', {
                users: Array.from(room.users.values()),
                userCount: room.users.size
            });

        } catch (error) {
            console.error('Error in transfer-admin:', error);
            socket.emit('transfer-admin-error', { message: 'Failed to transfer admin rights' });
        }
    });

    // Handle user kick
    socket.on('kick-user', (data) => {
        try {
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

            // Find the target user in the room by name
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

            // Remove user from room and users map
            room.users.delete(targetUser.id);
            users.delete(targetUser.id);
            room.lastActivity = Date.now();

            console.log(`${targetUser.name} was kicked from room ${admin.room} by ${admin.name}`);

            // Notify the kicked user
            io.to(targetUser.id).emit('user-kicked', {
                kickedUserName: targetUser.name,
                kickedByAdmin: admin.name,
                isYouKicked: true
            });

            // Disconnect the kicked user
            const kickedSocket = io.sockets.sockets.get(targetUser.id);
            if (kickedSocket) {
                kickedSocket.disconnect(true);
            }

            // Notify remaining users in the room
            socket.to(admin.room).emit('user-kicked', {
                kickedUserName: targetUser.name,
                kickedByAdmin: admin.name,
                isYouKicked: false
            });

            // Update users list for remaining clients
            io.to(admin.room).emit('users-update', {
                users: Array.from(room.users.values()),
                userCount: room.users.size
            });

            // Send confirmation to admin
            socket.emit('user-kicked', {
                kickedUserName: targetUser.name,
                kickedByAdmin: admin.name,
                isYouKicked: false
            });

        } catch (error) {
            console.error('Error in kick-user:', error);
            socket.emit('kick-user-error', { message: 'Failed to kick user' });
        }
    });
});

// Room cleanup function
function cleanupInactiveRooms() {
    const now = Date.now();
    const roomsToDelete = [];

    rooms.forEach((room, roomId) => {
        // Check if room is empty and has been inactive
        if (room.users.size === 0 && (now - room.lastActivity) > ROOM_INACTIVITY_TIMEOUT) {
            roomsToDelete.push(roomId);
        }
    });

    roomsToDelete.forEach(roomId => {
        const room = rooms.get(roomId);

        // Clean up any torrents associated with this room
        if (room.currentTorrent) {
            // Check if torrent is used by other rooms
            let torrentUsedElsewhere = false;
            rooms.forEach((otherRoom, otherRoomId) => {
                if (otherRoomId !== roomId && otherRoom.currentTorrent === room.currentTorrent) {
                    torrentUsedElsewhere = true;
                }
            });

            if (!torrentUsedElsewhere) {
                // Safe to destroy the torrent
                room.currentTorrent.destroy({ destroyStore: true });
            }
        }

        // Delete room folder immediately (room has already been inactive for 5 minutes)
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

// Set up periodic room cleanup
setInterval(cleanupInactiveRooms, ROOM_CLEANUP_INTERVAL);

// API endpoints
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route for room URLs
app.get('/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;

    // Validate room code format (6 characters)
    if (roomCode && roomCode.length === 6) {
        // Serve the main index.html, the client will handle the room joining
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        // Invalid room code, redirect to home
        res.redirect('/');
    }
});

// Get file library for a specific room
app.get('/api/library/:roomId', (req, res) => {
    try {
        const { roomId } = req.params;
        const { videosDir, subtitlesDir } = ensureRoomDirectories(roomId);

        const library = {
            uploads: [],  // All videos are now in the same folder
            downloads: []  // Keep structure for compatibility, but both will scan same folder
        };

        // Scan room's videos directory (contains both uploads and downloads)
        if (fs.existsSync(videosDir)) {
            const videoFiles = fs.readdirSync(videosDir);
            videoFiles.forEach(filename => {
                const filePath = path.join(videosDir, filename);
                const stats = fs.statSync(filePath);

                if (stats.isFile()) {
                    const ext = path.extname(filename).toLowerCase();
                    if (['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.mpg', '.mpeg'].includes(ext)) {
                        const fileInfo = {
                            filename: filename,
                            originalName: filename.replace(/^\d+-\d+-/, ''),
                            size: stats.size,
                            url: `/rooms/${roomId}/videos/${filename}`,
                            type: 'video',
                            addedAt: stats.mtime
                        };

                        // For backward compatibility, add to both arrays
                        // You can later update the client to use a single array
                        library.uploads.push(fileInfo);
                    }
                }
            });

            // Also check for torrent folders (they might create subfolders)
            const items = fs.readdirSync(videosDir);
            items.forEach(item => {
                const itemPath = path.join(videosDir, item);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    // This might be a torrent folder
                    try {
                        const files = fs.readdirSync(itemPath);
                        files.forEach(filename => {
                            const filePath = path.join(itemPath, filename);
                            const fileStats = fs.statSync(filePath);

                            if (fileStats.isFile()) {
                                const ext = path.extname(filename).toLowerCase();
                                if (['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.mpg', '.mpeg'].includes(ext)) {
                                    library.downloads.push({
                                        filename: filename,
                                        originalName: filename,
                                        folderName: item,
                                        size: fileStats.size,
                                        url: `/rooms/${roomId}/videos/${encodeURIComponent(item)}/${encodeURIComponent(filename)}`,
                                        type: 'download',
                                        addedAt: fileStats.mtime
                                    });
                                }
                            }
                        });
                    } catch (error) {
                        console.error(`Error reading folder ${item}:`, error);
                    }
                }
            });
        }

        // Sort by date (newest first)
        library.uploads.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
        library.downloads.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

        res.json(library);
    } catch (error) {
        console.error('Error getting library:', error);
        res.status(500).json({ error: 'Failed to get library' });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const roomStats = Array.from(rooms.entries()).map(([roomId, room]) => ({
            roomId,
            userCount: room.users.size,
            hasMedia: !!room.currentMedia,
            adminPresent: !!room.adminId,
            hasTorrent: !!room.currentTorrent,
            createdAt: room.createdAt,
            lastActivity: room.lastActivity,
            currentAdmin: room.adminId ? room.users.get(room.adminId)?.name : null
        }));

        res.json({
            totalUsers: users.size,
            totalRooms: rooms.size,
            activeRooms: roomStats.filter(r => r.userCount > 0).length,
            rooms: roomStats,
            activeTorrents: activeTorrents.size,
            uptime: process.uptime()
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Clean up old torrents periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 3 * 60 * 60 * 1000; // 3 hours

    activeTorrents.forEach((info, hash) => {
        if (now - info.addedAt > maxAge && info.torrent.done) {
            // Check if torrent is still in use by any room
            let inUse = false;
            rooms.forEach(room => {
                if (room.currentTorrent && room.currentTorrent.infoHash === hash) {
                    inUse = true;
                }
            });

            if (!inUse) {
                info.torrent.destroy({ destroyStore: true });
                activeTorrents.delete(hash);
                console.log(`Cleaned up old torrent: ${hash}`);
            }
        }
    });
}, 60 * 60 * 1000);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎬 Tosync Server running on port ${PORT}`);
    console.log(`📡 WebSocket server ready for connections`);
    console.log(`🌐 Access at: http://localhost:${PORT}`);
    console.log(`🧲 WebTorrent support enabled`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    // Destroy all torrents
    activeTorrents.forEach(({ torrent }) => {
        torrent.destroy({ destroyStore: true });
    });

    torrentClient.destroy(() => {
        console.log('WebTorrent client destroyed');
    });

    io.close((err) => {
        if (err) {
            console.error('Error closing socket.io:', err);
        } else {
            console.log('Socket.io connections closed');
        }

        server.close((err) => {
            if (err) {
                console.error('Error closing server:', err);
                process.exit(1);
            } else {
                console.log('HTTP server closed');
                console.log('Tosync server shut down gracefully');
                process.exit(0);
            }
        });
    });

    setTimeout(() => {
        console.error('Forced shutdown after 10 seconds');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});