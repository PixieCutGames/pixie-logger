import { describe, it, expect } from 'vitest';
import { makeKeyRedactor, normalizeKey, REDACTED, sanitizeRecord } from '../src/sanitize';

const redact = makeKeyRedactor([]);
const clean = (v: Record<string, unknown>) => sanitizeRecord(v, redact);

describe('sanitizeRecord: value rules', () => {
  it('keeps null, booleans, strings and finite numbers', () => {
    expect(clean({ a: null, b: true, c: false, d: 'x', e: 0, f: -1.5 })).toEqual({
      a: null, b: true, c: false, d: 'x', e: 0, f: -1.5,
    });
  });

  it('turns NaN and ±Infinity into null', () => {
    expect(clean({ a: NaN, b: Infinity, c: -Infinity })).toEqual({ a: null, b: null, c: null });
  });

  it('turns bigint into a string', () => {
    expect(clean({ big: 12345678901234567890n })).toEqual({ big: '12345678901234567890' });
  });

  it('omits undefined, functions and symbols in objects', () => {
    const out = clean({ keep: 1, u: undefined, f: () => 1, s: Symbol('x') });
    expect(out).toEqual({ keep: 1 });
    expect(Object.keys(out)).toEqual(['keep']);
  });

  it('turns undefined, functions and symbols into null inside arrays', () => {
    expect(clean({ arr: [1, undefined, () => 1, Symbol('x'), 'x'] })).toEqual({
      arr: [1, null, null, null, 'x'],
    });
  });

  it('turns Date into an ISO string, invalid Date into null', () => {
    expect(clean({ d: new Date(0), bad: new Date('nope') })).toEqual({
      d: '1970-01-01T00:00:00.000Z',
      bad: null,
    });
  });

  it('turns Error into { name, message } only', () => {
    const err = new TypeError('boom') as TypeError & { extra?: string };
    err.extra = 'secret stuff';
    expect(clean({ err })).toEqual({ err: { name: 'TypeError', message: 'boom' } });
  });

  it('sanitises nested arrays and objects', () => {
    expect(
      clean({ list: [[1, NaN], { d: new Date(0), f: () => 1 }, [new Error('x')]] }),
    ).toEqual({
      list: [[1, null], { d: '1970-01-01T00:00:00.000Z' }, [{ name: 'Error', message: 'x' }]],
    });
  });

  it('uses own enumerable keys of other objects', () => {
    const proto = { inherited: 1 };
    const obj = Object.create(proto) as Record<string, unknown>;
    obj.own = 2;
    Object.defineProperty(obj, 'hidden', { value: 3, enumerable: false });
    expect(clean({ obj })).toEqual({ obj: { own: 2 } });
  });
});

describe('sanitizeRecord: circular references and depth', () => {
  it('marks circular references', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    const arr: unknown[] = [];
    arr.push(arr);
    expect(clean(o)).toEqual({ a: 1, self: '[Circular]' });
    expect(clean({ arr })).toEqual({ arr: ['[Circular]'] });
  });

  it('serialises the same object twice in sibling positions', () => {
    const shared = { a: 1 };
    expect(clean({ x: shared, y: shared, z: [shared, shared] })).toEqual({
      x: { a: 1 },
      y: { a: 1 },
      z: [{ a: 1 }, { a: 1 }],
    });
  });

  it('truncates at depth 6 in a 7-level object', () => {
    const input = { l1: { l2: { l3: { l4: { l5: { l6: { l7: 'deep' } } } } } } };
    expect(clean(input)).toEqual({ l1: { l2: { l3: { l4: { l5: { l6: '[Truncated]' } } } } } });
  });
});

describe('redaction', () => {
  it('normalises keys', () => {
    expect(normalizeKey('X-Auth_Token')).toBe('xauthtoken');
  });

  it.each(['password', 'userEmail', 'X-Auth-Token', 'refresh_token', 'userOtp', 'PIN'])(
    'redacts %s at any depth',
    (key) => {
      const out = clean({ [key]: 'v', nested: { deeper: [{ [key]: { inner: 'v' } }] } });
      expect(out[key]).toBe(REDACTED);
      expect(out.nested).toEqual({ deeper: [{ [key]: REDACTED }] });
    },
  );

  it.each(['notPaid', 'spinner', 'author', 'sessionCount'])('does not redact %s', (key) => {
    expect(clean({ [key]: 'v' })).toEqual({ [key]: 'v' });
  });

  it('redacts extra keys by normalised equality', () => {
    const r = makeKeyRedactor(['nationalNumber']);
    expect(r('national_number')).toBe(true);
    expect(r('nationalNumberHint')).toBe(false);
    expect(sanitizeRecord({ national_number: '123' }, r)).toEqual({ national_number: REDACTED });
  });

  it('does not inspect redacted values', () => {
    const o: Record<string, unknown> = {};
    Object.defineProperty(o, 'password', {
      enumerable: true,
      get() {
        throw new Error('should not be read');
      },
    });
    expect(clean(o)).toEqual({ password: REDACTED });
  });
});

describe('sanitizeRecord: __proto__ keys', () => {
  it('keeps a __proto__ key as data and does not change the prototype', () => {
    const out = clean(JSON.parse('{"__proto__":{"a":1},"b":2}'));
    const json = JSON.stringify(out);
    expect(json).toContain('"__proto__"');
    expect(json).toContain('"b"');
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});
