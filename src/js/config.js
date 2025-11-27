// config.js - Application configuration
// ENABLE_TORRENTS will be set by the build process

export const config = {
    SERVER_URL: window.location.origin,
    SYNC_THROTTLE_DELAY: 200,
    ROOM_CODE_LENGTH: 6,  // Will be overridden for private site
    MAX_FILE_SIZE: 10 * 1024 * 1024 * 1024, // 10GB
    MAX_SUBTITLE_SIZE: 5 * 1024 * 1024, // 5MB
    UPLOAD_TIMEOUT: 10 * 60 * 1000, // 10 minutes
    SUBTITLE_TIMEOUT: 30 * 1000, // 30 seconds
    TORRENT_UPDATE_INTERVAL: 1000, // 1 second
    SYNC_TOLERANCE: 1.0, // seconds
    ENABLE_TORRENTS: false  // Default false, will be set by build
};
