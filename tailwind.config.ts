import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        chrome: {
          50: '#f4f4f4',
          100: '#e3e3e3',
          200: '#c7c7c7',
          300: '#a9a9a9',
          400: '#8a8a8a',
          500: '#6f6f6f',
          600: '#2f477a',
          700: '#2a2b2d',
          800: '#202124',
          900: '#151617',
          950: '#101112',
        },
        accent: {
          teal: '#6aa7a1',
          'teal-hover': '#7bb7b1',
          'teal-soft': 'rgba(106, 167, 161, 0.16)',
          blue: '#2f477a',
          'blue-hover': '#365287',
        },
      },
      boxShadow: {
        panel: '0 20px 50px rgba(2, 6, 23, 0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config;
