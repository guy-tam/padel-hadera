import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-heebo)', 'system-ui', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#eefbf5',
          100: '#d6f5e4',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          900: '#064e3b'
        }
      }
    }
  },
  plugins: []
};
export default config;
