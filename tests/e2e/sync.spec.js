import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

// Two-client (and three-client) synchronization regression tests. Guard the
// sync-core fixes plus the session-store swap:
//   - native <video> scrubber seeks are broadcast (was: no `seeked` handler)
//   - the outbound throttle delivers the trailing action of a burst
//   - an incoming remote action within the echo window is not dropped
//   - loading media does not emit a phantom seek to the room
//   - a seek made immediately after applying an incoming one still broadcasts
//     (was: counter-based echo suppression could eat it — no settle needed)
//   - restart (seek-to-0) after a fresh load is broadcast (was: eaten by the
//     media-load one-shot, which no load `seeked` ever consumed)
//   - a slow small-step scrub syncs its total displacement (the sub-tolerance
//     broadcast filter is gesture-anchored, not per-seek)
//   - a guest's HTTP access to room media works via session.roomId that the
//     SOCKET set and memorystore persisted (the load-bearing session case)
//
// A long fixture is required: play/pause assertions need playback runway; a 10s
// clip runs out before the second client is measured.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(__dirname, '../fixtures/long120.mp4');

async function login(page) {
    const res = await page.request.post('/api/auth/login', {
        data: { username: 'admin', password: 'test123' },
    });
    expect(res.ok(), 'admin login should succeed').toBeTruthy();
}

