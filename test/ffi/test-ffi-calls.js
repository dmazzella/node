// Flags: --allow-natives-syntax
'use strict';
const common = require('../common');
common.skipIfFFIMissing();
const assert = require('node:assert');
const { test } = require('node:test');
const ffi = require('node:ffi');
const { cString, fixtureSymbols, libraryPath } = require('./ffi-test-common');

function getLibrary() {
  return ffi.dlopen(libraryPath, fixtureSymbols);
}

test('ffi variadic calls infer supported tail values', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_sum_i32: {
      arguments: ['i32'], return: 'i32', variadic: true,
    },
    variadic_sum_f64: {
      arguments: ['i32'], return: 'f64', variadic: true,
    },
    variadic_identity_f64: {
      arguments: ['i32'], return: 'f64', variadic: true,
    },
    variadic_sum_i64: {
      arguments: ['i32'], return: 'i64', variadic: true,
    },
  });
  try {
    assert.strictEqual(functions.variadic_sum_i32(0), 0);
    assert.strictEqual(functions.variadic_sum_i32(3, 10, 20, 12), 42);
    assert.strictEqual(functions.variadic_sum_i32(2, -2147483648, 2147483647), -1);
    assert.strictEqual(
      functions.variadic_sum_i32(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), 55);
    assert.strictEqual(functions.variadic_sum_f64(2, 1.25, 2.75), 4);
    assert.strictEqual(functions.variadic_sum_f64(
      10, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25), 2.5);
    assert.strictEqual(functions.variadic_sum_f64(1, 5_000_000_000), 5_000_000_000);
    assert.ok(Object.is(functions.variadic_identity_f64(0, -0), -0));
    assert.ok(Number.isNaN(functions.variadic_sum_f64(1, NaN)));
    assert.strictEqual(functions.variadic_sum_f64(1, Infinity), Infinity);
    assert.strictEqual(functions.variadic_sum_i64(2, 20n, 22n), 42n);
    assert.strictEqual(functions.variadic_sum_i64(1, -(2n ** 63n)), -(2n ** 63n));
    assert.strictEqual(functions.variadic_sum_i64(1, 2n ** 63n - 1n), 2n ** 63n - 1n);
    assert.throws(() => functions.variadic_sum_i32(), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    assert.throws(() => functions.variadic_sum_i64(1, 2n ** 63n), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    assert.throws(() => functions.variadic_sum_i64(1, -(2n ** 63n) - 1n), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    for (const value of [true, {}, Symbol('unsupported'), () => {},
                         { valueOf: common.mustNotCall() }]) {
      assert.throws(() => functions.variadic_sum_i32(1, value), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    assert.strictEqual(functions.variadic_sum_i32(2, 20, 22), 42);
  } finally {
    lib.close();
  }
});

test('ffi explicit variadic tails validate before C promotions', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    char_is_signed: { arguments: [], return: 'i32' },
    variadic_sum_i32: {
      arguments: ['i32'], return: 'i32',
      variadic: ['i8', 'u8', 'i16', 'u16', 'bool', 'char'],
    },
    variadic_sum_f64: {
      arguments: ['i32'], return: 'f64', variadic: ['f32', 'f64'],
    },
    variadic_fixed_f32: {
      arguments: ['f32', 'i32'], return: 'f64', variadic: ['f64'],
    },
    variadic_sum_u64: {
      arguments: ['i32'], return: 'u64', variadic: ['u64'],
    },
  });
  try {
    const char = functions.char_is_signed() ? -128 : 255;
    const values = [-128, 255, -32768, 65535, 1, char];
    assert.strictEqual(functions.variadic_sum_i32(6, ...values),
                       values.reduce((total, value) => total + value, 0));
    for (const [index, value] of [[0, 128], [1, 256], [2, 32768], [3, -1],
                                  [4, true], [5, 256]]) {
      const invalid = [...values];
      invalid[index] = value;
      assert.throws(() => functions.variadic_sum_i32(6, ...invalid), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    }
    assert.strictEqual(functions.variadic_sum_f64(2, 1.1, 2), Math.fround(1.1) + 2);
    assert.strictEqual(functions.variadic_fixed_f32(1.1, 1, 2), Math.fround(1.1) + 2);
    assert.strictEqual(functions.variadic_sum_u64(1, 2n ** 64n - 1n), 2n ** 64n - 1n);
    assert.throws(() => functions.variadic_sum_f64(1, 1.1), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    assert.throws(() => functions.variadic_sum_f64(2, 1.1, 2, 3), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    for (const value of [-1n, 2n ** 64n]) {
      assert.throws(() => functions.variadic_sum_u64(1, value), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    }
  } finally {
    lib.close();
  }
});

test('ffi variadic mixed tails exceed register limits', () => {
  const count = 10;
  const explicit = Array.from({ length: count }, () => ['i32', 'f64', 'buffer']).flat();
  for (const variadic of [true, explicit]) {
    const { lib, functions } = ffi.dlopen(libraryPath, {
      variadic_mixed_many: {
        arguments: ['f64', 'buffer', 'i32'], return: 'f64', variadic,
      },
    });
    try {
      const seed = Buffer.from([2]);
      const bytes = Buffer.from([3]);
      const tail = [];
      let expected = 1.25 + seed[0];
      for (let index = 0; index < count; index++) {
        tail.push(index, index + 0.5, bytes);
        expected += index + (index + 0.5) + bytes[0];
      }
      assert.strictEqual(functions.variadic_mixed_many(1.25, seed, count, ...tail),
                         expected);
    } finally {
      lib.close();
    }
  }
});

test('ffi explicit variadic uint32 values preserve the unsigned range', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_identity_u32: {
      arguments: ['i32'], return: 'u32', variadic: ['u32'],
    },
  });
  try {
    for (const value of [0, 0x8000_0000, 0xFFFF_FFFF]) {
      assert.strictEqual(functions.variadic_identity_u32(0, value), value);
    }
    for (const value of [-1, 0x1_0000_0000, 1.5, 42n, NaN, Infinity]) {
      assert.throws(() => functions.variadic_identity_u32(0, value), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    }
  } finally {
    lib.close();
  }
});

test('ffi explicit empty tails remain variadic', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_sum_i32: {
      arguments: ['i32'], return: 'i32', variadic: [],
    },
  });
  try {
    assert.strictEqual(functions.variadic_sum_i32(0), 0);
    assert.throws(() => functions.variadic_sum_i32(1, 42), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    lib.close();
  }
});

