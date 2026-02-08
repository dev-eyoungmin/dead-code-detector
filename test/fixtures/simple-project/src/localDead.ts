// This file has local variables/functions that are never used

export function activeFunction(): number {
  const usedLocal = 10;
  const unusedLocal = 20; // Dead: never referenced
  let anotherUnused: string; // Dead: never referenced

  function unusedHelper() { // Dead: never called
    return 'helper';
  }

  function usedHelper() {
    return usedLocal * 2;
  }

  return usedHelper();
}
