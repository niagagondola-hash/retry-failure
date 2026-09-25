/**
 * AuthUser — shape of req.user after SessionGuard resolves cookie → session.
 *
 * Plan reference: PLAN2 Section 9.2 (req.user shape).
 */
export interface AuthUser {
  userId: string;
  username: string;
  roleId: string;
  isSuperAdmin: boolean;
  permissionCodes: string[];
}
