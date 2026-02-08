// Only partiallyUsedFn is imported by index.ts
// unusedExport is never imported anywhere

export function partiallyUsedFn(): string {
  return 'I am used';
}

export function unusedExport(): string {
  return 'I am exported but never imported';
}

export const ANOTHER_UNUSED = 'not used';