test('ffi variadic calls reuse pointer and string conversions', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_pointer: {
      arguments: ['i32'], return: 'pointer', variadic: true,
    },
    variadic_string_lengths: {
      arguments: ['i32'], return: 'u64', variadic: true,
    },
    variadic_mixed: {
      arguments: ['i32'], return: 'f64', variadic: true,
    },
    variadic_write_i32: {
      arguments: ['pointer'], return: 'void', variadic: ['i8'],
    },
  });
  try {
    const buffer = Buffer.from([9, 4, 8]);
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset + 1, 1);
    const dataView = new DataView(buffer.buffer, buffer.byteOffset + 1, 1);
    const arrayBuffer = new Uint8Array([4]).buffer;
    for (const value of [buffer, view, dataView, arrayBuffer]) {
      assert.strictEqual(functions.variadic_pointer(0, value), ffi.getRawPointer(value));
    }
    assert.strictEqual(functions.variadic_pointer(0, null), 0n);
    assert.strictEqual(functions.variadic_pointer(0, undefined), 0n);
    assert.strictEqual(functions.variadic_string_lengths(3, 'a', 'bb', 'ccc'), 6n);
    assert.strictEqual(functions.variadic_mixed(1, 2, 3.5, 'abc', view), 13.5);
    const target = Buffer.alloc(4);
    assert.strictEqual(functions.variadic_write_i32(target, 42), undefined);
    assert.strictEqual(ffi.getInt32(ffi.getRawPointer(target)), 42);
    assert.throws(() => functions.variadic_string_lengths(1, 'bad\0string'), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    const detached = new ArrayBuffer(4);
    const detachedView = new Uint8Array(detached);
    structuredClone(detached, { transfer: [detached] });
    for (const value of [detached, detachedView]) {
      assert.throws(() => functions.variadic_pointer(0, value), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    }
  } finally {
    lib.close();
  }
});

