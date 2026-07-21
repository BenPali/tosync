import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

// Regression proof for the ?player=videojs prototype (proto-videojs study):
// with the admin running the Video.js chrome and the guest on the native
// player, room sync must be indistinguishable from the default path — because
// the wrapper reuses the same media element the sync engine listens to.
// The default (flag-off) path is covered by sync.spec.js, which never sets the flag.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(__dirname, '../fixtures/long120.mp4');

// The Video.js wrapper takes over the id: #videoPlayer becomes the wrapper
// <div>, the media element lives inside it. This selector finds the native
// element in both wrapped and unwrapped pages.
const NATIVE = "document.querySelector('#videoPlayer video, video#videoPlayer')";

const nativeRound = (page) => page.evaluate(`Math.round(${NATIVE}.currentTime)`);

// The prototype loads Video.js from jsdelivr at runtime (SRI-pinned). In an
// offline/air-gapped environment this spec cannot run — skip it rather than
// fail the suite. All other specs are CDN-independent.
let cdnReachable = true;
test.beforeAll(async ({ request }) => {
    try {
        const res = await request.head('https://cdn.jsdelivr.net/npm/video.js@8.16.1/dist/video.min.js', {
            timeout: 5_000
        });
        cdnReachable = res.ok();
    } catch {
        cdnReachable = false;
    }
});

async function login(page) {
    const res = await page.request.post('/api/auth/login', {
        data: { username: 'admin', password: 'test123' }
    });
    expect(res.ok(), 'admin login should succeed').toBeTruthy();
}

