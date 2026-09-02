'use strict';

module.exports = {
  content: ['./frontend/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
      colors: {
        brand: { DEFAULT: '#2563eb', dark: '#1d4ed8', deep: '#1e40af', light: '#3b82f6', soft: '#eff6ff' },
        med: { teal: '#14b8a6', tealsoft: '#ccfbf1', cyan: '#06b6d4' }
      },
      boxShadow: {
        soft: '0 10px 40px -12px rgba(37,99,235,.18)',
        lift: '0 20px 50px -18px rgba(15,23,42,.22)'
      }
    }
  },
  plugins: []
};
