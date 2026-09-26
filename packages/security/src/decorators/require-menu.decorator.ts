/**
 * @RequireMenu() decorator — sets required menu codes for route (used by MenuAccessGuard).
 *
 * Plan reference: PLAN2 Section 6.4 (MenuAccessGuard), Section 9.5 (decorators),
 * AUTH-13 task spec §4.
 *
 * Usage:
 *   @RequireMenu('payment.write')
 *   @UseGuards(SessionGuard, MenuAccessGuard)
 *   @Post('payments')
 *   createPayment() { ... }
 *
 *   // OR logic — at least one of the codes is required
 *   @RequireMenu('payment.write', 'payment.admin')
 *   @UseGuards(SessionGuard, MenuAccessGuard)
 *   @Post('admin/payments')
 *   adminCreatePayment() { ... }
 *
 * MenuAccessGuard behavior:
 *   - Reads REQUIRE_MENU_KEY metadata → required menu codes (string[])
 *   - If empty/missing → allow (no menu required)
 *   - If user.isSuperAdmin → bypass (allow)
 *   - If user.permissionCodes includes '*' → bypass (allow)
 *   - Otherwise: at least one required code must be in user.permissionCodes (OR logic)
 */
import { SetMetadata } from '@nestjs/common';

/** Metadata key for @RequireMenu() decorator. */
export const REQUIRE_MENU_KEY = 'requireMenu';

/**
 * Mark a route as requiring one of the specified menu codes.
 * User must have at least one of these codes in their permissionCodes.
 *
 * @param menuCodes - One or more menu codes (OR logic — any match grants access)
 */
export const RequireMenu = (...menuCodes: string[]) =>
  SetMetadata(REQUIRE_MENU_KEY, menuCodes);
