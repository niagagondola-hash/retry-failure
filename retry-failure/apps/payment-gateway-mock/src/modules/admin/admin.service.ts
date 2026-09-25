/**
 * AdminService - exposes MockState mutations + stats snapshot.
 *
 * Stateless helper - every operation goes through the singleton MockState
 * provided by SharedModule.
 */

import { Injectable } from '@nestjs/common';
import { MockState, type MockConfig, type MockStats } from '../../shared/state/mock-state';
import { IdempotencyStore } from '../../shared/idempotency/idempotency-store';
import { UpdateMockConfigDto } from './dto/mock-config.dto';

export interface AdminStatsView extends MockStats {
  idempotencyStoreSize: number;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly state: MockState,
    private readonly idempotencyStore: IdempotencyStore,
  ) {}

  getConfig(): MockConfig {
    return { ...this.state.config };
  }

  updateConfig(patch: UpdateMockConfigDto): MockConfig {
    // Strip undefined fields so we don't overwrite config with undefined.
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        filtered[k] = v;
      }
    }
    return this.state.update(filtered as Partial<MockConfig>);
  }

  getStats(): AdminStatsView {
    return {
      ...this.state.stats(),
      idempotencyStoreSize: this.idempotencyStore.size,
    };
  }

  /**
   * Reset all counters and idempotency store. Config is left untouched.
   * Useful between demo runs.
   */
  reset(): { reset: true } {
    this.state.reset();
    this.idempotencyStore.clear();
    return { reset: true };
  }
}
