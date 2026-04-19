/** @type {import('tailwindcss').Config} */
const neutralScale = Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(step => [
        step, `rgb(var(--neutral-${step}) / <alpha-value>)`,
    ])
);

export default {
    content: ['./src/**/*.{html,js}'],
    // No darkMode strategy — we swap CSS vars via a `.light` class on <html>
    // instead of using Tailwind's dark: variants.
    theme: {
        extend: {
            colors: {
                primary:   'rgb(var(--color-primary) / <alpha-value>)',
                accent:    'rgb(var(--color-accent)  / <alpha-value>)',
                inset:     'rgb(var(--input-bg)      / <alpha-value>)',
                secondary: '#64748b',
                dark:      '#0f172a',
                surface:   '#1e293b',
                neutral:   neutralScale,
            },
            fontFamily: {
                sans: ['Figtree', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
            },
        },
    },
    plugins: [],
};
