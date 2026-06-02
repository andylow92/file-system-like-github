import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Spawning the MCP child + JSON-RPC handshake takes a few seconds on cold runs.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
