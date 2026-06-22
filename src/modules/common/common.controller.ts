import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CommonService } from './common.service';

/**
 * 上传单图：受 JwtAuthGuard 保护（默认拦截）。
 * - multer 用 memoryStorage：handleUpload 自己决定落盘路径，不让 multer 写临时文件
 *   到不可控位置（也方便日后切 OSS 时直接拿 buffer 上传）
 * - limits.fileSize 比 config.upload.maxImageMB 多 1KB 余量，让 service 内的二次
 *   校验抛 413 而不是被 multer 直接 cut；前后端错误信息一致
 * - 真正的 mime / size / 扩展名映射检查在 service 里，controller 只挂中间件
 */
const UPLOAD_HARD_LIMIT_BYTES = 50 * 1024 * 1024 + 1024;

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

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok =
          file.mimetype === 'image/jpeg' ||
          file.mimetype === 'image/png' ||
          file.mimetype === 'image/webp' ||
          file.mimetype === 'video/mp4' ||
          file.mimetype === 'video/quicktime' ||
          file.mimetype === 'video/webm';
        if (!ok) {
          return cb(
            new BadRequestException(`不支持的文件类型: ${file.mimetype}`),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserId() userId: bigint,
  ) {
    return this.commonService.handleUpload(file, userId);
  }
}
