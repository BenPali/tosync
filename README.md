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

2. **Start the server**
   ```bash
   npm start
   ```

3. **Open in browser**
   ```
   http://localhost:3000
   ```

## Usage

1. **Create or join a room** - Create a new room as admin or join an existing one with a room code
2. **Upload content** - Admins can upload files or use magnet links
3. **Share the room** - Friends join using the 6-character room code or URL
4. **Watch together** - All playback actions are automatically synchronized

## Room Management

Tosync now uses a **room-based system**:
- **Create rooms** - Anyone can create a new room and become the admin automatically
- **Join rooms** - Enter a 6-character room code or paste the room URL to join
- **No passwords needed** - Room creators are automatically made admins
- **Admin succession** - If an admin leaves, the next user is automatically promoted

## TODO
- Fetch subtitles automatically from an API source rather than uploading them manually
- Fix minor issues related to video player

## Legal Notice

⚠️ **Important**: Users are solely responsible for the content they stream via torrent links. This platform does not host, store, or distribute any copyrighted content. Please ensure you have the legal right to access and share any content you use.

## License

MIT License - see LICENSE file for details.

---

**Made with ❤️ by Ben Pali**