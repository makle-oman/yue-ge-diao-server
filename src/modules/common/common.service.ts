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

interface ImageSize {
  width: number;
  height: number;
}

function readU24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function readPngSize(buffer: Buffer): ImageSize | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(buffer: Buffer): ImageSize | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) return null;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(buffer: Buffer): ImageSize | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: readU24LE(buffer, 24) + 1,
      height: readU24LE(buffer, 27) + 1,
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  return null;
}

function readImageSize(buffer: Buffer, mime: string): ImageSize | null {
  if (mime === 'image/png') return readPngSize(buffer);
  if (mime === 'image/jpeg') return readJpegSize(buffer);
  if (mime === 'image/webp') return readWebpSize(buffer);
  return null;
}

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
        weather: true,
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
  ): { url: string; mime: string; sizeBytes: number; width: number; height: number } {
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
    const size = readImageSize(file.buffer, file.mimetype);
    if (!size || size.width <= 0 || size.height <= 0) {
      throw new BadRequestException('图片内容无法识别');
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
      width: size.width,
      height: size.height,
    };
  }
}
