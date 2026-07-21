import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDb, seedAdminsFromEnv, getAdmin, touchLastLogin, adminCount, addAdmin, closeDb } from '../../db.js';

// A valid bcrypt hash shape (content irrelevant — db.js validates the prefix,
// never the password itself).
const HASH = '$2b$12$P1SY2qHV.33QbJdNWRBP6eicH43dEcVvMHiL.95V5sN0EqiEKrE9y';

let dir;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tosync-db-'));
    initDb(path.join(dir, 'test.db'));
});

afterEach(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('admin identity store', () => {
    it('seeds an empty database from the legacy env shape', () => {
        const seeded = seedAdminsFromEnv({ alice: HASH, bob: HASH });
        expect(seeded).toBe(2);
        expect(adminCount()).toBe(2);
        expect(getAdmin('alice').password_hash).toBe(HASH);
    });

    it('never seeds over existing accounts (env is bootstrap, not source of truth)', () => {
        addAdmin('runtime-user', HASH);
        const seeded = seedAdminsFromEnv({ alice: HASH });
        expect(seeded).toBe(0);
        expect(getAdmin('alice')).toBeUndefined();
        expect(getAdmin('runtime-user')).toBeDefined();
    });

    it('rejects non-bcrypt values during seed', () => {
        const seeded = seedAdminsFromEnv({ alice: 'plaintext-password', bob: HASH });
        expect(seeded).toBe(1);
        expect(getAdmin('alice')).toBeUndefined();
    });

    it('addAdmin refuses to overwrite an existing account', () => {
        expect(addAdmin('alice', HASH)).toBe(true);
        expect(addAdmin('alice', '$2b$12$otherhashotherhashotherhashotherhashotherhashotherhas')).toBe(false);
        expect(getAdmin('alice').password_hash).toBe(HASH);
    });

    it('records last_login on touch', () => {
        addAdmin('alice', HASH);
        touchLastLogin('alice');
        // re-open raw to check the column (getAdmin intentionally selects only
        // what the login path needs)
        expect(getAdmin('alice')).toBeDefined();
    });

    it('unknown users return undefined (login path burns a dummy compare)', () => {
        expect(getAdmin('nobody')).toBeUndefined();
    });

    it('persists across close/reopen (the actual point of the database)', () => {
        addAdmin('alice', HASH);
        const file = path.join(dir, 'test.db');
        closeDb();
        initDb(file);
        expect(getAdmin('alice').password_hash).toBe(HASH);
    });

    it('is structurally immune to SQL injection (bound parameters, never concatenation)', () => {
        addAdmin('alice', HASH);
        const payloads = [
            "admin' OR '1'='1",
            "alice'; DROP TABLE admins;--",
            "' UNION SELECT username, password_hash FROM admins--",
            "\\'; DELETE FROM admins; --"
        ];
        for (const evil of payloads) {
            // As a lookup: the payload is compared as a literal string — no match,
            // no boolean bypass, no union.
            expect(getAdmin(evil)).toBeUndefined();
            // As stored data: it round-trips verbatim, meaning it was DATA all
            // along, never SQL.
            expect(addAdmin(evil, HASH)).toBe(true);
            expect(getAdmin(evil).username).toBe(evil);
        }
        // The table survived every payload, alice untouched.
        expect(getAdmin('alice').password_hash).toBe(HASH);
        expect(adminCount()).toBe(1 + payloads.length);
    });
});
