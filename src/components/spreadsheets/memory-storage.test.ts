import { describe, expect, it } from 'vitest';
import { MemoryLocalStorageService } from './memory-storage';

describe('the in-memory storage Univer is given', () => {
  it('keeps values for the life of the instance and nowhere else', async () => {
    const storage = new MemoryLocalStorageService();
    expect(await storage.getItem('missing')).toBeNull();
    await storage.setItem('patterns', ['0.00', '"R$" #,##0']);
    expect(await storage.getItem('patterns')).toEqual(['0.00', '"R$" #,##0']);
    expect(await storage.keys()).toEqual(['patterns']);
    expect(await storage.key(0)).toBe('patterns');
    expect(await new MemoryLocalStorageService().getItem('patterns')).toBeNull();
  });

  it('removes, clears and iterates like the service it replaces', async () => {
    const storage = new MemoryLocalStorageService();
    await storage.setItem('a', 1);
    await storage.setItem('b', 2);
    const seen: string[] = [];
    expect(await storage.iterate<number, undefined>((value, key, n) => void seen.push(`${key}${value}${n}`))).toBeUndefined();
    expect(seen).toEqual(['a11', 'b22']);
    expect(await storage.iterate<number, string | undefined>((value, key) => (value === 2 ? key : undefined))).toBe('b');
    await storage.removeItem('a');
    expect(await storage.keys()).toEqual(['b']);
    await storage.clear();
    expect(await storage.keys()).toEqual([]);
  });
});
