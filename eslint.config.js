// ESLint flat config (v10). Two environments, split by directory:
// - src/** runs in the browser (ES modules + CDN globals io/Hls/mpegts)
// - server.js, build tooling and tests run under Node
import js from '@eslint/js';
import globals from 'globals';

export default [
    // Build artifacts are copies of src/ — lint the source, not the copies.
    { ignores: ['public/**', 'private/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },

    js.configs.recommended,

    {
        rules: {
            // House style: empty catch means "failure is acceptable here"
            // (player teardown, best-effort cleanup) — the surrounding comment
            // carries the why.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Middleware signatures (req, res, next) and event handlers keep
            // unused params for shape; caught errors may be intentionally
            // ignored. Unused LOCALS are still errors.
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
        }
    },

    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                io: 'readonly', // socket.io client (CDN)
                Hls: 'readonly', // hls.js (CDN)
                mpegts: 'readonly' // mpegts.js (CDN)
            }
        }
    },

    {
        files: [
            'server.js',
            'build.js',
            'generate-hash.js',
            'tailwind.config.js',
            'playwright.config.js',
            'vitest.config.js',
            'eslint.config.js',
            'tests/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node }
        }
    },

    {
        // Playwright evaluate() callbacks run in the browser page context.
        files: ['tests/e2e/**/*.js'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser }
        }
    }
];
