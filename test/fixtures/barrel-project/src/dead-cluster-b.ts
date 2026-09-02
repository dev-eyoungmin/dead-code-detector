import { a } from './dead-cluster-a';

export function b(): number {
  return 1;
}

export function useA(): number {
  return a();
}
