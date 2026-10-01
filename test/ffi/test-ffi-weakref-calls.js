// Flags: --expose-gc
'use strict';
const { skipIfFFIMissing } = require('../common');
skipIfFFIMissing();

const { gcUntil } = require('../common/gc');
const test = require('node:test');
const ffi = require('node:ffi');
const { fixtureSymbols, libraryPath } = require('./ffi-test-common');

test('ffi variadic functions retain their library across GC', async (t) => {
  for (const variadic of [true, ['i32']]) {
    let library = ffi.dlopen(libraryPath, {
      variadic_sum_i32: {
        arguments: ['i32'], return: 'i32', variadic,
      },
    });
    const ref = new WeakRef(library.lib);
    const fn = library.functions.variadic_sum_i32;
    library = null;
    try {
      for (let index = 0; index < 5; index++) {
        await gcUntil('ffi variadic function keeps library alive', () => true, 1);
        t.assert.notStrictEqual(ref.deref(), undefined);
        t.assert.strictEqual(fn(1, 42), 42);
      }
    } finally {
      ref.deref()?.close();
    }
    t.assert.throws(() => fn(1, 42), { code: 'ERR_FFI_LIBRARY_CLOSED' });
  }
});

test('ffi variadic function weak cache permits collection and recreation', async (t) => {
  for (const variadic of [true, ['i32']]) {
    const { lib } = ffi.dlopen(libraryPath);
    try {
      const signature = { arguments: ['i32'], return: 'i32', variadic };
      let fn = lib.getFunction('variadic_sum_i32', signature);
      const ref = new WeakRef(fn);
      fn = null;
      await gcUntil('ffi variadic function is collected', () => ref.deref() === undefined);
      const replacement = lib.getFunction('variadic_sum_i32', signature);
      t.assert.strictEqual(replacement(1, 42), 42);
    } finally {
      lib.close();
    }
  }
});

test('ffi failed callback signature parsing does not retain callbacks', async (t) => {
  const { lib } = ffi.dlopen(libraryPath);
  t.after(() => lib.close());
  const failure = new Error('callback signature getter failed');
  const types = ['i32'];
  Object.defineProperty(types, 0, { get() { throw failure; } });
  for (const signature of [
    { arguments: ['i32'], get variadic() { throw failure; } },
    { arguments: ['i32'], return: 'i32', variadic: types },
  ]) {
    let callback = () => 42;
    const ref = new WeakRef(callback);
    t.assert.throws(() => lib.registerCallback(signature, callback),
                    (error) => error === failure);
    callback = null;
    await gcUntil('ffi failed registration releases callback', () => ref.deref() === undefined);
  }
});

test('ffi unrefCallback releases callback function', async (t) => {
  const { lib, functions: symbols } = ffi.dlopen(libraryPath, fixtureSymbols);
  t.after(() => lib.close());

  let callback = () => 1;
  const ref = new WeakRef(callback);
  const pointer = lib.registerCallback(
    { arguments: ['i32'], return: 'i32' },
    callback,
  );

  lib.unrefCallback(pointer);
  callback = null;

  await gcUntil('ffi unrefCallback releases callback function', () => {
    return ref.deref() === undefined;
  });

  t.assert.strictEqual(symbols.call_int_callback(pointer, 21), 0);

  lib.unregisterCallback(pointer);
});

test('ffi unrefCallback zero-fills narrow callback return', async (t) => {
  const { lib, functions: symbols } = ffi.dlopen(libraryPath, fixtureSymbols);
  t.after(() => lib.close());

  let callback = () => 1;
  const ref = new WeakRef(callback);
  const pointer = lib.registerCallback(
    { arguments: ['i8'], return: 'i8' },
    callback,
  );

  lib.unrefCallback(pointer);
  callback = null;

  await gcUntil('ffi unrefCallback zero-fills narrow callback return', () => {
    return ref.deref() === undefined;
  });

  t.assert.strictEqual(symbols.call_int8_callback(pointer, 21), 0);
  lib.unregisterCallback(pointer);
});

test('ffi refCallback retains callback function', async (t) => {
  const { lib } = ffi.dlopen(libraryPath, fixtureSymbols);
  t.after(() => lib.close());

  let callback = () => 1;
  const ref = new WeakRef(callback);
  const pointer = lib.registerCallback({ return: 'i32' }, callback);

  lib.unrefCallback(pointer);
  lib.refCallback(pointer);
  callback = null;

  for (let i = 0; i < 5; i++) {
    await gcUntil('ffi refCallback retains callback function', () => true, 1);
    t.assert.strictEqual(typeof ref.deref(), 'function');
  }

  lib.unregisterCallback(pointer);
});

test('callback ref/unref throw after callback function is collected', async (t) => {
  const { lib } = ffi.dlopen(libraryPath, fixtureSymbols);
  t.after(() => lib.close());

  let callback = () => 1;
  const ref = new WeakRef(callback);
  const pointer = lib.registerCallback(
    { arguments: ['i32'], return: 'i32' },
    callback,
  );

  lib.unrefCallback(pointer);
  callback = null;

  await gcUntil(
    'callback ref/unref throw after callback function is collected',
    () => ref.deref() === undefined,
  );

  t.assert.throws(() => lib.unrefCallback(pointer), {
    code: 'ERR_INVALID_ARG_VALUE',
    message: /Callback not found/,
  });
  t.assert.throws(() => lib.refCallback(pointer), {
    code: 'ERR_INVALID_ARG_VALUE',
    message: /Callback not found/,
  });

  lib.unregisterCallback(pointer);
});

test('callback ref/unref/unregister throw when library is closed', (t) => {
  const { lib } = ffi.dlopen(libraryPath, fixtureSymbols);
  const callback = lib.registerCallback(() => {});

  lib.close();

  t.assert.throws(() => lib.unregisterCallback(callback), /Library is closed/);
  t.assert.throws(() => lib.refCallback(callback), /Library is closed/);
  t.assert.throws(() => lib.unrefCallback(callback), /Library is closed/);
});
