/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        editorial: { root: 'var(--bg-editorial-root)', ink: 'var(--text-editorial-primary)', accent: 'var(--accent-editorial-primary)' },
        ops: { root: 'var(--bg-ops-root)', card: 'var(--bg-ops-card)', lime: 'var(--accent-ops-lime)' },
      },
    },
  },
  plugins: [],
}