test('ffi explicit variadic pointers accept raw addresses', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_pointer: {
      arguments: ['i32'], return: 'pointer', variadic: ['pointer'],
    },
  });
  try {
    const buffer = Buffer.from([42]);
    const pointer = ffi.getRawPointer(buffer);
    assert.strictEqual(functions.variadic_pointer(0, pointer), pointer);
    assert.throws(() => functions.variadic_pointer(0, -1n), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
    if (process.arch === 'ia32' || process.arch === 'arm') {
      assert.throws(() => functions.variadic_pointer(0, 2n ** 32n), {
        code: 'ERR_INVALID_ARG_VALUE',
      });
    }
  } finally {
    lib.close();
  }
});

test('ffi snprintf supports inferred tails and C99 truncation semantics', () => {
  const is32Bit = ['ia32', 'arm', 'mips', 'mipsel'].includes(process.arch);
  const sizeType = is32Bit ? 'uint32' : 'uint64';
  const asSize = (value) => (is32Bit ? value : BigInt(value));
  const { lib, functions } = ffi.dlopen(libraryPath, {
    ffi_snprintf: {
      arguments: ['buffer', sizeType, 'string'], return: 'i32', variadic: true,
    },
  });
  try {
    const expected = '42 1.25 ffi';
    const output = Buffer.alloc(64);
    const written = functions.ffi_snprintf(
      output, asSize(output.length), '%d %.2f %s', 42, 1.25, 'ffi');
    assert.strictEqual(written, Buffer.byteLength(expected));
    assert.strictEqual(output.toString('utf8', 0, written), expected);
    assert.strictEqual(output[written], 0);
    const small = Buffer.alloc(5);
    const required = functions.ffi_snprintf(
      small, asSize(small.length), '%d %.2f %s', 42, 1.25, 'ffi');
    assert.strictEqual(required, Buffer.byteLength(expected));
    assert.strictEqual(small.toString('utf8', 0, 4), '42 1');
    assert.strictEqual(small[4], 0);
    assert.strictEqual(functions.ffi_snprintf(
      null, asSize(0), '%d %.2f %s', 42, 1.25, 'ffi'), required);
    const one = Buffer.alloc(1, 0xFF);
    assert.strictEqual(functions.ffi_snprintf(one, asSize(1), 'abc'), 3);
    assert.strictEqual(one[0], 0);
    assert.strictEqual(functions.ffi_snprintf(
      output, asSize(output.length), '100%%'), 4);
    assert.strictEqual(output.toString('utf8', 0, 4), '100%');
    assert.strictEqual(functions.ffi_snprintf(
      output, asSize(output.length), '%.*f', 2, 1.25), 4);
    assert.strictEqual(output.toString('utf8', 0, 4), '1.25');
  } finally {
    lib.close();
  }
});

