-- PostgreSQL 16 init script (run once on container first start)
-- Enable pgcrypto for gen_random_uuid() (PG 13+ has it builtin, but enabling is safer).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schema `public` is default. No further setup needed here; TypeORM migrations handle tables.
