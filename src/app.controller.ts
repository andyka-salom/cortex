import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** Health check control plane itu sendiri (PRD §7 — app ini juga dimonitor). */
  @Get('health')
  health() {
    return { status: 'ok', service: 'cortex-control-plane', ts: new Date().toISOString() };
  }
}