async function createRoom(page, name = 'SyncSpec') {
    await page.goto('/');
    await page.evaluate(async (nm) => {
        document.getElementById('createRoomBtn')?.click();
        await new Promise((r) => setTimeout(r, 300));
        const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')]
            .filter((i) => i.offsetParent !== null);
        if (inputs[0]) {
            inputs[0].value = nm;
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.getElementById('createRoomWithNameBtn')?.click();
    }, name);
    await page.waitForURL(/\/[A-Z0-9]{6,}$/, { timeout: 10_000 });
    return new URL(page.url()).pathname;
}

// Join a room as a genuine guest — no admin login. Exercises the guest name
// form and, crucially, the session.roomId the socket sets (read back over HTTP).
async function joinAsGuest(page, room, name = 'Guest') {
    await page.goto(room);
    await page.waitForSelector('#joinAsGuestBtn', { state: 'visible', timeout: 10_000 });
    const nameInput = page.locator('#guestNameJoin');
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(name);
    await page.click('#joinAsGuestBtn');
}

async function adminUpload(page) {
    await page.setInputFiles('#fileInput', VIDEO);
    await page.click('#uploadBtn');
    await waitVideoReady(page);
}

async function waitVideoReady(page) {
    await expect
        .poll(() => page.evaluate(() => {
            const v = document.getElementById('videoPlayer');
            return v && v.duration > 100 ? v.readyState : 0;
        }), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);
}

// Presence is broadcast right after the server-side socket.join, so waiting for
// the member count proves a client's socket is fully subscribed — making the
// one-shot sync broadcasts below race-free.
async function waitForUsers(page, n) {
    await expect
        .poll(() => page.evaluate(() =>
            document.getElementById('usersList')?.children.length || 0), { timeout: 10_000 })
        .toBe(n);
}

const currentTime = (page) => page.evaluate(() => document.getElementById('videoPlayer').currentTime);
const isPaused = (page) => page.evaluate(() => document.getElementById('videoPlayer').paused);
const roundTime = (page) => page.evaluate(() => Math.round(document.getElementById('videoPlayer').currentTime));

test('admin + guest: session sharing, bidirectional sync, throttle, rate, force-sync', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();

    try {
        await login(A);
        const room = await createRoom(A);
        await adminUpload(A);

        // --- B joins as a REAL guest (no admin session) ---
        await joinAsGuest(B, room, 'Guesty');

        await test.step('session sharing: guest loads room video via socket-set session.roomId', async () => {
            // If memorystore failed to persist/read the socket-set roomId, the
            // guest's HTTP request to /rooms/:id/videos would 403 and the video
            // would never load — so waitVideoReady succeeding IS the assertion.
            await waitVideoReady(B);
            // Belt-and-suspenders: fetch the media URL from the guest context.
            const status = await B.evaluate(async () => {
                const src = document.getElementById('videoPlayer').src;
                const r = await fetch(src, { headers: { Range: 'bytes=0-1' } });
                return r.status;
            });
            expect([200, 206]).toContain(status);
        });

        await waitForUsers(A, 2);
        await waitForUsers(B, 2);

        await test.step('restart after fresh load: seek-to-0 reaches the guest', async () => {
            await B.evaluate(() => { document.getElementById('videoPlayer').muted = true; });
            await A.evaluate(() => {
                const v = document.getElementById('videoPlayer');
                v.muted = true;
                return v.play().catch(() => {});
            });
            // The guest must genuinely be playing along first, so landing near 0
            // below can only come from the broadcast restart seek.
            await expect.poll(() => isPaused(B), { timeout: 5_000 }).toBe(false);
            await A.waitForTimeout(2000);
            await A.evaluate(() => {
                const v = document.getElementById('videoPlayer');
                v.pause();
                v.currentTime = 0;
            });
            await expect.poll(() => isPaused(B), { timeout: 5_000 }).toBe(true);
            // Regression: this is the FIRST seek since the load. The old one-shot
            // (armed at load, never consumed) ate any seek landing within 0.5s of
            // the load position — the guest stayed at ~2s while the admin
            // restarted alone.
            await expect.poll(() => currentTime(B), { timeout: 5_000 }).toBeLessThan(1);
        });

        await test.step('scrubber sync admin -> guest', async () => {
            await A.evaluate(() => { document.getElementById('videoPlayer').currentTime = 40; });
            await expect.poll(() => roundTime(B), { timeout: 5_000 }).toBe(40);
        });

        await test.step('guest is a controller too: guest scrub -> admin follows', async () => {
            // Deliberately NO settle here: the guest seeks while the incoming
            // seek's echo may still be pending. The old counter-based suppression
            // could consume the guest's own seek in that window (the reason this
            // step once needed a settle); position-matched targets must not.
            await B.evaluate(() => { document.getElementById('videoPlayer').currentTime = 70; });
            await expect.poll(() => roundTime(A), { timeout: 5_000 }).toBe(70);
        });

        await test.step('slow scrub: sub-tolerance steps still sync their total displacement', async () => {
            // Five 0.4s steps 120ms apart, like a slow scrubber drag. Each step
            // is under SYNC_TOLERANCE — per-seek origin anchoring would suppress
            // every one and the room would silently stay behind; gesture-anchored
            // origin measures the 2s total and broadcasts.
            await A.evaluate(async () => {
                const v = document.getElementById('videoPlayer');
                for (let i = 0; i < 5; i++) {
                    v.currentTime = v.currentTime + 0.4;
                    await new Promise((r) => setTimeout(r, 120));
                }
            });
            await expect.poll(() => roundTime(B), { timeout: 5_000 }).toBe(72);
        });

        await test.step('trailing-throttle: last of a rapid burst wins on the guest', async () => {
            await A.evaluate(async () => {
                const v = document.getElementById('videoPlayer');
                v.currentTime = 20;
                await new Promise((r) => setTimeout(r, 80));
                v.currentTime = 95;
            });
            await expect.poll(() => roundTime(B), { timeout: 5_000 }).toBe(95);
        });

        await test.step('pause-then-play burst leaves the guest playing, not stuck paused', async () => {
            await B.evaluate(() => {
                const v = document.getElementById('videoPlayer');
                window.__log = [];
                ['play', 'pause'].forEach((e) =>
                    v.addEventListener(e, () => window.__log.push({ e, ts: Date.now() })));
            });
            await A.evaluate(async () => {
                const v = document.getElementById('videoPlayer');
                v.muted = true;
                v.currentTime = 10;
                await new Promise((r) => setTimeout(r, 300));
                await v.play().catch(() => {});
                await new Promise((r) => setTimeout(r, 500));
                v.pause();
                await new Promise((r) => setTimeout(r, 90));
                await v.play().catch(() => {});
            });
            await expect.poll(() => isPaused(B), { timeout: 5_000 }).toBe(false);
            const t1 = await currentTime(B);
            await B.waitForTimeout(700);
            expect(await currentTime(B), 'guest playback must advance').toBeGreaterThan(t1);
            const log = await B.evaluate(() => window.__log);
            const lastPlay = [...log].reverse().find((e) => e.e === 'play');
            const lastPause = [...log].reverse().find((e) => e.e === 'pause');
            expect(lastPlay && lastPause && lastPlay.ts > lastPause.ts,
                'trailing play must arrive after the pause').toBeTruthy();
        });

        await test.step('playback-rate propagates admin -> guest', async () => {
            await A.evaluate(() => { document.getElementById('videoPlayer').pause(); });
            await A.click('#rate15Btn');
            await expect
                .poll(() => B.evaluate(() => document.getElementById('videoPlayer').playbackRate), { timeout: 5_000 })
                .toBe(1.5);
        });

        await test.step('admin force-sync button pushes the admin state to the room', async () => {
            // In this shared-control model any seek already propagates, so A and B
            // can't be made to genuinely diverge without reaching into internals.
            // What we can assert end-to-end: clicking the force-sync button emits
            // the admin's current position and the room lands on it. (The apply
            // path itself is the same one covered by every seek test above.)
            await A.evaluate(() => { const v = document.getElementById('videoPlayer'); v.pause(); v.currentTime = 47; });
            await A.waitForTimeout(250);
            await A.click('#syncTimeBtn');
            await expect.poll(() => roundTime(B), { timeout: 5_000 }).toBe(47);
        });
    } finally {
        await ctxA.close();
        await ctxB.close();
    }
});

test('three clients stay in sync', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();
    const C = await ctxC.newPage();

    try {
        await login(A);
        const room = await createRoom(A, 'Trio');
        await adminUpload(A);

        await joinAsGuest(B, room, 'Bee');
        await joinAsGuest(C, room, 'Cee');
        await waitVideoReady(B);
        await waitVideoReady(C);
        await waitForUsers(A, 3);

        await test.step('admin seek reaches both guests', async () => {
            await A.evaluate(() => { document.getElementById('videoPlayer').currentTime = 33; });
            await expect.poll(() => roundTime(B), { timeout: 5_000 }).toBe(33);
            await expect.poll(() => roundTime(C), { timeout: 5_000 }).toBe(33);
        });

        await test.step('one guest seek reaches the admin and the other guest', async () => {
            await B.evaluate(() => { document.getElementById('videoPlayer').currentTime = 88; });
            await expect.poll(() => roundTime(A), { timeout: 5_000 }).toBe(88);
            await expect.poll(() => roundTime(C), { timeout: 5_000 }).toBe(88);
        });
    } finally {
        await ctxA.close();
        await ctxB.close();
        await ctxC.close();
    }
});
