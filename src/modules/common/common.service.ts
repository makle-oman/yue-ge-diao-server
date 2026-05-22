import { Injectable } from '@nestjs/common';

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
        maxImageMB: 10,
        accept: ['image/jpeg', 'image/png', 'image/webp'],
      },
      dicts: {
        fishingAgeBands: ['新手', '1-3年', '3-10年', '10年+'],
        playStyles: ['台钓', '路亚', '海钓', '矶钓', '抛竿', '冰钓'],
        costModes: ['AA', '免费', '请客'],
      },
      serverTime: new Date().toISOString(),
    };
  }
}
