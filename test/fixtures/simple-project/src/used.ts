// All exports in this file are used by index.ts
export function usedFunction(): string {
  return 'I am used!';
}

export class UsedClass {
  constructor(private name: string) {}
  greet(): string {
    return `Hello, ${this.name}`;
  }
}
