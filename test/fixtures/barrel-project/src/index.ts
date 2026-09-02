import { used } from './barrel';
import { outer, Service } from './nested';
import { loadLocale } from './dyn';
import { worker } from './worker-host';
import { handleRequest, onError } from './params';
import { accumulate } from './writeonly';

export function main(): string {
  outer();
  new Service().getValue();
  void loadLocale('en');
  void worker;
  accumulate();
  onError(new Error('x'), 'data');
  return used() + handleRequest('payload', null);
}
