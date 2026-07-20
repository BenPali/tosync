import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const VERSION = pkg.version;

console.log(`ToSync Build Script v${VERSION}\n`);

const TAILWIND_CLI = path.join(__dirname, 'node_modules', '.bin', 'tailwindcss');

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
    files.forEach((file) => {
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

function compileTailwind(variant, outPath) {
    const input = path.join('src', `tailwind.${variant}.css`);
    execFileSync(TAILWIND_CLI, ['-c', 'tailwind.config.js', '-i', input, '-o', outPath, '--minify'], {
        stdio: ['ignore', 'inherit', 'inherit']
    });
    console.log(`  ✓  styles.css (Tailwind, ${variant})`);
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
    copyFile('src/theme.js', path.join(dest, 'theme.js'));
    compileTailwind('public', path.join(dest, 'styles.css'));
    copyFile('src/js/config.public.js', path.join(dest, 'js', 'config.js'), 'config.js');
    copyFile('src/js/state.js', path.join(dest, 'js', 'state.js'));
    copyFile('src/js/main.js', path.join(dest, 'js', 'main.js'), 'main.js');

    console.log('\n  Modules (excluding torrentManager.js, iptvManager.js):');
    copyDir('src/js/modules', path.join(dest, 'js', 'modules'), ['torrentManager.js', 'iptvManager.js']);

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
    copyFile('src/login.js', path.join(dest, 'login.js'), 'login.js', replacements);
    copyFile('src/theme.js', path.join(dest, 'theme.js'));
    compileTailwind('private', path.join(dest, 'styles.css'));
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
    const check = (ok, pass, fail) => {
        if (ok) console.log(`  ✓ ${pass}`);
        else {
            console.log(`  ❌ ${fail}`);
            passed = false;
        }
    };

    // -- Module exclusion / inclusion --
    check(
        !fs.existsSync(path.join('public', 'js', 'modules', 'torrentManager.js')),
        'PUBLIC excludes torrentManager.js',
        'PUBLIC has torrentManager.js'
    );
    check(
        fs.existsSync(path.join('private', 'js', 'modules', 'torrentManager.js')),
        'PRIVATE includes torrentManager.js',
        'PRIVATE missing torrentManager.js'
    );
    check(
        !fs.existsSync(path.join('public', 'js', 'modules', 'iptvManager.js')),
        'PUBLIC excludes iptvManager.js',
        'PUBLIC has iptvManager.js'
    );
    check(
        fs.existsSync(path.join('private', 'js', 'modules', 'iptvManager.js')),
        'PRIVATE includes iptvManager.js',
        'PRIVATE missing iptvManager.js'
    );

    // -- Compiled CSS exists --
    check(fs.existsSync(path.join('public', 'styles.css')), 'PUBLIC styles.css compiled', 'PUBLIC styles.css missing');
    check(
        fs.existsSync(path.join('private', 'styles.css')),
        'PRIVATE styles.css compiled',
        'PRIVATE styles.css missing'
    );

    const publicHtml = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
    const privateHtml = fs.readFileSync(path.join('private', 'index.html'), 'utf8');
    const loginHtml = fs.existsSync(path.join('private', 'login.html'))
        ? fs.readFileSync(path.join('private', 'login.html'), 'utf8')
        : '';

    // -- Public HTML must NOT contain torrent/IPTV markers --
    const FORBIDDEN_IN_PUBLIC = [
        'torrentInput',
        'loadTorrentBtn',
        'torrentInfo',
        'removeTorrentBtn',
        'iptvPlaylistInput',
        'loadPlaylistBtn',
        'iptvBrowser',
        'downloadedFilesList',
        'hls.js',
        'mpegts.js',
        'magnet:',
        'logoutBtn'
    ];
    for (const marker of FORBIDDEN_IN_PUBLIC) {
        check(
            !publicHtml.includes(marker),
            `PUBLIC HTML absent of "${marker}"`,
            `PUBLIC HTML leaks private-only marker "${marker}"`
        );
    }

    // -- Private HTML must contain the private-only markers --
    const REQUIRED_IN_PRIVATE = [
        'torrentInput',
        'loadTorrentBtn',
        'iptvPlaylistInput',
        'loadPlaylistBtn',
        'logoutBtn',
        'landingPage'
    ];
    for (const marker of REQUIRED_IN_PRIVATE) {
        check(privateHtml.includes(marker), `PRIVATE HTML has "${marker}"`, `PRIVATE HTML missing "${marker}"`);
    }

    // -- No Tailwind CDN reference in any build --
    for (const [label, html] of [
        ['PUBLIC', publicHtml],
        ['PRIVATE', privateHtml],
        ['LOGIN', loginHtml]
    ]) {
        if (!html) continue;
        check(
            !html.includes('cdn.tailwindcss.com'),
            `${label} HTML has no Tailwind CDN`,
            `${label} HTML still references cdn.tailwindcss.com`
        );
    }

    // -- Every CDN <script src="https://..."> tag has integrity="..." --
    const cdnScriptRe = /<script\s+[^>]*src=["']https:\/\/[^"']+["'][^>]*>/gi;
    for (const [label, html] of [
        ['PUBLIC', publicHtml],
        ['PRIVATE', privateHtml],
        ['LOGIN', loginHtml]
    ]) {
        if (!html) continue;
        const tags = html.match(cdnScriptRe) || [];
        for (const tag of tags) {
            check(
                tag.includes('integrity='),
                `${label} CDN script has SRI: ${tag.slice(0, 80)}…`,
                `${label} CDN script missing SRI: ${tag}`
            );
        }
    }

    // -- Config sanity --
    const publicConfig = fs.readFileSync(path.join('public', 'js', 'config.js'), 'utf8');
    check(
        publicConfig.includes('ENABLE_TORRENTS: false'),
        'PUBLIC config has ENABLE_TORRENTS: false',
        'PUBLIC config missing ENABLE_TORRENTS: false'
    );
    const privateConfig = fs.readFileSync(path.join('private', 'js', 'config.js'), 'utf8');
    check(
        privateConfig.includes('ENABLE_TORRENTS: true'),
        'PRIVATE config has ENABLE_TORRENTS: true',
        'PRIVATE config missing ENABLE_TORRENTS: true'
    );

    // -- Private has login.html --
    check(fs.existsSync(path.join('private', 'login.html')), 'PRIVATE has login.html', 'PRIVATE missing login.html');
    // Login page must not ship to public
    check(
        !fs.existsSync(path.join('public', 'login.html')),
        'PUBLIC has no login.html',
        'PUBLIC ships login.html (should be private-only)'
    );

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
