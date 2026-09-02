/**
 * Creates a unique key for tracking export usage
 */
export function makeExportKey(filePath: string, exportName: string): string {
  return `${filePath}::${exportName}`;
}

/**
 * Parses an export key back into file path and export name
 */
export function parseExportKey(key: string): {
  filePath: string;
  exportName: string;
} {
  const lastIndex = key.lastIndexOf('::');
  if (lastIndex === -1) {
    throw new Error(`Invalid export key format (missing "::" separator): "${key}"`);
  }
  return {
    filePath: key.substring(0, lastIndex),
    exportName: key.substring(lastIndex + 2),
  };
}
