import { describe, expect, it, vi } from 'vitest';

describe('web adapter in a non-browser environment', () => {
  it('imports without throwing and subscribe returns a no-op', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const mod = await import('../src/web');
    const onBackground = vi.fn();
    const unsubscribe = mod.webLifecycle().subscribe({ onBackground, onForeground: vi.fn() });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();

    const s = mod.webStorage();
    await s.setItem('k', 'v');
    expect(await s.getItem('k')).toBe('v');
  });
});
