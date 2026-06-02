import { loadEnv } from './env';

export function useSqliteRelationalStore(): boolean {
  return loadEnv().dataStore === 'vultr_sqlite';
}
