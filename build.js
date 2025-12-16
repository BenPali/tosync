import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const VERSION = pkg.version;

console.log(`ToSync Build Script v${VERSION}\n`);

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created: ${dir}`);
    }
}

function copyFile(src, dest, label = '', replacements = {}) {
    if (!fs.existsSync(src)) {
        console.log(`  ! Missing: ${src}`);
        return false;
    }

    let content = fs.readFileSync(src, 'utf8');

    // Replace placeholders
    for (const [key, value] of Object.entries(replacements)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        content = content.replace(regex, value);
    }

    fs.writeFileSync(dest, content);
    console.log(`  ✓  ${label || path.basename(src)}`);
    return true;
}

function copyDir(src, dest, exclude = []) {
    if (!fs.existsSync(src)) {
        console.log(`  ! Missing directory: ${src}`);
        return;
    }
    ensureDir(dest);
    const files = fs.readdirSync(src);
    files.forEach(file => {
        if (exclude.includes(file)) {
            console.log(`  X  Excluded: ${file}`);
            return;
        }
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, exclude);
        } else {
            copyFile(srcPath, destPath);
        }
    });
}

function buildPublic() {
    console.log('═══════════════════════════════════════');
    console.log('  Building PUBLIC');
    console.log('═══════════════════════════════════════\n');

    const dest = 'public';

    // Read ROOM_CODE_LENGTH from config
    const configContent = fs.readFileSync('src/js/config.public.js', 'utf8');
    const roomCodeLengthMatch = configContent.match(/ROOM_CODE_LENGTH:\s*(\d+)/);
    const roomCodeLength = roomCodeLengthMatch ? roomCodeLengthMatch[1] : '6';
    const replacements = { ROOM_CODE_LENGTH: roomCodeLength, VERSION: VERSION };

    ensureDir(dest);
    ensureDir(path.join(dest, 'js'));
    ensureDir(path.join(dest, 'js', 'modules'));

    copyFile('src/index.public.html', path.join(dest, 'index.html'), 'index.html', replacements);
    copyFile('src/styles.css', path.join(dest, 'styles.css'));
    copyFile('src/js/config.public.js', path.join(dest, 'js', 'config.js'), 'config.js');
    copyFile('src/js/state.js', path.join(dest, 'js', 'state.js'));
    copyFile('src/js/main.js', path.join(dest, 'js', 'main.js'), 'main.js');

    console.log('\n  Modules (excluding torrentManager.js):');
    copyDir('src/js/modules', path.join(dest, 'js', 'modules'), ['torrentManager.js']);

    console.log('\n  ✅ Public build complete\n');
}

function buildPrivate() {
    console.log('═══════════════════════════════════════');
    console.log('  Building PRIVATE');
    console.log('═══════════════════════════════════════\n');

    const dest = 'private';

    // Read ROOM_CODE_LENGTH from config
    const configContent = fs.readFileSync('src/js/config.private.js', 'utf8');
    const roomCodeLengthMatch = configContent.match(/ROOM_CODE_LENGTH:\s*(\d+)/);
    const roomCodeLength = roomCodeLengthMatch ? roomCodeLengthMatch[1] : '32';
    const replacements = { ROOM_CODE_LENGTH: roomCodeLength, VERSION: VERSION };

    ensureDir(dest);
    ensureDir(path.join(dest, 'js'));
    ensureDir(path.join(dest, 'js', 'modules'));

    copyFile('src/index.private.html', path.join(dest, 'index.html'), 'index.html', replacements);
    copyFile('src/login.html', path.join(dest, 'login.html'), 'login.html', replacements);
    copyFile('src/styles.css', path.join(dest, 'styles.css'));
    copyFile('src/js/config.private.js', path.join(dest, 'js', 'config.js'), 'config.js');
    copyFile('src/js/state.js', path.join(dest, 'js', 'state.js'));
    copyFile('src/js/main.js', path.join(dest, 'js', 'main.js'), 'main.js');

    console.log('\n  Modules (ALL files):');
    copyDir('src/js/modules', path.join(dest, 'js', 'modules'), []);

    console.log('\n  ✅ Private build complete\n');
}

function verify() {
    console.log('═══════════════════════════════════════');
    console.log('  Verification');
    console.log('═══════════════════════════════════════\n');

    let passed = true;

    // Verify torrentManager.js is EXCLUDED from public build
    const publicTorrent = path.join('public', 'js', 'modules', 'torrentManager.js');
    if (fs.existsSync(publicTorrent)) {
        console.log('  ❌ PUBLIC has torrentManager.js');
        passed = false;
    } else {
        console.log('  ✓ PUBLIC is clean');
    }

    const privateTorrent = path.join('private', 'js', 'modules', 'torrentManager.js');
    if (!fs.existsSync(privateTorrent)) {
        console.log('  ❌ PRIVATE missing torrentManager.js');
        passed = false;
    } else {
        console.log('  ✓ PRIVATE includes torrentManager.js');
    }

    // Verify public HTML has no torrent UI
    const publicHtml = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
    if (publicHtml.includes('torrentInput') || publicHtml.includes('loadTorrentBtn')) {
        console.log('  ❌ PUBLIC HTML has torrent UI elements');
        passed = false;
    } else {
        console.log('  ✓ PUBLIC HTML clean (no torrent UI)');
    }

    // Verify public config has ENABLE_TORRENTS: false
    const publicConfig = fs.readFileSync(path.join('public', 'js', 'config.js'), 'utf8');
    if (!publicConfig.includes('ENABLE_TORRENTS: false')) {
        console.log('  ❌ PUBLIC config.js missing ENABLE_TORRENTS: false');
        passed = false;
    } else {
        console.log('  ✓ PUBLIC config.js has ENABLE_TORRENTS: false');
    }

    // Verify private config has ENABLE_TORRENTS: true
    const privateConfig = fs.readFileSync(path.join('private', 'js', 'config.js'), 'utf8');
    if (!privateConfig.includes('ENABLE_TORRENTS: true')) {
        console.log('  ❌ PRIVATE config.js missing ENABLE_TORRENTS: true');
        passed = false;
    } else {
        console.log('  ✓ PRIVATE config.js has ENABLE_TORRENTS: true');
    }

    // Verify private has login.html
    if (!fs.existsSync(path.join('private', 'login.html'))) {
        console.log('  ❌ PRIVATE missing login.html');
        passed = false;
    } else {
        console.log('  ✓ PRIVATE has login.html');
    }

    console.log('');
    return passed;
}

buildPublic();
buildPrivate();
const success = verify();

console.log('═══════════════════════════════════════');
console.log(success ? '  ✅ BUILD SUCCESSFUL' : '  ❌ BUILD FAILED');
console.log('═══════════════════════════════════════\n');

if (!success) process.exit(1);
