import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  getHealth() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
