import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      vscode: './test/__mocks__/vscode.ts',
    },
  },
});
