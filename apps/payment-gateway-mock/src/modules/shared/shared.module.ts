/**
 * SharedModule — provides process-wide singletons: MockState + IdempotencyStore.
 *
 * These are shared by ChargesModule (writes) and AdminModule (reads / config
 * mutations). Importing this module from multiple feature modules is safe —
 * NestJS deduplicates module instances, so providers stay singletons.
 */

import { Module } from '@nestjs/common';
import { MockState } from '../../shared/state/mock-state';
import { IdempotencyStore } from '../../shared/idempotency/idempotency-store';

@Module({
  providers: [
    { provide: MockState, useValue: new MockState() },
    { provide: IdempotencyStore, useValue: new IdempotencyStore() },
  ],
  exports: [MockState, IdempotencyStore],
})
export class SharedModule {}
