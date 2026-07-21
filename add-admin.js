// add-admin.js - Create (or report) an admin account in the SQLite database.
//
// Usage: node add-admin.js <username> [password]
// If the password is omitted it is prompted on stdin (preferred — a password
// on the command line lands in shell history).
//
// Runs against data/tosync.db (or DB_PATH) — the same file the private server
// uses, so accounts appear immediately (no restart, no .env edit, survives
// redeploys). This replaces the legacy ADMIN_USERS env-var workflow.

import bcrypt from 'bcrypt';
import readline from 'readline';
import { initDb, addAdmin, adminCount } from './db.js';

const username = process.argv[2];
if (!username || !/^[a-zA-Z0-9_.-]{1,32}$/.test(username)) {
    console.log('Usage: node add-admin.js <username> [password]');
    console.log('Username: 1-32 chars, letters/digits/_.- only');
    process.exit(1);
}

let password = process.argv[3];
if (!password) {
    // sudo-style hidden input: print the prompt ourselves, then mute readline's
    // echo entirely so typed characters never appear on screen.
    process.stdout.write(`Password for "${username}" (input hidden): `);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};
    password = await new Promise((resolve) => rl.question('', resolve));
    rl.close();
    process.stdout.write('\n');
}
if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
}

initDb();
const hash = await bcrypt.hash(password, 12);
if (addAdmin(username, hash)) {
    console.log(`Admin "${username}" created (${adminCount()} account(s) total)`);
} else {
    console.error(`Admin "${username}" already exists — not modified`);
    process.exit(1);
}
