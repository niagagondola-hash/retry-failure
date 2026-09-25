# AUTH-04 — auth-mock login UI + role selection (EJS)

> **Task ID**: AUTH-04
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-03
> **Estimated effort**: M (~90 min)
> **Plan reference**: Section 10.7 (Halaman UI), Section 10.7.1 (struktur folder), Section 10.7.2 (setup EJS), Section 10.7.3 (controller render), Section 10.7.4-10.7.8 (templates), Section 10.7.9 (auth session cookie), Section 10.7.10 (kenapa HTML bukan Vue)

---

## Goal

Buat 4 EJS templates (layout, login, select-role, error) + CSS stylesheet untuk auth-mock login UI. Dipanggil oleh OAuthController dari AUTH-03 via `res.render()`. Tidak pakai Vue/React — mock harus sesederhana mungkin (plan2 section 10.7.10). Plus auth session cookie helper untuk UX "sudah login" (skip login page bila auth_sid valid).

## Scope

**In scope**:
- `views/layout.ejs` — HTML wrapper + brand header + container.
- `views/login.ejs` — form login dengan hidden fields (client_id, redirect_uri, state, code_challenge, dll).
- `views/select-role.ejs` — radio button list role dari user.
- `views/error.ejs` — generic error page.
- `public/style.css` — minimal CSS sesuai plan2 section 10.7.8.
- `AuthSessionService` — buat/baca/hapus cookie `auth_sid` HttpOnly + SameSite=Lax + 1h TTL. Di AUTH-03 dibuat stub; di sini dilengkapi.
- Helper `renderLayout(title, bodyHtml)` untuk include layout.
- `views/partials/header.ejs` + `views/partials/footer.ejs` (opsional, untuk DRY bila layout.ejs pakai partials).
- Update `nest-cli.json` assets untuk copy `views/` + `public/` ke `dist/` saat build.

**Out of scope**:
- Consent screen (plan2 section 10.7 prioritas "Opsional — skip untuk demo").
- OAuth2 endpoints logic → AUTH-03 (task ini hanya templates + auth session helper).
- Fixture users/roles → AUTH-06 (templates menerima `roles` array dari controller).
- Frontend Vue → plan2 section 11 (Vue dashboard untuk payment-api, bukan auth-mock).
- Multi-language (i18n) — bahasa Indonesia saja.

## Files to create/modify

- `apps/auth-mock/views/layout.ejs`
- `apps/auth-mock/views/login.ejs`
- `apps/auth-mock/views/select-role.ejs`
- `apps/auth-mock/views/error.ejs`
- `apps/auth-mock/views/partials/header.ejs` — optional partial
- `apps/auth-mock/views/partials/footer.ejs` — optional partial
- `apps/auth-mock/public/style.css`
- `apps/auth-mock/src/modules/oauth/auth-session.service.ts` — complete implementation (stub from AUTH-03)
- `apps/auth-mock/src/modules/oauth/oauth.controller.ts` — verify `res.render()` calls match template variables
- `apps/auth-mock/nest-cli.json` — verify assets (views + public) copied on build
- `apps/auth-mock/test/auth-session.service.spec.ts`
- `apps/auth-mock/test/e2e/login-flow.e2e-spec.ts` — full flow: GET authorize → POST login → POST select-role → verify redirect

## Implementation steps

1. **`views/layout.ejs`** (per plan2 section 10.7.4):
   ```html
   <!DOCTYPE html>
   <html lang="id">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title><%= title %> — Auth Mock</title>
     <link rel="stylesheet" href="/style.css">
   </head>
   <body>
     <main class="container">
       <header class="brand">
         <h1>Auth Mock</h1>
         <p class="subtitle">Development only — jangan dipakai di production</p>
       </header>
       <%- body %>
     </main>
   </body>
   </html>
   ```
   > Catatan: pakai `<%- body %>` (raw output) supaya HTML dari login.ejs/select-role.ejs tidak di-escape.

