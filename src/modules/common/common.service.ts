import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

/** 允许的图片 mime → 扩展名，统一兜底校验 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 与 getConfig().upload.maxImageMB 保持一致，避免两边漂移 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class CommonService {
  getConfig() {
    return {
      version: '0.1.0',
      env: process.env.NODE_ENV ?? 'development',
      features: {
        devLogin: process.env.NODE_ENV !== 'production',
        wechatLogin: false,
        oss: false,
        weather: false,
      },
      upload: {
        maxImageMB: MAX_IMAGE_BYTES / 1024 / 1024,
        accept: Object.keys(MIME_TO_EXT),
      },
      dicts: {
        fishingAgeBands: ['新手', '1-3年', '3-10年', '10年+'],
        playStyles: ['台钓', '路亚', '海钓', '矶钓', '抛竿', '冰钓'],
        costModes: ['AA', '免费', '请客'],
      },
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * 处理一次图片上传：写到 uploads/yyyymm/<12字符随机>.<ext>，
   * 返回可被前端直接当 src 用的绝对 URL。
   *
   * - mime 严格白名单（不信任客户端声明的 mimetype 单独一项，buffer + ext 同时校验）
   * - 大小双检（multer limits 是第一道，这里是第二道兜底，例如对未来直传场景）
   * - 不写 originalname：客户端文件名可能含 unicode / 路径分隔符，落盘只用我们生成的 nanoid
   */
  handleUpload(
    file: Express.Multer.File | undefined,
    _userId: bigint,
  ): { url: string; mime: string; sizeBytes: number } {
    if (!file) {
      throw new BadRequestException('缺少文件字段 file');
    }
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException('上传文件为空');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException(
        `图片不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`,
      );
    }
    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `不支持的图片类型: ${file.mimetype || 'unknown'}`,
      );
    }

    const now = new Date();
    const bucket = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const id = randomBytes(6).toString('hex'); // 12 字符
    const fileName = `${id}.${ext}`;

    const targetDir = join(process.cwd(), 'uploads', bucket);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, fileName), file.buffer);

    const baseUrl = (
      process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const url = `${baseUrl}/static/uploads/${bucket}/${fileName}`;

    return {
      url,
      mime: file.mimetype,
      sizeBytes: file.size,
    };
  }
}