test('ffi snprintf explicit tails promote integer and float values', () => {
  const is32Bit = ['ia32', 'arm', 'mips', 'mipsel'].includes(process.arch);
  const sizeType = is32Bit ? 'uint32' : 'uint64';
  const asSize = (value) => (is32Bit ? value : BigInt(value));
  const { lib, functions } = ffi.dlopen(libraryPath, {
    ffi_snprintf: {
      arguments: ['buffer', sizeType, 'string'], return: 'i32',
      variadic: ['i8', 'f32', 'string'],
    },
  });
  try {
    const output = Buffer.alloc(64);
    const written = functions.ffi_snprintf(
      output, asSize(output.length), '%d %.2f %s', 42, 2, 'ffi');
    assert.strictEqual(written, Buffer.byteLength('42 2.00 ffi'));
    assert.strictEqual(output.toString('utf8', 0, written), '42 2.00 ffi');
    assert.throws(() => functions.ffi_snprintf(
      output, asSize(output.length), '%d %.2f %s', 128, 2, 'ffi'), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  } finally {
    lib.close();
  }
});

test('ffi variadic signatures validate properties and cache complete signatures', () => {
  const { lib } = ffi.dlopen(libraryPath);
  try {
    for (const variadic of [undefined, null, 1, 'auto', {}]) {
      assert.throws(() => lib.getFunction('variadic_sum_i32', {
        arguments: ['i32'], return: 'i32', variadic,
      }), { code: 'ERR_INVALID_ARG_TYPE' });
    }
    for (const variadic of [true, []]) {
      assert.throws(() => lib.getFunction('variadic_sum_i32', {
        arguments: [], return: 'i32', variadic,
      }), { code: 'ERR_INVALID_ARG_VALUE' });
    }
    for (const variadic of [['void'], ['i32\0'], ['unknown']]) {
      assert.throws(() => lib.getFunction('variadic_sum_i32', {
        arguments: ['i32'], return: 'i32', variadic,
      }), { code: 'ERR_INVALID_ARG_VALUE' });
    }
    for (const variadic of [[1], new Array(1)]) {
      assert.throws(() => lib.getFunction('variadic_sum_i32', {
        arguments: ['i32'], return: 'i32', variadic,
      }), { code: 'ERR_INVALID_ARG_TYPE' });
    }
    const fixed = lib.getFunction('add_i32', {
      arguments: ['i32', 'i32'], return: 'i32', variadic: false,
    });
    assert.strictEqual(fixed(20, 22), 42);
    assert.throws(() => fixed(20, 22, 1), { code: 'ERR_INVALID_ARG_VALUE' });
    const signature = { arguments: ['i32'], return: 'i32', variadic: ['i8'] };
    const first = lib.getFunction('variadic_sum_i32', signature);
    assert.strictEqual(first, lib.getFunction('variadic_sum_i32', {
      arguments: ['int32'], return: 'int32', variadic: ['int8'],
    }));
    assert.strictEqual(first, lib.functions.variadic_sum_i32);
    assert.strictEqual(first, lib.getFunctions().variadic_sum_i32);
    assert.strictEqual(first, lib.getFunctions({
      variadic_sum_i32: signature,
    }).variadic_sum_i32);
    assert.strictEqual(typeof first.pointer, 'bigint');
    for (const variadic of [false, true, [], ['i32'], ['i8', 'i8']]) {
      assert.throws(() => lib.getFunction('variadic_sum_i32', {
        arguments: ['i32'], return: 'i32', variadic,
      }), { code: 'ERR_INVALID_ARG_VALUE' });
    }
    signature.variadic[0] = 'i32';
    assert.throws(() => first(1, 128), { code: 'ERR_INVALID_ARG_VALUE' });
    const inherited = {
      __proto__: { variadic: true },
      arguments: ['i32'], return: 'i64',
    };
    const automatic = lib.getFunction('variadic_sum_i64', inherited);
    assert.strictEqual(automatic(1, 42n), 42n);
    assert.throws(() => lib.getFunction('variadic_sum_i64', {
      arguments: ['i32'], return: 'i64',
    }), { code: 'ERR_INVALID_ARG_VALUE' });
  } finally {
    lib.close();
  }
});

test('ffi variadic cached signatures reject return and fixed type changes', () => {
  const { lib } = ffi.dlopen(libraryPath);
  try {
    const first = lib.getFunction('variadic_sum_i32', {
      arguments: ['i32'], return: 'i32', variadic: ['i8'],
    });
    assert.throws(() => lib.getFunction('variadic_sum_i32', {
      arguments: ['i32'], return: 'f64', variadic: ['i8'],
    }), { code: 'ERR_INVALID_ARG_VALUE' });
    assert.throws(() => lib.getFunction('variadic_sum_i32', {
      arguments: ['u32'], return: 'i32', variadic: ['i8'],
    }), { code: 'ERR_INVALID_ARG_VALUE' });
    assert.strictEqual(first(1, 42), 42);
  } finally {
    lib.close();
  }
});

test('ffi callback signature getter errors precede registration', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    call_int_callback: { arguments: ['pointer', 'i32'], return: 'i32' },
  });
  let callback;
  try {
    const failure = new Error('callback signature getter failed');
    const types = ['i32'];
    Object.defineProperty(types, 0, { get() { throw failure; } });
    for (const signature of [
      { arguments: ['i32'], get variadic() { throw failure; } },
      { arguments: ['i32'], return: 'i32', variadic: types },
    ]) {
      assert.throws(() => lib.registerCallback(signature, common.mustNotCall()),
                    (error) => error === failure);
    }
    callback = lib.registerCallback({
      arguments: ['i32'], return: 'i32',
      get variadic() { return false; },
    }, common.mustCall((value) => value + 1));
    assert.strictEqual(functions.call_int_callback(callback, 41), 42);
  } finally {
    if (callback !== undefined) lib.unregisterCallback(callback);
    lib.close();
  }
});

