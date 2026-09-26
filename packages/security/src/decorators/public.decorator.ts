/**
 * @Public() decorator — marks route as public (skips SessionGuard + MenuAccessGuard).
 *
 * Plan reference: PLAN2 Section 9.5 (decorators), AUTH-13 task spec §4.
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   getHealth() { ... }
 *
 * Guard behavior:
 *   - SessionGuard.canActivate: if IS_PUBLIC_KEY metadata is true → return true (skip auth)
 *   - MenuAccessGuard.canActivate: same skip
 */
import { SetMetadata } from '@nestjs/common';

/** Metadata key for @Public() decorator. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route or controller as public — skips auth guards.
 *
 * @see IS_PUBLIC_KEY
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