2. **`views/login.ejs`** (per plan2 section 10.7.5):
   ```html
   <%- include('layout', { title: 'Login', body: `
   <h2>Login</h2>
   ${error ? `<p class="error">${error}</p>` : ''}
   <form method="POST" action="/oauth/authorize">
     <input type="hidden" name="client_id" value="${clientId}">
     <input type="hidden" name="redirect_uri" value="${redirectUri}">
     <input type="hidden" name="state" value="${state ?? ''}">
     <input type="hidden" name="code_challenge" value="${codeChallenge}">
     <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}">
     <input type="hidden" name="scope" value="${scope ?? ''}">
     <label>
       Username
       <input type="text" name="username" required autofocus autocomplete="username">
     </label>
     <label>
       Password
       <input type="password" name="password" required autocomplete="current-password">
     </label>
     <button type="submit">Login</button>
   </form>
   <aside class="hint">
     <strong>Fixture dev:</strong>
     <ul>
       <li><code>superadmin</code> / <code>ChangeMe_123!</code> — single role</li>
       <li><code>budi_santoso</code> / <code>ChangeMe_123!</code> — multi role</li>
     </ul>
   </aside>
   ` }) %>
   ```
   > **Penting**: plan2 section 10.7.5 catatan — EJS tidak support template literal di dalam `include` secara native. Solusi:
   > - **Opsi A** (recommended): Pisah jadi 2 file: `views/login.ejs` (full HTML) tanpa include layout, dan set `res.render('login', {title, ...})` di controller. Layout di-include via partials.
   > - **Opsi B**: Pakai `<%- include('partials/header') %>` + `<%- include('partials/footer') %>`.
   >
   > Pilih **Opsi A** untuk simplicity.

   Versi Opsi A `views/login.ejs` (full HTML, tidak pakai include layout):
   ```html
   <!DOCTYPE html>
   <html lang="id">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Login — Auth Mock</title>
     <link rel="stylesheet" href="/style.css">
   </head>
   <body>
     <main class="container">
       <header class="brand">
         <h1>Auth Mock</h1>
         <p class="subtitle">Development only — jangan dipakai di production</p>
       </header>
       <h2>Login</h2>
       <% if (error) { %><p class="error"><%= error %></p><% } %>
       <form method="POST" action="/oauth/authorize">
         <input type="hidden" name="client_id" value="<%= clientId %>">
         <input type="hidden" name="redirect_uri" value="<%= redirectUri %>">
         <input type="hidden" name="state" value="<%= state ?? '' %>">
         <input type="hidden" name="code_challenge" value="<%= codeChallenge %>">
         <input type="hidden" name="code_challenge_method" value="<%= codeChallengeMethod %>">
         <input type="hidden" name="scope" value="<%= scope ?? '' %>">
         <label>
           Username
           <input type="text" name="username" required autofocus autocomplete="username">
         </label>
         <label>
           Password
           <input type="password" name="password" required autocomplete="current-password">
         </label>
         <button type="submit">Login</button>
       </form>
       <aside class="hint">
         <strong>Fixture dev:</strong>
         <ul>
           <li><code>superadmin</code> / <code>ChangeMe_123!</code> — single role</li>
           <li><code>budi_santoso</code> / <code>ChangeMe_123!</code> — multi role</li>
         </ul>
       </aside>
     </main>
   </body>
   </html>
   ```

3. **`views/select-role.ejs`** (per plan2 section 10.7.6):
   ```html
   <!DOCTYPE html>
   <html lang="id">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Pilih Role — Auth Mock</title>
     <link rel="stylesheet" href="/style.css">
   </head>
   <body>
     <main class="container">
       <header class="brand">
         <h1>Auth Mock</h1>
         <p class="subtitle">Development only — jangan dipakai di production</p>
       </header>
       <h2>Pilih Role</h2>
       <p>Akun Anda memiliki beberapa role. Pilih salah satu untuk melanjutkan.</p>
       <form method="POST" action="/oauth/select-role">
         <input type="hidden" name="user_id" value="<%= userId %>">
         <input type="hidden" name="client_id" value="<%= clientId %>">
         <input type="hidden" name="redirect_uri" value="<%= redirectUri %>">
         <input type="hidden" name="state" value="<%= state ?? '' %>">
         <input type="hidden" name="code_challenge" value="<%= codeChallenge %>">
         <input type="hidden" name="code_challenge_method" value="<%= codeChallengeMethod %>">
         <input type="hidden" name="scope" value="<%= scope ?? '' %>">
         <div class="roles">
           <% roles.forEach(role => { %>
             <label class="role-card">
               <input type="radio" name="role_id" value="<%= role.id %>" required>
               <span class="role-name"><%= role.name %></span>
               <% if (role.description) { %>
                 <span class="role-desc"><%= role.description %></span>
               <% } %>
             </label>
           <% }) %>
         </div>
         <button type="submit">Lanjutkan</button>
       </form>
     </main>
   </body>
   </html>
   ```

