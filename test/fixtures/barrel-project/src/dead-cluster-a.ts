import { b, useA } from './dead-cluster-b';

export function a(): number {
  return b() + useA();
}
