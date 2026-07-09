import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Served under /red-baron/ on arcade.slabgorb.com, mirroring the sibling
  // games' base paths so root-relative asset URLs resolve in dev and build.
  base: '/',
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