4. **`views/error.ejs`** (per plan2 section 10.7.7):
   ```html
   <!DOCTYPE html>
   <html lang="id">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Error — Auth Mock</title>
     <link rel="stylesheet" href="/style.css">
   </head>
   <body>
     <main class="container">
       <header class="brand">
         <h1>Auth Mock</h1>
         <p class="subtitle">Development only — jangan dipakai di production</p>
       </header>
       <h2>Error</h2>
       <p class="error"><%= message %></p>
       <p><a href="/">Kembali</a></p>
     </main>
   </body>
   </html>
   ```

5. **`public/style.css`** (per plan2 section 10.7.8) — copy paste dari plan.

6. **`AuthSessionService`** (complete dari stub AUTH-03):
   ```ts
   import { Injectable } from '@nestjs/common';
   import { Response, Request } from 'express';
   import { randomBytes } from 'node:crypto';

   interface AuthSession {
     sid: string;
     userId: string;
     username: string;
     createdAt: number;
     expiresAt: number;
   }

   @Injectable()
   export class AuthSessionService {
     private readonly sessions = new Map<string, AuthSession>();
     private readonly ttlMs = 60 * 60 * 1000; // 1 hour
     private readonly cookieName = 'auth_sid';

     async create(res: Response, user: { id: string; username: string }): Promise<AuthSession> {
       const sid = randomBytes(32).toString('hex');
       const now = Date.now();
       const session: AuthSession = {
         sid,
         userId: user.id,
         username: user.username,
         createdAt: now,
         expiresAt: now + this.ttlMs,
       };
       this.sessions.set(sid, session);
       setTimeout(() => this.sessions.delete(sid), this.ttlMs).unref?.();
       res.cookie(this.cookieName, sid, {
         httpOnly: true,
         secure: process.env.NODE_ENV === 'production',
         sameSite: 'lax',
         path: '/',
         maxAge: this.ttlMs,
       });
       return session;
     }

     async read(req: Request): Promise<AuthSession | null> {
       const sid = req.cookies?.[this.cookieName];
       if (!sid) return null;
       const session = this.sessions.get(sid);
       if (!session) return null;
       if (Date.now() > session.expiresAt) {
         this.sessions.delete(sid);
         return null;
       }
       return session;
     }

     async destroy(res: Response, sid: string): Promise<void> {
       this.sessions.delete(sid);
       res.clearCookie(this.cookieName, { path: '/' });
     }
   }
   ```

7. **Verify OAuthController** (AUTH-03) memanggil `res.render('login', {...})` dengan variables yang cocok template:
   - `login`: `clientId`, `redirectUri`, `state`, `codeChallenge`, `codeChallengeMethod`, `scope`, `error`.
   - `select-role`: `userId`, `clientId`, `redirectUri`, `state`, `codeChallenge`, `codeChallengeMethod`, `scope`, `roles`.
   - `error`: `message`.

8. **Update `nest-cli.json`** — verify assets include views + public:
   ```json
   {
     "compilerOptions": {
       "deleteOutDir": true,
       "assets": [
         { "include": "../views/**/*", "outDir": "dist/views" },
         { "include": "../public/**/*", "outDir": "dist/public" }
       ]
     }
   }
   ```

9. **E2E test** (`apps/auth-mock/test/e2e/login-flow.e2e-spec.ts`):
   - Start app + supertest client.
   - GET `/oauth/authorize?...` → assert 200 + HTML contains `<form method="POST" action="/oauth/authorize">`.
   - POST `/oauth/authorize` dengan valid credentials → assert 302 redirect (single-role user) atau 200 + HTML select-role (multi-role user).
   - POST `/oauth/select-role` → assert 302 redirect ke `redirect_uri?code=...&state=...`.
   - GET `/oauth/authorize?...` dengan cookie `auth_sid` valid → skip login page (langsung redirect ke code atau select-role).

