# Tosync

Watch videos together with friends and family in synchronization.
Website: https://tosync.org

## Features

- **Real-time synchronization** - Play, pause, and seek actions are synced across all connected users
- **File uploads** - Upload video files up to 10GB directly to the server
- **Torrent streaming** - Stream videos directly from magnet links (server-side)
- **Subtitle support** - Upload and sync subtitles in SRT, VTT, ASS, SSA, and SUB formats
- **Role-based access** - Admin controls for content management, guest access for viewing
- **File library** - Browse and play previously uploaded or downloaded content

## Quick Start

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

1. **Choose your role** - Select Admin (with password) or Guest access
2. **Upload a video** - Admins can upload files or use magnet links
3. **Share the link** - Friends join using the same URL
4. **Watch together** - All playback actions are automatically synchronized

## Admin Password

The default admin password is `admin123`. Change this in `script.js`:

```javascript
const ADMIN_PASSWORD = "your-new-password";
```

## TODO
- Recycle content more efficiently
- Fetch subtitles automatically from an API source rather than uploading them manually
- Create "rooms" in order to have multiple broadcastings simultaneously
- Rethink the admin system

## Legal Notice

⚠️ **Important**: Users are solely responsible for the content they stream via torrent links. This platform does not host, store, or distribute any copyrighted content. Please ensure you have the legal right to access and share any content you use.

## License

MIT License - see LICENSE file for details.

---

**Made with ❤️ by Ben Pali**
