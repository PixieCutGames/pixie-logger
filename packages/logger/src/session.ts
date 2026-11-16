type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array };

/** 32 lowercase hex chars (16 random bytes). Never throws. */
export function randomId(random: () => number): string {
  const bytes = new Array<number>(16).fill(0);
  let filled = false;
  try {
    const c = (globalThis as { crypto?: CryptoLike }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const arr = new Uint8Array(16);
      c.getRandomValues(arr);
      for (let i = 0; i < 16; i++) bytes[i] = arr[i] ?? 0;
      filled = true;
    }
  } catch {
    filled = false;
  }
  if (!filled) {
    for (let i = 0; i < 16; i++) {
      let r: number;
      try {
        r = random();
      } catch {
        r = Math.random();
      }
      bytes[i] = Math.floor(r * 256) & 0xff;
    }
  }
  let out = '';
  for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
  return out;
}