10. **Unit test** `AuthSessionService`:
    - Create → cookie set dengan `HttpOnly`, `SameSite=Lax`, `Max-Age=3600`.
    - Read dengan valid sid → return session.
    - Read dengan invalid sid → null.
    - Read dengan expired session → null + session removed.
    - Destroy → cookie cleared + session removed.

## Acceptance criteria

- [ ] `views/login.ejs` render form login dengan 6 hidden fields (client_id, redirect_uri, state, code_challenge, code_challenge_method, scope) + 2 input (username, password).
- [ ] `views/select-role.ejs` render radio button list role dari user.
- [ ] `views/error.ejs` render `<%= message %>` + link kembali.
- [ ] `public/style.css` accessible via `GET /style.css` (200 + Content-Type: text/css).
- [ ] Login page menampilkan hint fixture dev (`superadmin` + `budi_santoso`).
- [ ] Login page hint menyebut password dev `ChangeMe_123!`.
- [ ] Setelah login sukses + `auth_sid` cookie set, GET `/oauth/authorize` lagi tidak render login page (langsung ke select-role atau issue code).
- [ ] Error page tampil bila client_id invalid, redirect_uri invalid, atau PKCE missing.
- [ ] Cookie `auth_sid` punya atribut `HttpOnly; SameSite=Lax; Max-Age=3600`.
- [ ] `pnpm --filter auth-mock build` copy `views/` + `public/` ke `dist/`.
- [ ] E2E test (`login-flow.e2e-spec.ts`) lulus.
- [ ] Unit test (`auth-session.service.spec.ts`) lulus.
- [ ] `pnpm --filter auth-mock typecheck` + `lint` lulus.

## Useful commands

```bash
# Start auth-mock + verify login page
cd /apps/auth-mock && pnpm start:dev

# GET authorize → expect login page HTML
curl -s "http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc&code_challenge=$(node -e "console.log(require('crypto').createHash('sha256').update('test-verifier-123456789012345678901234567890123').digest('base64url'))")&code_challenge_method=S256" | head -30

# Verify CSS served
curl -sI http://localhost:4001/style.css | head -5
# Expected: HTTP/1.1 200 OK + Content-Type: text/css

# Verify auth_sid cookie after login
curl -i -c /tmp/cookies.txt -X POST http://localhost:4001/oauth/authorize \
  -d "username=superadmin&password=ChangeMe_123!&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc&code_challenge=<challenge>&code_challenge_method=S256"
cat /tmp/cookies.txt  # should show auth_sid cookie

# GET authorize again with cookie → expect redirect (skip login)
curl -i -b /tmp/cookies.txt "http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc&code_challenge=<challenge>&code_challenge_method=S256"
# Expected: 302 with Location: http://localhost:3001/auth/callback?code=...&state=abc

# Run e2e test
cd /apps/auth-mock && pnpm test:e2e

# Run all tests
cd  && pnpm --filter auth-mock test

# Verify build copies views + public
cd /apps/auth-mock && pnpm build
ls -la dist/views/ dist/public/

# Typecheck + lint
cd  && pnpm --filter auth-mock typecheck
cd  && pnpm --filter auth-mock lint
```

## Notes

- **Pilih Opsi A** (full HTML per template, no include layout) — lebih simple, lebih portabel, lebih sedikit magic. Trade-off: duplikasi `<head>` + brand header, tapi acceptable untuk 3 templates.
- **Tidak pakai Tailwind/Bootstrap** — pure CSS minimal (plan2 section 10.7.8). Auth-mock harus zero-build-step.
- **`SameSite=Lax`** cukup karena auth-mock + payment-api di localhost (same-site). Bila cross-site, ganti ke `SameSite=None; Secure` (plan2 section 12.1).
- **Tidak ada consent screen** — plan2 section 10.7 prioritas "Opsional — skip untuk demo". Bila ditambah nanti, alur: login → select-role → consent → issue code.
- **Cookie `auth_sid` terpisah dari `sid` payment-api** — plan2 section 10.7.9. Auth-mock punya session sendiri untuk UX "sudah login".
- **Tidak ada throttler di login page** — plan2 section 12.5 minta throttler di BE payment (`/auth/login` + `/auth/callback`), bukan di auth-mock authorize endpoint. (Tapi throttler bisa ditambah nanti bila perlu.)
- Setelah task ini selesai, AUTH-05 (internal endpoints) bisa mulai.
