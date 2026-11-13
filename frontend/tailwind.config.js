/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: 'var(--navy-50)', 700: 'var(--navy-700)', 900: 'var(--navy-900)' },
        orange: { 50: 'var(--orange-50)', 500: 'var(--orange-500)', 600: 'var(--orange-600)' },
        sand: 'var(--sand)',
        white: 'var(--white)',
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)', muted: 'var(--ink-muted)' },
        danger: 'var(--danger)',
        editorial: { root: 'var(--bg-editorial-root)', ink: 'var(--text-editorial-primary)', accent: 'var(--accent-editorial-primary)' },
        ops: { root: 'var(--bg-ops-root)', card: 'var(--bg-ops-card)', lime: 'var(--accent-ops-lime)', navy: 'var(--navy-700)', orange: 'var(--accent-ops-orange)' },
      },
    },
  },
  plugins: [],
}
