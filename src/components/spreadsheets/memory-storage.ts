import type { ILocalStorageService } from '@univerjs/core';

export class MemoryLocalStorageService implements ILocalStorageService {
  private readonly items = new Map<string, unknown>();

  async getItem<T>(key: string): Promise<T | null> {
    return this.items.has(key) ? (this.items.get(key) as T) : null;
  }

  async setItem<T>(key: string, value: T): Promise<T> {
    this.items.set(key, value);
    return value;
  }

  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }

  async clear(): Promise<void> {
    this.items.clear();
  }

  async key(index: number): Promise<string | null> {
    return [...this.items.keys()][index] ?? null;
  }

  async keys(): Promise<string[]> {
    return [...this.items.keys()];
  }

  async iterate<T, U>(iteratee: (value: T, key: string, iterationNumber: number) => U): Promise<U> {
    let iteration = 1;
    let result: U | undefined;
    for (const [key, value] of this.items) {
      result = iteratee(value as T, key, iteration);
      iteration += 1;
      if (result !== undefined) {
        return result;
      }
    }
    return result as U;
  }
}