async function createRoom(page, name = 'VjsProto') {
    await page.goto('/');
    await page.evaluate(async (nm) => {
        document.getElementById('createRoomBtn')?.click();
        await new Promise((r) => setTimeout(r, 300));
        const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(
            (i) => i.offsetParent !== null
        );
        if (inputs[0]) {
            inputs[0].value = nm;
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.getElementById('createRoomWithNameBtn')?.click();
    }, name);
    await page.waitForURL(/\/[A-Z0-9]{6,}$/, { timeout: 10_000 });
    return new URL(page.url()).pathname;
}

// Direct-URL entry shows the name form regardless of session; the server
// grants the admin role from the session at join.
async function joinViaForm(page, url, name) {
    await page.goto(url);
    await page.waitForSelector('#joinAsGuestBtn', { state: 'visible', timeout: 10_000 });
    const nameInput = page.locator('#guestNameJoin');
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(name);
    await page.click('#joinAsGuestBtn');
}

async function waitNativeReady(page) {
    await expect
        .poll(
            () => page.evaluate(`(() => { const v = ${NATIVE}; return v && v.duration > 100 ? v.readyState : 0; })()`),
            {
                timeout: 20_000
            }
        )
        .toBeGreaterThanOrEqual(2);
}

async function waitForUsers(page, n) {
    await expect
        .poll(() => page.evaluate(() => document.getElementById('usersList')?.children.length || 0), {
            timeout: 10_000
        })
        .toBe(n);
}

test('videojs chrome (flagged): sync engine unchanged underneath', async ({ browser }, testInfo) => {
    test.skip(!cdnReachable, 'jsdelivr unreachable — the prototype spec needs the CDN');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const A = await ctxA.newPage();
    const B = await ctxB.newPage();

    try {
        await login(A);
        const room = await createRoom(A);
        // Re-enter with the prototype flag: boot-time check, so a reload is the switch.
        await joinViaForm(A, `${room}?player=videojs`, 'AdminVjs');

        await test.step('wrapper active: Video.js chrome around the same element', async () => {
            await A.waitForSelector('#videoPlayer.video-js', { timeout: 10_000 });
        });

        await A.setInputFiles('#fileInput', VIDEO);
        await A.click('#uploadBtn');
        await waitNativeReady(A);

        await test.step('in-bar controls present: seek buttons, CC, gear, rate menu', async () => {
            const bar = await A.evaluate(() => ({
                textButtons: [...document.querySelectorAll('#videoPlayer .vjs-control-bar .vjs-icon-placeholder')]
                    .map((e) => e.textContent)
                    .filter(Boolean),
                // CC and gear use the Video.js icon FONT (not text) so they get
                // the same sizing as volume/PiP/fullscreen
                ccIcon: !!document.querySelector('#videoPlayer .vjs-control-bar .vjs-icon-subtitles'),
                gearIcon: !!document.querySelector('#videoPlayer .vjs-control-bar .vjs-icon-cog'),
                rateMenu: !!document.querySelector('#videoPlayer .vjs-playback-rate')
            }));
            expect(bar.textButtons).toEqual(['-10', '+10']);
            expect(bar.ccIcon).toBe(true);
            expect(bar.gearIcon).toBe(true);
            expect(bar.rateMenu).toBe(true);
        });

        await test.step('CC panel opens with tracks, upload, timing and size controls', async () => {
            const panel = await A.evaluate(() => {
                document.querySelector('#videoPlayer .vjs-icon-subtitles').closest('button').click();
                const p = document.querySelector('.vjs-proto-cc-panel');
                return { visible: p && p.style.display !== 'none', text: p ? p.textContent : '' };
            });
            expect(panel.visible).toBe(true);
            expect(panel.text).toContain('Upload subtitle');
            expect(panel.text).toContain('Timing');
            expect(panel.text).toContain('Size');
            // close it again so it doesn't overlap later steps
            await A.evaluate(() =>
                document.querySelector('#videoPlayer .vjs-icon-subtitles').closest('button').click()
            );
        });

        await test.step('CC panel is keyboard operable (focus-in, arrows, Esc-out)', async () => {
            // The control bar is display:none until first play (vjs-has-started),
            // and a hidden button cannot receive focus — start playback first,
            // exactly as a keyboard user would have to.
            await A.evaluate(`(() => { const v = ${NATIVE}; v.muted = true; return v.play().catch(() => {}); })()`);
            await expect
                .poll(() =>
                    A.evaluate(() => document.querySelector('#videoPlayer').classList.contains('vjs-has-started'))
                )
                .toBe(true);
            // .click() is detail 0 = keyboard-style activation -> focus enters the panel
            await A.evaluate(() =>
                document.querySelector('#videoPlayer .vjs-icon-subtitles').closest('button').click()
            );
            const focusIn = await A.evaluate(() =>
                document.querySelector('.vjs-proto-cc-panel').contains(document.activeElement)
            );
            expect(focusIn, 'keyboard open moves focus into the panel').toBe(true);
            const before = await A.evaluate(() => document.activeElement.textContent);
            await A.keyboard.press('ArrowDown');
            const after = await A.evaluate(() => ({
                text: document.activeElement.textContent,
                inPanel: document.querySelector('.vjs-proto-cc-panel').contains(document.activeElement)
            }));
            expect(after.inPanel, 'arrow keys move focus within the panel').toBe(true);
            expect(after.text).not.toBe(before);
            await A.keyboard.press('Escape');
            const closed = await A.evaluate(() => ({
                panelClosed: document.querySelector('.vjs-proto-cc-panel').style.display === 'none',
                focusOnCc:
                    document.activeElement ===
                    document.querySelector('#videoPlayer .vjs-icon-subtitles').closest('button'),
                ariaExpanded: document
                    .querySelector('#videoPlayer .vjs-icon-subtitles')
                    .closest('button')
                    .getAttribute('aria-expanded')
            }));
            expect(closed.panelClosed, 'Esc closes the panel').toBe(true);
            const focusDebug = await A.evaluate(() => ({
                tag: document.activeElement.tagName,
                cls: (document.activeElement.className || '').slice(0, 80),
                title: document.activeElement.title || null
            }));
            expect(closed.focusOnCc, `Esc returns focus to the CC button (got ${JSON.stringify(focusDebug)})`).toBe(
                true
            );
            expect(closed.ariaExpanded).toBe('false');
            // Park A paused again so later position assertions stay exact.
            await A.evaluate(`${NATIVE}.pause()`);
        });

        await joinViaForm(B, room, 'GuestNative');
        await waitNativeReady(B);
        await waitForUsers(A, 2);
        await waitForUsers(B, 2);

        await test.step('outbound: native seek under the wrapper reaches the guest', async () => {
            await A.evaluate(`${NATIVE}.currentTime = 40`);
            await expect.poll(() => nativeRound(B), { timeout: 5_000 }).toBe(40);
        });

        await test.step('inbound: guest seek is applied under the wrapper', async () => {
            await B.evaluate(`${NATIVE}.currentTime = 70`);
            await expect.poll(() => nativeRound(A), { timeout: 5_000 }).toBe(70);
        });

        await test.step('in-bar -10 button drives the room like a native scrub', async () => {
            await A.evaluate(() =>
                [...document.querySelectorAll('#videoPlayer .vjs-control-bar button')]
                    .find((b) => b.textContent.includes('-10'))
                    .click()
            );
            await expect.poll(() => nativeRound(A), { timeout: 5_000 }).toBe(60);
            await expect.poll(() => nativeRound(B), { timeout: 5_000 }).toBe(60);
        });

        await test.step('in-bar rate menu drives room playback speed', async () => {
            // The menu-item click can race Video.js's menu state — retry the
            // click until the LOCAL rate proves it registered (idempotent),
            // then assert the room-propagated effect separately.
            await expect
                .poll(
                    async () => {
                        await A.evaluate(() => {
                            const items = [
                                ...document.querySelectorAll('#videoPlayer .vjs-playback-rate .vjs-menu .vjs-menu-item')
                            ];
                            items
                                .find((i) => i.textContent.includes('1.5'))
                                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        });
                        return A.evaluate(`${NATIVE}.playbackRate`);
                    },
                    { timeout: 10_000 }
                )
                .toBe(1.5);
            await expect.poll(() => B.evaluate(`${NATIVE}.playbackRate`), { timeout: 5_000 }).toBe(1.5);
        });

        await test.step('screenshot for the study (mid-playback)', async () => {
            await A.evaluate(`(() => { const v = ${NATIVE}; v.muted = true; return v.play().catch(() => {}); })()`);
            await A.waitForTimeout(1000);
            await A.locator('#videoPlayer').hover(); // show the control bar
            await A.screenshot({ path: testInfo.outputPath('videojs-in-app.png') });
        });
    } finally {
        await ctxA.close();
        await ctxB.close();
    }
});
