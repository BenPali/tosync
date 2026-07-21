// db.js - SQLite persistence for durable state (admin identities).
//
// Deliberate state classification: hot room state
// stays in in-memory Maps (per-event O(1), worthless after a room dies),
// binaries stay on the filesystem — SQLite holds only what must survive a
// restart. Today that is admin accounts; the session store is a documented
// proposal, not yet migrated.
//
// better-sqlite3 is synchronous by design: calls are microseconds against a
// local file, so the event loop is never meaningfully blocked at this scale,
// and prepared statements + WAL give C23.2-grade query hygiene.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db = null;
let stmts = null;

// DB_PATH override exists for tests (playwright points it at test-results/ so
// every e2e run starts from a clean, deterministically-seeded database).
export function initDb(dbPath = process.env.DB_PATH || 'data/tosync.db') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // readers never block the writer
    db.exec(`
        CREATE TABLE IF NOT EXISTS admins (
            username      TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
            last_login    INTEGER
        )
    `);
    stmts = {
        get: db.prepare('SELECT username, password_hash FROM admins WHERE username = ?'),
        insert: db.prepare('INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)'),
        touch: db.prepare('UPDATE admins SET last_login = unixepoch() WHERE username = ?'),
        count: db.prepare('SELECT COUNT(*) AS n FROM admins')
    };
    return db;
}

// One-time migration: an empty admins table is populated from the legacy
// ADMIN_USERS env JSON, demoting the env var from credential STORE to
// bootstrap seed. Existing deploys upgrade themselves on first boot; after
// that the database is the single source of truth (accounts added at runtime
// via add-admin.js survive redeploys and are never clobbered by the env).
export function seedAdminsFromEnv(adminUsers) {
    if (adminCount() > 0) return 0;
    let seeded = 0;
    for (const [username, hash] of Object.entries(adminUsers || {})) {
        if (typeof hash !== 'string' || !hash.startsWith('$2b$')) {
            console.error(`Seed skipped for "${username}": not a bcrypt hash`);
            continue;
        }
        stmts.insert.run(username, hash);
        seeded++;
    }
    if (seeded > 0) console.log(`Seeded ${seeded} admin account(s) from ADMIN_USERS into the database`);
    return seeded;
}

export function getAdmin(username) {
    return stmts.get.get(username);
}

export function touchLastLogin(username) {
    stmts.touch.run(username);
}

export function adminCount() {
    return stmts.count.get().n;
}

export function addAdmin(username, hash) {
    const res = stmts.insert.run(username, hash);
    return res.changes > 0;
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
        stmts = null;
    }
}
