export interface Debounced<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
      timer = undefined;
    }, delayMs);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
