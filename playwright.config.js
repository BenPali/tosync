import { defineConfig } from '@playwright/test';

// E2E smoke tests run against a real build of the PRIVATE (advanced) app, served
// by a throwaway server on port 3101 with a known test admin (admin / test123).
// Run `npm run build` first (the `test:e2e` script does this for you).
const PORT = 3101;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        headless: true,
        viewport: { width: 1280, height: 800 },
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node server.js',
        url: `http://localhost:${PORT}/api/health`,
        timeout: 30_000,
        reuseExistingServer: false,
        env: {
            PORT: String(PORT),
            ENABLE_TORRENTS: 'true',
            SESSION_SECRET: 'e2e-test-secret-0123456789abcdef0123456789abcdef',
            // bcrypt hash of "test123"
            ADMIN_USERS: '{"admin":"$2b$12$P1SY2qHV.33QbJdNWRBP6eicH43dEcVvMHiL.95V5sN0EqiEKrE9y"}'
        }
    }
});
