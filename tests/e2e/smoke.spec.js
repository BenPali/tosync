import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(__dirname, '../fixtures/sample.mp4');
const SUB = path.join(__dirname, '../fixtures/sample.srt');

async function login(page) {
    const res = await page.request.post('/api/auth/login', {
        data: { username: 'admin', password: 'test123' }
    });
    expect(res.ok(), 'admin login should succeed').toBeTruthy();
}

async function createRoom(page, name = 'E2E') {
    await page.goto('/');
    await page.evaluate(async (nm) => {
        document.getElementById('createRoomBtn')?.click();
        await new Promise((r) => setTimeout(r, 200));
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
}

test('critical path: login → room → video → subtitle (picker) → render → offset → fullscreen', async ({ page }) => {
    await login(page);
    await createRoom(page);

    await test.step('upload + play a video', async () => {
        await page.setInputFiles('#fileInput', VIDEO);
        await page.click('#uploadBtn');
        await expect
            .poll(() => page.evaluate(() => document.getElementById('videoPlayer')?.readyState), { timeout: 15_000 })
            .toBeGreaterThanOrEqual(2);
    });

    await test.step('CC popover opens on-screen, admin controls visible (picker regression)', async () => {
        const geo = await page.evaluate(() => {
            document.getElementById('subtitleSection').open = true;
            const vh = window.innerHeight;
            const form = document.getElementById('subtitleUploadForm').getBoundingClientRect();
            return {
                timingVisible: !document.getElementById('subtitleTimingControl').classList.contains('hidden'),
                uploadVisible: !document.getElementById('subtitleUploadForm').classList.contains('hidden'),
                formOnScreen: form.top >= 0 && form.bottom <= vh
            };
        });
        // The old downward popover pushed this form below the viewport → unclickable.
        expect(geo.uploadVisible, 'upload form shown for admin').toBe(true);
        expect(geo.timingVisible, 'timing control shown for admin').toBe(true);
        expect(geo.formOnScreen, 'upload form must be fully on-screen').toBe(true);
    });

    await test.step('upload subtitle via the picker → appears in list → renders cues', async () => {
        await page.setInputFiles('#subtitleInput', SUB);
        await page.fill('#subtitleLabel', 'E2ESub');
        await page.click('#uploadSubtitleBtn');
        await expect
            .poll(
                () =>
                    page.evaluate(() =>
                        [...document.querySelectorAll('#subtitlesList [data-subtitle-item]')].some((r) =>
                            r.dataset.subtitleItem.includes('E2ESub')
                        )
                    ),
                { timeout: 10_000 }
            )
            .toBe(true);
        await page.evaluate(() => {
            const row = [...document.querySelectorAll('#subtitlesList [data-subtitle-item]')].find((r) =>
                r.dataset.subtitleItem.includes('E2ESub')
            );
            row.click();
        });
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const tt = document.getElementById('videoPlayer').textTracks[0];
                        return tt && tt.cues ? tt.cues.length : 0;
                    }),
                { timeout: 10_000 }
            )
            .toBeGreaterThan(0);
    });

    await test.step('timing offset (+) shifts cues and updates the readout', async () => {
        const before = await page.evaluate(
            () => [...document.getElementById('videoPlayer').textTracks[0].cues][0].startTime
        );
        await page.click('#subtitleOffsetUpBtn');
        await page.click('#subtitleOffsetUpBtn'); // +1.0s total
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => ({
            start: [...document.getElementById('videoPlayer').textTracks[0].cues][0].startTime,
            readout: document.getElementById('subtitleOffsetReadout').textContent
        }));
        expect(after.start).toBeCloseTo(before + 1.0, 2);
        expect(after.readout).toBe('+1.0s');
    });

    await test.step('fullscreen targets the player container', async () => {
        await page.evaluate(() => {
            document.getElementById('subtitleSection').open = false;
            window.__fsTarget = null;
            // Spy so the test does not depend on the headless OS granting fullscreen.
            Element.prototype.requestFullscreen = function () {
                window.__fsTarget = this;
                return Promise.resolve();
            };
        });
        await page.click('#fullscreenBtn');
        const targetsPlayer = await page.evaluate(() => {
            const t = window.__fsTarget;
            return !!t && t.contains(document.getElementById('videoPlayer'));
        });
        expect(targetsPlayer, 'fullscreen should be requested on the player container').toBe(true);
    });
});
