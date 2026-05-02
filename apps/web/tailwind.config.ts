import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        felt: '#0d3b2e',
        'felt-light': '#155343',
        chip: '#f5b942',
      },
    },
  },
  plugins: [],
}

export default config
