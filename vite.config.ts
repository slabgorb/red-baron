import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Served under /red-baron/ on arcade.slabgorb.com, mirroring the sibling
  // games' base paths so root-relative asset URLs resolve in dev and build.
  base: '/',
  build: {
    // Multi-page: ship the game (index.html) AND the ROM|PORT contact sheet
    // (models.html, rom-picture-contact-sheet story) — mirrors star-wars's
    // vite.config.ts. Vite's dev server serves any root HTML file without
    // this; it's the PRODUCTION build (`vite build`, what `just deploy`
    // ships to R2) that needs an explicit entry or models.html would be
    // silently dropped from dist/.
    rollupOptions: {
      input: {
        main: 'index.html',
        models: 'models.html',
      },
    },
  },
  // Pin Red Baron's dedicated port 5277 — the next free pin in the arcade's
  // port block (the lobby and the other games own the lower pins). strictPort
  // fails loudly on a collision instead of silently wandering to a free port.
  server: {
    port: 5277,
    strictPort: true,
    // The Cloudflare tunnel forwards Host: arcade.slabgorb.com; Vite blocks
    // unrecognised Hosts (DNS-rebinding protection) unless allow-listed.
    allowedHosts: ['arcade.slabgorb.com'],
  },
  preview: {
    port: 5277,
    strictPort: true,
    allowedHosts: ['arcade.slabgorb.com'],
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
