// unpdf's pdf.js bundle references the Iterator global (Node >= 22).
// The project requires Node >= 22; delete this file (and its setupFiles entry) once dev machines run Node 22.
if (typeof (globalThis as {Iterator?: unknown}).Iterator === 'undefined') {
  const proto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  const Iter = function Iterator() {} as unknown as {prototype: unknown};
  Iter.prototype = proto;
  (globalThis as {Iterator?: unknown}).Iterator = Iter;
}
