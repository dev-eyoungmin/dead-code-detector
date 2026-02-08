// Entry point - imports used module
import { usedFunction, UsedClass } from './used';
import { partiallyUsedFn } from './partiallyUsed';

const instance = new UsedClass('test');
console.log(usedFunction());
console.log(instance.greet());
console.log(partiallyUsedFn());
