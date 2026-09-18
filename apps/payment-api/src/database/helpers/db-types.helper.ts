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
 * 'timestamp' didukung secara native baik oleh PostgreSQL maupun SQLite di TypeORM.
 */
export function getTimestampColumnType(): ColumnType {
  return 'timestamp';
}