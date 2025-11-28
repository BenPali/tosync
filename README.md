# Tosync

Watch videos together with friends and family in synchronization.
Website: https://tosync.org

## Features

- **Real-time synchronization** - Play, pause, and seek actions are synced across all connected users
- **Room-based sessions** - Create or join rooms with unique 6-character codes
- **File uploads** - Upload video files up to 10GB directly to the server
- **Torrent streaming** - Stream videos directly from magnet links (server-side)
- **Subtitle support** - Upload and sync subtitles in SRT, VTT, ASS, SSA, and SUB formats
- **File library** - Browse and play previously uploaded or downloaded content

## Quick Start

Use https://tosync.org or follow these steps for local use:

1. **Install dependencies**
   ```bash
   npm install
   ```

2. ** Build & Start the server**
2.1 ** Public app **
   ```bash
   npm run build
   npm run start
   ```

2.1 ** Advanced app (requires login) **
   ```bash
   npm run build
   npm run start:torrent
   ```


3. **Open in browser**
   Public
   ```
   http://localhost:3000
   ```
   Advanced
   ```
   http://localhost:3001
   ```

## Usage

1. **Create or join a room** - Create a new room as admin or join an existing one with a room code
2. **Upload content** - Admins can upload files or use magnet links
3. **Share the room** - Friends join using the 6-character room code or URL
4. **Watch together** - All playback actions are automatically synchronized

## TODO
- Fetch subtitles automatically from an API source rather than uploading them manually
- Fix minor issues related to video player
- Vulnerability analysis and patching for uploads and torrents

## License

MIT License - see LICENSE file for details.

---

**Made with ❤️ by Ben Pali**
