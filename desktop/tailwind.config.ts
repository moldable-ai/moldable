import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './index.html',
    // Include the UI package components
    '../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
} satisfies Config
