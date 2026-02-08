export const EXTENSION_ID = 'deadCodeDetector';

export const COMMANDS = {
  ANALYZE_PROJECT: `${EXTENSION_ID}.analyzeProject`,
  ANALYZE_CURRENT_FILE: `${EXTENSION_ID}.analyzeCurrentFile`,
  EXPORT_REPORT: `${EXTENSION_ID}.exportReport`,
  CLEAR_RESULTS: `${EXTENSION_ID}.clearResults`,
} as const;

export const VIEWS = {
  RESULTS: `${EXTENSION_ID}.resultsView`,
} as const;

export const OUTPUT_CHANNEL_NAME = 'Dead Code Detector';

export const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.go',
  '**/*.java',
];

export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/vendor/**',
  '**/*_test.go',
  '**/target/**',
  '**/Test*.java',
  '**/*Test.java',
];

export const DEBOUNCE_DELAY_MS = 1000;
