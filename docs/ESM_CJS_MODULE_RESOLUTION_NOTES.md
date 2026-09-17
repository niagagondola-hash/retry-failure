# ESM vs CJS Module Resolution - Catatan Teknis

> **Konteks**: Project monorepo dengan mix CJS (NestJS, TypeORM) + ESM-only dependency (cockatiel v4).
> **Dibuat**: 2026-09-14
> **Status**: Solved - build shared package ke `dist/`

---

## Daftar Isi

1. [Ringkasan Masalah](#1-ringkasan-masalah)
2. [Apa itu CJS dan ESM?](#2-apa-itu-cjs-dan-esm)
3. [Kenapa Resolver Berbeda?](#3-kenapa-resolver-berbeda)
4. [Kapan Masalah Muncul?](#4-kapan-masalah-muncul)
5. [Gejala yang Muncul](#5-gejala-yang-muncul)
6. [Kenapa Typecheck dan Test Lolos?](#6-kenapa-typecheck-dan-test-lolos)
7. [Solusi yang Diterapkan](#7-solusi-yang-diterapkan)
8. [Alternatif Lain](#8-alternatif-lain)
9. [Checklist: Apakah Project Anda Berisiko?](#9-checklist-apakah-project-anda-berisiko)
10. [Debugging Guide](#10-debugging-guide)
11. [Saran Realistis untuk Project Baru](#11-saran-realistis-untuk-project-baru)
12. [Glossary](#12-glossary)

---

## 1. Ringkasan Masalah

Monorepo dengan struktur:

```text
apps/payment-api/          -> CJS (tsconfig: "module": "commonjs")
packages/resilience/       -> CJS (tidak ada "type": "module")
  └── import cockatiel v4  -> ESM-only (package.json: "type": "module")
```

Saat `payment-api` import `@retry-failure/resilience`, Node.js runtime gagal resolve module dengan error:

```text
ERR_UNSUPPORTED_DIR_IMPORT: Directory import '.../errors' is not supported
ERR_MODULE_NOT_FOUND: Cannot find module '.../errors/index'
```

---

## 2. Apa itu CJS dan ESM?

### CommonJS (CJS)

- Sistem module **lama** Node.js (sejak 2009)
- Syntax: `require()` / `module.exports`
- File extension: `.js` (atau `.cjs`)
- Package.json: tidak ada `"type"` field, atau `"type": "commonjs"`

```js
// CJS
const express = require('express');
module.exports = { hello: () => 'world' };
```

### ES Modules (ESM)

- Sistem module **standar JavaScript** (TC39, sejak 2015)
- Syntax: `import` / `export`
- File extension: `.mjs` (atau `.js` bila package.json `"type": "module"`)
- Package.json: `"type": "module"`

```js
// ESM
import express from 'express';
export const hello = () => 'world';
```

### Perbedaan Key

| Aspek | CJS | ESM |
|---|---|---|
| Loading | Sinkron (blocking) | Asynchronous |
| `this` di top-level | `module.exports` | `undefined` |
| `__dirname` / `__filename` | Tersedia | Tidak ada (pakai `import.meta.url`) |
| `require()` | Tersedia | Tidak ada (pakai dynamic `import()`) |
| JSON import | `require('./data.json')` | `import data from './data.json'` (assert) |
| **Directory import** | ✅ Auto-append `/index.js` | ❌ Tidak support |
| **File extension** | Opsional | **Wajib** (`.js` untuk runtime, `.ts` tidak dikenal) |
| **Module resolution** | Permissive | Strict (sesuai TC39 spec) |

---

## 3. Kenapa Resolver Berbeda?

### Sejarah

```text
2009 ─── Node.js lahir dengan CJS
         └── require('./errors') -> auto-append /errors/index.js
         └── "Nyaman untuk developer" - tidak perlu tulis extension

2015 ─── TC39 (JavaScript standard body) ratifikasi ES Modules
         └── Spec: import WAJIB full path + extension
         └── Alasan: deterministic, predictable, static-analyzable
         └── "Browser-compatible" - browser butuh exact URL

2021 ─── Node.js v12+ support ESM secara native
         └── Ikuti TC39 spec: ESM resolver strict
         └── Tapi CJS resolver tetap permissive (backward compat)
         └── Node.js TIDAK bisa menyamakan karena:
             ├── Jutaan package lama bergantung pada CJS behavior
             ├── TC39 spec tidak bisa di-negotiate
             └── Browser ESM compatibility (same spec)
```

### Kenapa Node.js Tidak Bisa "Menyamakan"?

1. **CJS tidak bisa dibuat strict** - jutaan package di npm pakai directory import (`require('./routes')` -> `./routes/index.js`). Bila diubah, semuanya break.

2. **ESM tidak bisa dibuat permissive** - TC39 spec mengharuskan explicit path. Browser juga ikut spec ini. Bila Node.js relax ESM, tidak compatible dengan browser.

3. **Package author bebas memilih** - cockatiel v4 memilih ESM-only (`"type": "module"`) untuk align dengan modern JavaScript. Itu hak mereka.

**Inti**: Ini bukan bug, bukan konfigurasi salah, bukan code style. Ini **realitas transisi ekosistem** yang sudah berjalan 3+ tahun dan belum selesai.

---

## 4. Kapan Masalah Muncul?

Masalah muncul ketika **module graph mengandung campuran CJS + ESM**:

```text
Scenario yang trigger masalah:

  CJS project (payment-api)
    └── import CJS package (packages/resilience, main: "src/index.ts")
          └── import ESM-only package (cockatiel v4, "type": "module")
                └── Node.js switch resolver ke ESM mode
                      └── ESM resolver encounter directory import -> ERROR
```

### Tiga Kondisi yang Harus Terpenuhi

| # | Kondisi | Contoh di project ini |
|---|---|---|
| 1 | CJS project import package via `main` field yang point ke `.ts` source | `packages/resilience/package.json: "main": "src/index.ts"` |
| 2 | Package source punya directory imports (barrel exports) | `export * from './errors'` (tanpa `/index`) |
| 3 | Module graph mengandung ESM-only dependency | cockatiel v4 (`"type": "module"`) |

Bila ketiganya terpenuhi -> `ERR_UNSUPPORTED_DIR_IMPORT` atau `ERR_MODULE_NOT_FOUND`.

### Kapan TIDAK Muncul?

| Scenario | Kenapa aman |
|---|---|
| CJS project, semua dependency CJS | CJS resolver auto-append `/index` - no problem |
| ESM project (`"type": "module"`), semua dependency ESM | ESM resolver, tapi semua import sudah explicit path |
| CJS project, dependency ESM-only, tapi `main` field point ke compiled `dist/index.js` | Compiled CJS tidak trigger ESM resolver switch |
| Test via Jest (ts-jest) | ts-jest compile ke CJS, `require()` auto-append `/index` |
| TypeScript typecheck (`tsc --noEmit`) | TypeScript punya resolver sendiri (permissive, auto-append) |

---

## 5. Gejala yang Muncul

### Error 1: `ERR_UNSUPPORTED_DIR_IMPORT`

```text
Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '.../errors' is not supported
resolving ES modules imported from .../packages/resilience/src/index.ts
```

**Penyebab**: `export * from './errors'` - ESM resolver tidak auto-append `/index`.

### Error 2: `ERR_MODULE_NOT_FOUND` (setelah fix /index)

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../errors/index'
imported from .../packages/resilience/src/index.ts
```

**Penyebab**: `export * from './errors/index'` - ESM resolver tidak menemukan file `errors/index` (butuh extension `.js`, tapi file-nya `.ts`).

### Error 3: Hanya muncul di runtime, tidak di typecheck/test

```bash
pnpm typecheck    -> PASS (TypeScript resolver permissive)
pnpm test         -> PASS (ts-jest compile ke CJS, require() permissive)
pnpm start:dev    -> FAIL (Node.js ESM resolver strict)
```

---

## 6. Kenapa Typecheck dan Test Lolos?

Tiga resolver berbeda dengan behavior berbeda:

```text
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript Resolver                          │
│  (dipakai oleh: tsc --noEmit / typecheck)                       │
│                                                                 │
│  './errors' -> resolve ke './errors/index.ts'                    │
│  Auto-append: ✅ YES                                            │
│  Extension: opsional                                            │
│  Result: PASS (tidak detect masalah)                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    CJS Resolver (Node.js require())              │
│  (dipakai oleh: Jest/ts-jest, compiled CJS runtime)             │
│                                                                 │
│  require('./errors') -> resolve ke './errors/index.js'           │
│  Auto-append: ✅ YES                                            │
│  Extension: opsional                                            │
│  Result: PASS (tidak detect masalah)                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    ESM Resolver (Node.js import)                 │
│  (dipakai oleh: nest start --watch, node dist/main.js)          │
│  (triggered oleh: cockatiel v4 "type": "module" di graph)       │
│                                                                 │
│  import './errors' -> ERROR: directory import not supported       │
│  import './errors/index' -> ERROR: cannot find module (no .js)    │
│  Auto-append: ❌ NO                                             │
│  Extension: WAJIB (.js)                                         │
│  Result: FAIL                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Diagram Alur

```text
pnpm typecheck
  └── tsc --noEmit
      └── TypeScript resolver (permissive)
          └── './errors' -> './errors/index.ts' ✅ PASS

pnpm test
  └── jest (ts-jest)
      └── Compile .ts -> CJS JavaScript in-memory
          └── require('./errors') -> './errors/index.js' ✅ PASS

pnpm start:dev
  └── nest start --watch
      └── tsc compile -> CJS JavaScript di dist/
          └── node dist/main.js
              └── require('@retry-failure/resilience')
                  └── main: "src/index.ts" (source TypeScript!)
                      └── Node.js load .ts file
                          └── cockatiel (ESM) di graph
                              └── Switch ke ESM resolver
                                  └── './errors' -> ❌ ERROR
```

---

## 7. Solusi yang Diterapkan

### Inti Solusi

**Build `packages/resilience` ke `dist/` (compiled CJS JavaScript)**, lalu point `main` field ke `dist/index.js`.

### Sebelum vs Sesudah

```text
SEBELUM (source TypeScript langsung):
  packages/resilience/package.json:
    "main": "src/index.ts"     ← Node.js load source .ts

  require('@retry-failure/resilience')
    -> src/index.ts
    -> cockatiel (ESM) di graph
    -> ESM resolver aktif
    -> './errors' -> ❌ ERROR

SETELAH (compiled CJS JavaScript):
  packages/resilience/package.json:
    "main": "dist/index.js"    ← Node.js load compiled CJS

  require('@retry-failure/resilience')
    -> dist/index.js (CJS: "use strict"; var __createBinding...)
    -> require('cockatiel') -> Node.js loadESMFromCJS (bridge)
    -> CJS resolver tetap aktif
    -> './errors' -> './errors/index.js' ✅ PASS
```

### Perubahan File

| File | Perubahan |
|---|---|
| `packages/resilience/tsconfig.build.json` | Baru - config build (exclude tests, declaration + sourceMap) |
| `packages/resilience/package.json` | `main: src/index.ts` -> `dist/index.js`; tambah script `build` + `build:watch` |
| `apps/payment-api/tsconfig.build.json` | Baru - exclude tests dari build (fix rootDir -> output `dist/main.js`) |
| `apps/payment-api/package.json` | `build` script pakai `tsconfig.build.json` |
| Root `package.json` | `dev`/`build`/`db:migrate` auto-build resilience pertama |

### Dev Workflow

```bash
# Start semua apps (auto-build resilience dulu)
pnpm dev

# Bila resilience source berubah, rebuild manual:
pnpm build:resilience

# Atau pakai watch mode (rebuild otomatis saat file berubah):
pnpm --filter @retry-failure/resilience build:watch

# Jest tetap pakai src/ (bukan dist/) via moduleNameMapper:
# '^@retry-failure/resilience$': '<rootDir>/../../packages/resilience/src/index.ts'
```

---

## 8. Alternatif Lain

| # | Alternatif | Kelebihan | Kekurangan | Status |
|---|---|---|---|---|
| A | **Build ke dist/** (yang dipakai) | Simple, reliable, no module system change | Butuh build step sebelum `pnpm dev` | ✅ Dipakai |
| B | Set semua project ke ESM (`"type": "module"`) | Konsisten, modern | NestJS 11 + TypeORM 0.3 belum fully ESM-compatible. Jest butuh ESM experimental. Banyak error. | ❌ Terlalu berisiko |
| C | Upgrade cockatiel ke versi yang support CJS | Tidak ada masalah resolver | Cockatiel v4 is ESM-only by design. Tidak ada CJS build. | ❌ Tidak ada |
| D | Ganti cockatiel dengan library lain | Bebas pilih CJS-compatible | Plan section 3 mensyaratkan cockatiel | ❌ Tidak boleh |
| E | Pakai `tsx` sebagai runtime (bukan `node`) | tsx handle ESM+CJS transparently | `tsx` belum production-grade. `nest start` tidak support tsx. | ⚠️ Dev only |
| F | Pakai `esbuild` untuk bundle semuanya jadi 1 file | No module resolution issue | NestJS decorator metadata hilang (esbuild tidak support `emitDecoratorMetadata`). Tidak compatible. | ❌ Break decorator |

### Kenapa Opsi A (Build ke dist/) Adalah yang Terbaik?

1. **No module system change** - CJS tetap CJS, ESM tetap ESM, bridge via `loadESMFromCJS`
2. **Standard pattern** - banyak monorepo besar pakai pattern ini (NestJS itself, TypeORM, Prisma)
3. **Jest tetap pakai source** - via `moduleNameMapper`, tidak perlu rebuild saat test
4. **Production-ready** - `dist/` adalah apa yang di-deploy, bukan `src/`
5. **Minimal change** - hanya tambah build step, tidak ubah kode

---

## 9. Checklist: Apakah Project Anda Berisiko?

Tandai semua yang berlaku untuk project Anda:

### Risiko Tinggi (3 kondisi harus terpenuhi)

- [ ] Project Anda CJS (`tsconfig.json: "module": "commonjs"`)
- [ ] Ada shared package dengan `"main": "src/index.ts"` (point ke source, bukan dist)
- [ ] Dependency tree mengandung package ESM-only (`"type": "module"` di package.json-nya)

**Bila ketiganya tercentang** -> Anda akan kena `ERR_UNSUPPORTED_DIR_IMPORT` di runtime.

### Risiko Sedang

- [ ] Shared package punya barrel exports (`export * from './subfolder'` tanpa `/index`)
- [ ] `pnpm dev` / `nest start --watch` load TypeScript source langsung (tanpa compile ke dist)
- [ ] Node.js version < 22 (ESM resolver lebih strict di v20)

### Risiko Rendah (biasanya aman)

- [ ] Semua dependency CJS (tidak ada `"type": "module"`)
- [ ] Shared package `"main"` point ke `dist/index.js` (compiled)
- [ ] Project pakai bundler (esbuild, webpack, vite) yang resolve sendiri

---

## 10. Debugging Guide

### Step 1: Konfirmasi error adalah ESM resolution issue

```bash
# Error message harus mengandung salah satu:
# - ERR_UNSUPPORTED_DIR_IMPORT
# - ERR_MODULE_NOT_FOUND (dengan path yang ada directory)
# - "is not supported resolving ES modules"
```

### Step 2: Identifikasi ESM-only dependency

```bash
# Cari package dengan "type": "module" di node_modules
grep -r '"type": "module"' node_modules/*/package.json | head -10

# Atau cek package yang Anda curigai:
cat node_modules/cockatiel/package.json | grep '"type"'
# Output: "type": "module" -> ESM-only
```

### Step 3: Cek shared package main field

```bash
cat packages/your-shared-package/package.json | grep '"main"'
# Bila: "main": "src/index.ts" -> BERISIKO
# Bila: "main": "dist/index.js" -> AMAN (sudah compiled)
```

### Step 4: Cek barrel exports

```bash
# Cari directory imports tanpa /index atau extension
grep -rn "from '\./" packages/your-shared-package/src/index.ts
# Bila: export * from './errors' -> BERISIKO (ESM tidak support)
# Bila: export * from './errors/index' -> MASIH BERISIKO (butuh .js extension)
```

### Step 5: Verify fix

```bash
# Build shared package
pnpm --filter your-shared-package build

# Verify dist/ ada
ls packages/your-shared-package/dist/

# Start app (bukan test, bukan typecheck)
cd apps/your-app && pnpm start:dev
# Bila "listening on :PORT" muncul -> FIXED
# Bila masih error -> cek apakah main field sudah point ke dist/
```

---

## 11. Saran Realistis untuk Project Baru

### Prinsip 1: Build Shared Packages ke `dist/`

**Selalu** build shared/internal packages ke compiled JavaScript. Jangan point `main` ke source `.ts`.

```json
// packages/shared/package.json
{
  "main": "dist/index.js",        // ✅ compiled CJS
  "types": "dist/index.d.ts",      // ✅ type declarations
  "scripts": {
    "build": "tsc -p tsconfig.build.json"
  }
}
```

**Alasan**: Node.js runtime tidak bisa load `.ts` files. TypeScript source hanya untuk dev tools (IDE, typecheck, Jest dengan ts-jest).

### Prinsip 2: Pisahkan `tsconfig.json` dan `tsconfig.build.json`

```json
// tsconfig.json - untuk typecheck + IDE (include tests)
{
  "include": ["src/**/*", "tests/**/*"]
}

// tsconfig.build.json - untuk build ke dist (exclude tests)
{
  "extends": "./tsconfig.json",
  "exclude": ["tests", "node_modules", "dist"]
}
```

**Alasan**: Bila tests di-include, `rootDir` berubah -> output path menjadi `dist/src/main.js` bukan `dist/main.js`.

### Prinsip 3: Auto-build di `pnpm dev` Script

```json
// root package.json
{
  "scripts": {
    "dev": "pnpm --filter @scope/shared build && pnpm -r --parallel run start:dev"
  }
}
```

**Alasan**: Developer tidak harus ingat untuk build shared package sebelum `pnpm dev`. Otomatis.

### Prinsip 4: Cek Dependency ESM-only Sebelum Tambah

Sebelum tambah dependency, cek:

```bash
# Cek apakah package target ESM-only
npm view cockatiel type
# Output: "module" -> ESM-only, berisiko

# Atau cek package.json di npm registry
npm view cockatiel --json | jq '.type'
```

**Bila ESM-only**:
- Pastikan project Anda sudah siap handle ESM (build ke dist, atau project juga ESM)
- Atau cari alternative yang masih support CJS
- Atau fork + build CJS version sendiri

### Prinsip 5: Pakai `loadESMFromCJS` Bridge (Node.js v22+)

Node.js v22+ punya fitur `require(esm)` yang memungkinkan CJS `require()` ESM modules langsung:

```bash
# Node.js v22+
node --experimental-require-module dist/main.js
```

**Tapi** ini experimental di v22, stable di v24+. Untuk production, tetap butuh build ke dist/.

### Prinsip 6: Test `nest start` Bukan Hanya Typecheck + Test

```bash
# LAKUKAN ini setelah setiap perubahan module structure:
pnpm typecheck       # ✅ Tidak cukup
pnpm test            # ✅ Tidak cukup
pnpm start:dev       # ✅ INI yang penting - verify runtime module resolution

# Atau untuk production build:
pnpm build && node dist/main.js   # ✅ Verify compiled output
```

**Alasan**: Typecheck dan test pakai resolver yang berbeda dari runtime. Hanya `nest start` yang reproduce actual runtime behavior.

### Prinsip 7: Konsistensi Node.js Version

```bash
# .nvmrc - pin version yang sama untuk semua developer
20

# Atau v22+ untuk fitur ESM yang lebih mature:
22
```

**Alasan**: ESM resolver behavior berubah antar versi Node.js. v20 strict, v22 lebih permissive (`require(esm)`), v24 lebih lenient. Konsistensi menghindari surprise.

### Prinsip 8: Document Module System di README

```markdown
## Module System

This project uses:
- **CJS** for apps/* (NestJS, TypeORM - compiled via tsc)
- **CJS** for packages/* (shared packages - built to dist/)
- **ESM-only dependencies**: cockatiel v4, (daftar lain bila ada)

Shared packages are built to `dist/` before `pnpm dev`.
Jest uses `src/` directly via `moduleNameMapper` (no build needed for tests).
```

---

## 12. Glossary

| Istilah | Arti |
|---|---|
| **CJS** | CommonJS - sistem module lama Node.js (`require`/`module.exports`) |
| **ESM** | ES Modules - sistem module standar JavaScript (`import`/`export`) |
| **Resolver** | Algorithm yang menentukan file mana yang di-load saat `import`/`require` |
| **Directory import** | Import path yang merujuk ke direktori (bukan file): `import './errors'` |
| **Auto-append** | Behavior CJS resolver: `./errors` -> `./errors/index.js` (otomatis) |
| **Barrel export** | File `index.ts` yang re-export dari subfolder: `export * from './errors'` |
| **Module graph** | Tree semua module yang di-import (transitif) dari entry point |
| **`loadESMFromCJS`** | Node.js internal bridge untuk load ESM module dari CJS context |
| **`"type": "module"`** | Field di package.json yang menandai package sebagai ESM |
| **`ERR_UNSUPPORTED_DIR_IMPORT`** | Error ESM resolver: directory import tidak didukung |
| **`ERR_MODULE_NOT_FOUND`** | Error ESM resolver: file tidak ditemukan (biasanya butuh extension) |
| **TC39** | Technical Committee 39 - body yang standardisasi JavaScript (ECMA-262) |

---

## Referensi

- [Node.js ESM docs](https://nodejs.org/api/esm.html)
- [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [TC39 ES Modules spec](https://tc39.es/ecma262/#sec-modules)
- [Node.js require(esm) feature flag](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)
- [Sindre Sorhus ESM guide](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c)

---

> **Catatan**: Dokumen ini dibuat berdasarkan pengalaman langsung di project retry-failure-cockatiel-observability. Masalah ditemukan saat `pnpm dev` gagal di local user (Node.js v20) padahal typecheck + test pass di sandbox (Node.js v24). Solusi: build shared package ke `dist/` (compiled CJS JavaScript).
