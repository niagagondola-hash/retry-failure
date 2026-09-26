/**
 * UserService — fixture users with stable UUIDs + roles + permissions (AUTH-06).
 *
 * Plan reference: PLAN2 Section 10.4 (fixture user), Section 6.1 (menu codes),
 * Section 5.2 (JWT payload), AUTH-06 task spec §2.
 *
 * Two fixture users:
 *   - `superadmin`   / ChangeMe_123!  — single role (Super Admin), isSuperAdmin=true
 *   - `budi_santoso` / ChangeMe_123!  — multi role (HRD + Finance), isSuperAdmin=false
 *
 * Passwords are stored as plaintext for dev mock (NOT for production). AUTH-06
 * spec §Notes — production MUST use bcrypt/argon2. Catat di TODO.
 *
 * UUIDs are stable (hardcoded in fixtures.ts) so tests + payment-api contract
 * tests can hardcode user IDs across restarts.
 *
 * User object shape (plan2 §10.6 / 9.2):
 *   { id, username, passwordHash, name, email, isSuperAdmin, roles: [{ id, name, description, permissionCodes }] }
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { FIXTURE_USERS } from './fixtures';

export interface MockRole {
  id: string;
  name: string;
  description?: string;
  /** Permission codes attached to this role (plan2 §6.1 menu codes). */
  permissionCodes: string[];
}

export interface MockUser {
  id: string;
  username: string;
  /**
   * Plaintext dev password — DO NOT replicate in production.
   * Field name kept as `passwordHash` per AUTH-06 spec (misnamed but stable
   * for spec compliance + cross-task contract).
   */
  passwordHash: string;
  name: string;
  email?: string;
  isSuperAdmin: boolean;
  roles: MockRole[];
}

@Injectable()
export class UserService implements OnModuleInit {
  private readonly logger = new Logger('UserService');
  private readonly users = new Map<string, MockUser>();

  async onModuleInit(): Promise<void> {
    for (const u of FIXTURE_USERS) {
      this.users.set(u.id, u);
    }
    this.logger.log(`Seeded ${this.users.size} fixture users`);
  }

  /**
   * Validate username + plaintext password. Returns the user or null.
   * Caller (OAuthController) decides what to do on null (401 re-render).
   *
   * DEV ONLY: plain text comparison. Production: bcrypt.compare(password, user.passwordHash).
   */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<MockUser | null> {
    const user = await this.findByUsername(username);
    if (!user) return null;
    if (user.passwordHash !== password) return null;
    return user;
  }

  /** Lookup by primary key. */
  async findById(id: string): Promise<MockUser | null> {
    return this.users.get(id) ?? null;
  }

  /** Lookup by username (used by /dev/token in AUTH-05). */
  async findByUsername(username: string): Promise<MockUser | null> {
    for (const u of this.users.values()) {
      if (u.username === username) return u;
    }
    return null;
  }

  /**
   * Find a role on a user by roleId. Used by AUTH-05 switch-role endpoint
   * + AUTH-04 select-role page rendering.
   */
  async findRole(
    user: MockUser,
    roleId: string,
  ): Promise<MockRole | undefined> {
    return user.roles.find((r) => r.id === roleId);
  }
}
