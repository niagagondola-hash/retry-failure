import type { ColumnType } from 'typeorm';

/**
 * Helper untuk menangani tipe UUID pada FK/Column biasa.
 * PostgreSQL menggunakan native 'uuid', SQLite menggunakan 'varchar' (36 char).
 */
export function getUuidColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'varchar' : 'uuid';
}

/**
 * Helper untuk tipe timestamp/datetime.
 * PostgreSQL menggunakan 'timestamp' (native, dengan precision via migration SQL).
 * SQLite (better-sqlite3) menggunakan 'datetime' (karena tidak support 'timestamp').
 */
export function getTimestampColumnType(): ColumnType {
  return process.env.DB_TYPE === 'sqlite' ? 'datetime' : 'timestamp';
}