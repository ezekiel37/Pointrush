import { Controller, Get, Header } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