test('ffi variadic signature getters preserve errors and library closure', () => {
  const { lib } = ffi.dlopen(libraryPath);
  try {
    const failure = new Error('signature getter failed');
    assert.throws(() => lib.getFunction('variadic_sum_i32', {
      arguments: ['i32'],
      get variadic() { throw failure; },
    }), (error) => error === failure);
    for (const trap of ['has', 'get']) {
      const signature = new Proxy({ arguments: ['i32'], variadic: true }, {
        [trap](target, key) {
          if (key === 'variadic') throw failure;
          return trap === 'has' ? Reflect.has(target, key) : Reflect.get(target, key);
        },
      });
      assert.throws(() => lib.getFunction('variadic_sum_i32', signature),
                    (error) => error === failure);
    }
    const types = ['i8'];
    Object.defineProperty(types, 0, { get() { throw failure; } });
    assert.throws(() => lib.getFunction('variadic_sum_i32', {
      arguments: ['i32'], variadic: types,
    }), (error) => error === failure);
    Object.defineProperty(types, 0, {
      get() {
        lib.close();
        return 'i8';
      },
    });
    assert.throws(() => lib.getFunction('variadic_sum_i32', {
      arguments: ['i32'], variadic: types,
    }), { code: 'ERR_FFI_LIBRARY_CLOSED' });
  } finally {
    lib.close();
  }
});

test('ffi variadic calls keep CIF and string storage local across callbacks', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_reenter: {
      arguments: ['i32'], return: 'i32',
      variadic: ['function', 'string', 'i32'],
    },
  });
  let leaf;
  let nested;
  try {
    leaf = lib.registerCallback({ arguments: ['i32'], return: 'i32' }, (value) => value);
    nested = lib.registerCallback({ arguments: ['i32'], return: 'i32' },
                                  () => functions.variadic_reenter(2, leaf, 'inner', 3));
    assert.strictEqual(functions.variadic_reenter(10, nested, 'outer', 20), 47);
    for (const variadic of [true, [], ['i32']]) {
      assert.throws(() => lib.registerCallback({
        arguments: ['i32'], return: 'i32', variadic,
      }, (value) => value), { code: 'ERR_INVALID_ARG_VALUE' });
    }
    const fixed = lib.registerCallback({
      arguments: ['i32'], return: 'i32', variadic: false,
    }, (value) => value);
    lib.unregisterCallback(fixed);
  } finally {
    if (nested !== undefined) lib.unregisterCallback(nested);
    if (leaf !== undefined) lib.unregisterCallback(leaf);
    lib.close();
  }
});

test('ffi variadic calls retain guards at optimized call sites', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    variadic_sum_i32: {
      arguments: ['i32'], return: 'i32', variadic: true,
    },
  });
  function call(count, first, second) {
    return functions.variadic_sum_i32(count, first, second);
  }
  try {
    eval('%PrepareFunctionForOptimization(call)');
    assert.strictEqual(call(2, 20, 22), 42);
    eval('%OptimizeFunctionOnNextCall(call)');
    assert.strictEqual(call(2, 20, 22), 42);
    assert.throws(() => call(2, 20, true), { code: 'ERR_INVALID_ARG_TYPE' });
    const retained = functions.variadic_sum_i32;
    lib.close();
    assert.throws(() => retained(0), { code: 'ERR_FFI_LIBRARY_CLOSED' });
    assert.throws(() => call(2, 20, 22), { code: 'ERR_FFI_LIBRARY_CLOSED' });
  } finally {
    lib.close();
  }
});

test('ffi calls support integer arithmetic and char semantics', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.strictEqual(symbols.add_i8(120, 10), -126);
    assert.strictEqual(symbols.add_u8(250, 10), 4);
    assert.strictEqual(symbols.add_i16(10_000, -58), 9_942);
    assert.strictEqual(symbols.add_u16(65_530, 10), 4);
    assert.strictEqual(symbols.add_i32(-10, 52), 42);
    assert.strictEqual(symbols.add_u32(0xFFFFFFFF, 1), 0);
    assert.strictEqual(symbols.add_i64(20n, 22n), 42n);
    assert.strictEqual(symbols.add_u64(20n, 22n), 42n);

    if (symbols.char_is_signed()) {
      assert.strictEqual(symbols.identity_char(-1), -1);
      assert.strictEqual(symbols.identity_char(-128), -128);
    } else {
      assert.strictEqual(symbols.identity_char(255), 255);
      assert.strictEqual(symbols.identity_char(128), 128);
    }
  } finally {
    lib.close();
  }
});

