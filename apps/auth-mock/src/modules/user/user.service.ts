/**
 * UserService — fixture users stub (AUTH-03).
 *
 * Plan reference: PLAN2 Section 10.4 (Fixture user), Section 5.2 (JWT payload claims).
 *
 * Two fixture users per plan2 §10.4:
 *   - `superadmin`   / ChangeMe_123!  — single role, isSuperAdmin=true
 *   - `budi_santoso` / ChangeMe_123!  — multi role (Operator + Finance)
 *
 * Passwords are stored as plaintext for dev mock (NOT for production). AUTH-06
 * will fill richer fixtures (permissions, menus, role descriptions); this stub
 * exposes the stable interface (`validateCredentials`, `findById`) used by
 * OAuthController.
 *
 * User object shape (plan2 §10.6 / 9.2):
 *   { id, username, name, email, isSuperAdmin, roles: [{ id, name }] }
 */
import { Injectable } from '@nestjs/common';

export interface MockRole {
  id: string;
  name: string;
  description?: string;
  /** Permission codes attached to this role (filled by AUTH-06). */
  permissionCodes: string[];
}

export interface MockUser {
  id: string;
  username: string;
  /** Plaintext dev password — DO NOT replicate in production. */
  password: string;
  name: string;
  email?: string;
  isSuperAdmin: boolean;
  roles: MockRole[];
}

const FIXTURE_USERS: MockUser[] = [
  {
    id: 'user-superadmin',
    username: 'superadmin',
    password: 'ChangeMe_123!',
    name: 'Super Admin',
    email: 'superadmin@example.test',
    isSuperAdmin: true,
    roles: [
      {
        id: 'role-super-admin',
        name: 'Super Admin',
        description: 'Bypass all menu checks',
        permissionCodes: ['*'],
      },
    ],
  },
  {
    id: 'user-budi',
    username: 'budi_santoso',
    password: 'ChangeMe_123!',
    name: 'Budi Santoso',
    email: 'budi@example.test',
    isSuperAdmin: false,
    roles: [
      {
        id: 'role-operator',
        name: 'Operator',
        description: 'Read + write payments',
        permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
      },
      {
        id: 'role-finance',
        name: 'Finance',
        description: 'Read + retry payments',
        permissionCodes: ['dashboard', 'payment.read', 'payment.retry'],
      },
    ],
  },
];

@Injectable()
export class UserService {
  private readonly users = new Map<string, MockUser>();

  constructor() {
    for (const u of FIXTURE_USERS) {
      this.users.set(u.id, u);
    }
  }

  /**
   * Validate username + plaintext password. Returns the user or null.
   * Caller (OAuthController) decides what to do on null (401 re-render).
   */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<MockUser | null> {
    const user = [...this.users.values()].find((u) => u.username === username);
    if (!user) return null;
    if (user.password !== password) return null;
    return user;
  }

  /** Lookup by primary key. */
  async findById(id: string): Promise<MockUser | null> {
    return this.users.get(id) ?? null;
  }

  /** Lookup by username (used by /dev/token in AUTH-05). */
  async findByUsername(username: string): Promise<MockUser | null> {
    return (
      [...this.users.values()].find((u) => u.username === username) ?? null
    );
  }
}
