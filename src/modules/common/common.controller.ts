import { Controller, Get, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CommonService } from './common.service';

@Controller('common')
export class CommonController {
  constructor(
    private readonly commonService: CommonService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('config')
  getConfig() {
    return this.commonService.getConfig();
  }

  @Public()
  @Get('health')
  async health() {
    const db = await this.prisma.ping();
    const conn = this.prisma.getConnInfo();
    return {
      status: db.ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      db: {
        ...db,
        host: conn.host,
        port: conn.port,
        database: conn.database,
      },
    };
  }
}
