import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Upstream Swift/Sparkle packaging is replaced by Tauri in this product.
    exclude: ['src/__tests__/server/nativeAppPackaging.test.ts'],
  },
});