test('ffi calls support floating point and mixed signatures', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.strictEqual(symbols.add_f32(1.25, 2.75), 4);
    assert.strictEqual(symbols.multiply_f64(6, 7), 42);
    assert.strictEqual(symbols.sum_five_i32(10, 8, 7, 9, 8), 42);
    assert.strictEqual(symbols.sum_five_f64(10, 8, 7, 9, 8), 42);
    assert.strictEqual(symbols.mixed_operation(10, 2.5, 3.5, 4), 20);
  } finally {
    lib.close();
  }
});

test('ffi bool signatures use uint8 values', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.strictEqual(symbols.logical_and(1, 1), 1);
    assert.strictEqual(symbols.logical_and(1, 0), 0);
    assert.strictEqual(symbols.logical_or(0, 1), 1);
    assert.strictEqual(symbols.logical_not(0), 1);

    const boolAdder = lib.getFunction('add_u8', {
      arguments: ['bool', 'bool'],
      return: 'bool',
    });
    function callBoolAdder(a, b) {
      return boolAdder(a, b);
    }

    eval('%PrepareFunctionForOptimization(callBoolAdder)');
    assert.strictEqual(callBoolAdder(1, 0), 1);
    eval('%OptimizeFunctionOnNextCall(callBoolAdder)');
    assert.strictEqual(callBoolAdder(1, 0), 1);
    assert.throws(
      () => callBoolAdder(true, false), /Argument 0 must be a uint8/);
  } finally {
    lib.close();
  }
});

test('ffi pointer identity conversions work', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    const address = 0x1234n;
    assert.strictEqual(symbols.identity_pointer(address), address);
    assert.strictEqual(symbols.pointer_to_usize(address), address);
    assert.strictEqual(symbols.usize_to_pointer(address), address);
  } finally {
    lib.close();
  }
});

test('ffi strings and buffers cross the boundary correctly', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.strictEqual(symbols.string_length('hello ffi'), 9n);
    assert.strictEqual(symbols.string_length(cString('hello ffi')), 9n);
    assert.strictEqual(symbols.safe_strlen(null), -1);

    const concatenated = symbols.string_concat('hello ', 'ffi');
    assert.strictEqual(typeof concatenated, 'bigint');
    assert.strictEqual(ffi.toString(concatenated), 'hello ffi');
    symbols.free_string(concatenated);

    const duplicated = symbols.string_duplicate('copied string');
    assert.strictEqual(ffi.toString(duplicated), 'copied string');
    symbols.free_string(duplicated);

    const buffer = Buffer.from([1, 2, 3, 4]);
    assert.strictEqual(symbols.sum_buffer(buffer, BigInt(buffer.length)), 10n);
    symbols.reverse_buffer(buffer, BigInt(buffer.length));
    assert.deepStrictEqual([...buffer], [4, 3, 2, 1]);

    const typed = new Uint8Array([5, 6, 7, 8]);
    assert.strictEqual(symbols.sum_buffer(typed, BigInt(typed.byteLength)), 26n);

    const arrayBuffer = new Uint8Array([9, 10, 11, 12]).buffer;
    assert.strictEqual(symbols.sum_buffer(arrayBuffer, BigInt(arrayBuffer.byteLength)), 42n);
  } finally {
    lib.close();
  }
});

test('ffi string signatures convert strings to temporary pointers', () => {
  const { lib, functions } = ffi.dlopen(libraryPath, {
    string_length: { arguments: ['string'], return: 'u64' },
    safe_strlen: { arguments: ['str'], return: 'i32' },
  });
  try {
    assert.strictEqual(functions.string_length('hello ffi'), 9n);
    assert.strictEqual(functions.safe_strlen('hello ffi'), 9);
    assert.strictEqual(functions.safe_strlen(null), -1);
    assert.strictEqual(functions.safe_strlen(undefined), -1);
  } finally {
    lib.close();
  }
});

test('ffi buffer and ArrayBuffer signatures pass backing-store pointers', () => {
  {
    const { lib, functions } = ffi.dlopen(libraryPath, {
      first_byte: { arguments: ['buffer'], return: 'u8' },
    });
    try {
      assert.strictEqual(functions.first_byte(Buffer.from([42, 1])), 42);
      assert.strictEqual(functions.first_byte(new Uint8Array([43, 1])), 43);
    } finally {
      lib.close();
    }
  }

  {
    const { lib, functions } = ffi.dlopen(libraryPath, {
      first_byte: { arguments: ['arraybuffer'], return: 'u8' },
    });
    try {
      const ab = new Uint8Array([44, 1]).buffer;
      assert.strictEqual(functions.first_byte(ab), 44);
    } finally {
      lib.close();
    }
  }
});

