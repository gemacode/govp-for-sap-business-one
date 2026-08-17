import type { B1GovpRecord, B1GovpStore } from './types.js';

export class MemoryB1GovpStore implements B1GovpStore {
  private readonly values = new Map<string, B1GovpRecord>();

  async get(key: string) {
    const value = this.values.get(key);
    return value ? structuredClone(value) : undefined;
  }

  async save(record: B1GovpRecord) {
    this.values.set(record.key, structuredClone(record));
  }

  snapshot() {
    return [...this.values.values()].map((value) => structuredClone(value));
  }
}
