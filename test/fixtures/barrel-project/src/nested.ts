export function outer(): number {
  const usedInOuter = 1;

  function inner(): number {
    const unusedInNested = 2;
    return usedInOuter;
  }

  [1, 2].forEach((item) => {
    const unusedInCallback = item;
  });

  return inner();
}

export class Service {
  private unusedField = 1;

  private usedField = 2;

  private unusedPrivate(): number {
    return 3;
  }

  getValue(): number {
    return this.usedField;
  }
}
