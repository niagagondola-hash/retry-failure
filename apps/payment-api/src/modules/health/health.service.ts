import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import axios from 'axios';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  async checkDb(): Promise<'ok' | 'down'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch (err) {
      this.logger.warn({ err }, 'DB health check failed');
      return 'down';
    }
  }

  async checkGateway(): Promise<'ok' | 'down'> {
    const gatewayUrl = process.env.GATEWAY_URL ?? 'http://localhost:3002';
    try {
      await axios.head(`${gatewayUrl}/admin/config`, { timeout: 1000 });
      return 'ok';
    } catch (err) {
      this.logger.warn({ err }, 'Gateway health check failed');
      return 'down';
    }
  }

  async check(): Promise<{
    db: 'ok' | 'down';
    gateway: 'ok' | 'down';
    timestamp: string;
  }> {
    const [db, gateway] = await Promise.all([this.checkDb(), this.checkGateway()]);
    return {
      db,
      gateway,
      timestamp: new Date().toISOString(),
    };
  }
}
