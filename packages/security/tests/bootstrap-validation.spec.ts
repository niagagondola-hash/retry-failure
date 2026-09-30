/**
 * bootstrap-validation unit tests (AUTH-24).
 *
 * Plan reference: PLAN2 Section 14.6 (production-insecure configs) + Section 9.4
 * (SessionStore) + AUTH-24 §acceptance criteria (4 production throws + dev passes).
 *
 * Covers `validateBootstrapConfig()` extracted from
 * `apps/payment-api/src/main.ts` into `packages/security/src/utils/bootstrap-validation.ts`.
 *
 * The function takes an explicit `env` parameter — no `process.env` mutation
 * needed (no `beforeEach`/`afterEach` save-restore). Arrange = build env object,
 * Act = call validateBootstrapConfig(env), Assert = expect throw / no throw.
 */
import { validateBootstrapConfig } from '../src/utils/bootstrap-validation';

describe('validateBootstrapConfig', () => {
  describe('production mode (NODE_ENV=production) — must reject insecure combos', () => {
    it.each([
      {
        label: 'AUTH_MODE=mock',
        env: { NODE_ENV: 'production', AUTH_MODE: 'mock', SESSION_STORE: 'redis', REDIS_URL: 'redis://localhost:6379' },
        expectedMessage: 'AUTH_MODE=mock tidak boleh di production',
      },
      {
        label: 'AUTH_MODE=disabled',
        env: { NODE_ENV: 'production', AUTH_MODE: 'disabled', SESSION_STORE: 'redis', REDIS_URL: 'redis://localhost:6379' },
        expectedMessage: 'AUTH_MODE=disabled tidak boleh di production',
      },
      {
        label: 'SESSION_STORE=memory',
        env: { NODE_ENV: 'production', AUTH_MODE: 'oauth', SESSION_STORE: 'memory' },
        expectedMessage: 'SESSION_STORE=memory tidak boleh di production',
      },
    ])(
      'throws when NODE_ENV=production + $label',
      ({ env, expectedMessage }: { env: NodeJS.ProcessEnv; expectedMessage: string }) => {
        // Act + Assert
        expect(() => validateBootstrapConfig(env)).toThrow(expectedMessage);
      },
    );
  });

  describe('SESSION_STORE=redis — REDIS_URL required in any NODE_ENV', () => {
    it('throws when SESSION_STORE=redis + no REDIS_URL (development)', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'redis',
        // REDIS_URL intentionally absent
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).toThrow(
        'REDIS_URL wajib diisi kalau SESSION_STORE=redis',
      );
    });

    it('throws when SESSION_STORE=redis + REDIS_URL empty string', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'redis',
        REDIS_URL: '',
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).toThrow(
        'REDIS_URL wajib diisi kalau SESSION_STORE=redis',
      );
    });

    it('throws when SESSION_STORE=redis + no REDIS_URL (production)', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'redis',
        // REDIS_URL intentionally absent — production check passes (AUTH_MODE=oauth,
        // SESSION_STORE!=memory), but Redis check must still fire.
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).toThrow(
        'REDIS_URL wajib diisi kalau SESSION_STORE=redis',
      );
    });
  });

  describe('development / non-production — must allow previously-rejected combos', () => {
    it.each([
      {
        label: 'AUTH_MODE=mock',
        env: { NODE_ENV: 'development', AUTH_MODE: 'mock', SESSION_STORE: 'memory' },
      },
      {
        label: 'AUTH_MODE=disabled',
        env: { NODE_ENV: 'development', AUTH_MODE: 'disabled', SESSION_STORE: 'memory' },
      },
      {
        label: 'SESSION_STORE=memory',
        env: { NODE_ENV: 'development', AUTH_MODE: 'oauth', SESSION_STORE: 'memory' },
      },
      {
        label: 'AUTH_MODE=undefined (default disabled-equivalent)',
        env: { NODE_ENV: 'development', SESSION_STORE: 'memory' },
      },
    ])(
      'passes when NODE_ENV=development + $label (no throw)',
      ({ env }: { env: NodeJS.ProcessEnv }) => {
        // Act + Assert
        expect(() => validateBootstrapConfig(env)).not.toThrow();
      },
    );
  });

  describe('SESSION_STORE=redis with REDIS_URL — passes', () => {
    it('passes in development', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'redis',
        REDIS_URL: 'redis://localhost:6379',
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });

    it('passes in production (AUTH_MODE=oauth + SESSION_STORE=redis + REDIS_URL)', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'redis',
        REDIS_URL: 'redis://redis-prod:6379',
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });
  });

  describe('SESSION_STORE=database (or other) — passes in any NODE_ENV', () => {
    it('passes with SESSION_STORE=database in production', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        AUTH_MODE: 'oauth',
        SESSION_STORE: 'database',
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });

    it('passes with SESSION_STORE=database in development', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        AUTH_MODE: 'mock',
        SESSION_STORE: 'database',
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });

    it('passes with SESSION_STORE=undefined (no store configured — defaults applied later by Joi)', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        AUTH_MODE: 'mock',
        // SESSION_STORE intentionally absent
      };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });
  });

  describe('empty / minimal env', () => {
    it('passes with completely empty env object (no production checks fire)', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = {};
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });

    it('passes with only NODE_ENV=development set', () => {
      // Arrange
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
      // Act + Assert
      expect(() => validateBootstrapConfig(env)).not.toThrow();
    });
  });
});
