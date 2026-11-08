import { defineConfig } from 'vitest/config';

process.env.TZ = 'Europe/Berlin';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Der Kontrasttest liest die Design-Tokens als Text (styles.css?raw).
    css: { include: [/styles\.css/] },
  },
});