test('ffi typed array accessors work', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    const ints = new Int32Array([10, 20, 30, 40]);
    assert.strictEqual(symbols.array_get_i32(ints, 2n), 30);
    symbols.array_set_i32(ints, 1n, 22);
    assert.deepStrictEqual([...ints], [10, 22, 30, 40]);

    const doubles = new Float64Array([1, 2, 3, 4]);
    assert.strictEqual(symbols.array_get_f64(doubles, 1n), 2);
    symbols.array_set_f64(doubles, 2n, 39.5);
    assert.deepStrictEqual([...doubles], [1, 2, 39.5, 4]);
  } finally {
    lib.close();
  }
});

test('ffi global state helpers work', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    symbols.reset_counter();
    assert.strictEqual(symbols.get_counter(), 0);
    symbols.increment_counter();
    symbols.increment_counter();
    assert.strictEqual(symbols.get_counter(), 2);
    symbols.reset_counter();
    assert.strictEqual(symbols.get_counter(), 0);
  } finally {
    lib.close();
  }
});

test('ffi validates invalid arguments', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.throws(() => symbols.add_i32(1), /Invalid argument count: expected 2, got 1/);
    assert.throws(() => symbols.add_i32('1', 2), /Argument 0 must be an int32/);
    assert.throws(() => symbols.add_i8(1.5, 1), /Argument 0 must be an int8/);
    assert.throws(() => symbols.add_i8(200, 1), /Argument 0 must be an int8/);
    assert.throws(() => symbols.add_u8(Number.NaN, 1), /Argument 0 must be a uint8/);
    assert.throws(() => symbols.add_u8(300, 1), /Argument 0 must be a uint8/);
    assert.throws(() => symbols.add_i16(1.5, 1), /Argument 0 must be an int16/);
    assert.throws(() => symbols.add_i16(40_000, 1), /Argument 0 must be an int16/);
    assert.throws(() => symbols.add_u16(Number.NaN, 1), /Argument 0 must be a uint16/);
    assert.throws(() => symbols.add_u16(70_000, 1), /Argument 0 must be a uint16/);
    assert.throws(() => symbols.add_i64(1, 2n), /Argument 0 must be an int64/);
    assert.throws(() => symbols.add_i64(1.5, 2n), /Argument 0 must be an int64/);
    assert.throws(() => symbols.add_i64(2n ** 63n, 2n), /Argument 0 must be an int64/);
    assert.throws(() => symbols.add_i64(-(2n ** 63n) - 1n, 2n), /Argument 0 must be an int64/);
    assert.throws(() => symbols.add_u64('1', 2n), /Argument 0 must be a uint64/);
    assert.throws(() => symbols.add_u64(1, 2n), /Argument 0 must be a uint64/);
    assert.throws(() => symbols.add_u64(Number.NaN, 2n), /Argument 0 must be a uint64/);
    assert.throws(() => symbols.add_u64(-1n, 2n), /Argument 0 must be a uint64/);
    assert.throws(() => symbols.add_u64(2n ** 64n, 2n), /Argument 0 must be a uint64/);
    assert.throws(() => symbols.identity_pointer(-1n), /Argument 0 must be a non-negative pointer bigint/);
    assert.throws(() => symbols.string_length('hello\0ffi'), /Argument 0 must not contain null bytes/);
    assert.throws(() => symbols.string_length(Symbol('x')), /must be a buffer, an ArrayBuffer, a string, or a bigint/);

    if (process.arch === 'ia32' || process.arch === 'arm') {
      assert.throws(() => symbols.identity_pointer(2n ** 32n), /platform pointer range|non-negative pointer bigint/);
    }
  } finally {
    lib.close();
  }
});

test('ffi division helpers behave as expected', () => {
  const { lib, functions: symbols } = getLibrary();
  try {
    assert.strictEqual(symbols.divide_i32(84, 2), 42);
    assert.strictEqual(symbols.divide_i32(84, 0), 0);
    assert.strictEqual(symbols.safe_strlen(null), -1);
  } finally {
    lib.close();
  }
});
