import { x } from '@ws/a';
import { bUsed } from '@b/util';

export function y(): string {
  return bUsed() + x();
}
