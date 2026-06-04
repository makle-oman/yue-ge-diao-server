// =============================================================================
// 和风天气（QWeather）数据源
//
// 设计要点（对照 [[diaoyu-db-reliability]] 对外部依赖的鲁棒性要求）：
//   1. 显式超时（默认 8s，AbortController）—— 不让天气接口拖垮发鱼获/首页
//   2. 任意环节失败（无 Key / HTTP 错误 / code≠200 / 超时）一律返回 null，
//      由 WeatherService 降级回内置 mock，绝不抛错冒泡到接口
//   3. host 完全可配（和风 2024 起改用专属 API Host，旧 devapi 不保证可用）
//
// 鉴权：API Key 走 header `X-QW-Api-Key`（免费开发版最省事的方式）。
// 文档：https://dev.qweather.com/docs/api/weather/weather-now/
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { moonPhaseOf } from './weather.types';
import type { PressureTrend, WeatherCurrent } from './weather.types';

interface QWeatherNow {
  obsTime?: string;
  temp?: string;
  text?: string;
  windDir?: string;
  windScale?: string;
  humidity?: string;
  precip?: string;
  pressure?: string;
  vis?: string;
}

// 逐小时预报项：注意和风 24h 不返回 vis（能见度）
interface QWeatherHourlyItem {
  fxTime?: string;
  temp?: string;
  text?: string;
  windDir?: string;
  windScale?: string;
  humidity?: string;
  precip?: string;
  pressure?: string;
}

interface QWeatherNowResp {
  code?: string;
  now?: QWeatherNow;
}

interface QWeatherHourlyResp {
  code?: string;
  hourly?: QWeatherHourlyItem[];
}

function normalizeHost(raw: string): string {
  let host = raw.trim();
  if (!host) return '';
  host = host.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  return host;
}

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function toFloat(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 用未来 ~3 小时的气压斜率估算趋势（和风 now 不直接给趋势） */
function trendFromHourly(hourly: QWeatherHourlyItem[]): PressureTrend {
  if (hourly.length < 4) return 'stable';
  const p0 = Number(hourly[0]?.pressure);
  const p3 = Number(hourly[3]?.pressure);
  if (!Number.isFinite(p0) || !Number.isFinite(p3)) return 'stable';
  const delta = p3 - p0;
  if (delta >= 1.5) return 'up';
  if (delta <= -1.5) return 'down';
  return 'stable';
}

@Injectable()
export class QWeatherProvider {
  private readonly logger = new Logger('QWeatherProvider');
  private readonly host: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.host = normalizeHost(this.config.get<string>('QWEATHER_API_HOST') ?? '');
    this.apiKey = (this.config.get<string>('QWEATHER_API_KEY') ?? '').trim();
    const t = Number(this.config.get<string>('QWEATHER_TIMEOUT_MS'));
    this.timeoutMs = Number.isFinite(t) && t > 0 ? t : 8000;
    if (this.isEnabled()) {
      this.logger.log(`和风天气已启用（host=${this.host}）`);
    } else {
      this.logger.log('未配置 QWEATHER_API_HOST/KEY，天气走内置 mock');
    }
  }

  isEnabled(): boolean {
    return !!this.host && !!this.apiKey;
  }

  /** 实况：失败返回 null（上层降级 mock） */
  async getCurrent(lat: number, lng: number): Promise<WeatherCurrent | null> {
    const raw = await this.fetchRaw(lat, lng);
    if (!raw) return null;
    return this.mapNow(raw.now, raw.hourly);
  }

  /** 逐小时预报：失败返回 null（上层降级 mock） */
  async getForecast(lat: number, lng: number, hours: number): Promise<WeatherCurrent[] | null> {
    const raw = await this.fetchRaw(lat, lng);
    if (!raw) return null;
    const list = raw.hourly.slice(0, hours).map((h) => this.mapHourly(h));
    return list.length ? list : null;
  }

  /** 并发拉 now + 24h，任一关键失败返回 null */
  private async fetchRaw(
    lat: number,
    lng: number,
  ): Promise<{ now: QWeatherNow; hourly: QWeatherHourlyItem[] } | null> {
    // 和风约定：经度在前、纬度在后，最多两位小数
    const loc = `${lng.toFixed(2)},${lat.toFixed(2)}`;
    try {
      const [nowRes, hourlyRes] = await Promise.all([
        this.getJson<QWeatherNowResp>(`${this.host}/v7/weather/now?location=${loc}`),
        this.getJson<QWeatherHourlyResp>(`${this.host}/v7/weather/24h?location=${loc}`),
      ]);
      if (!nowRes || nowRes.code !== '200' || !nowRes.now) {
        this.logger.warn(`和风 now 异常（code=${nowRes?.code ?? 'n/a'}），降级 mock`);
        return null;
      }
      const hourly =
        hourlyRes?.code === '200' && Array.isArray(hourlyRes.hourly) ? hourlyRes.hourly : [];
      return { now: nowRes.now, hourly };
    } catch (e) {
      this.logger.warn(`和风请求失败，降级 mock：${(e as Error).message}`);
      return null;
    }
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'X-QW-Api-Key': this.apiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`和风 HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapNow(now: QWeatherNow, hourly: QWeatherHourlyItem[]): WeatherCurrent {
    const obs = now.obsTime ? new Date(now.obsTime) : new Date();
    return {
      weather: now.text?.trim() || '未知',
      temperature: toInt(now.temp, 0),
      pressure: toInt(now.pressure, 1010),
      pressureTrend: trendFromHourly(hourly),
      windDirection: now.windDir?.trim() || '微风',
      windScale: toInt(now.windScale, 0),
      humidity: toInt(now.humidity, 0),
      precipitation: toFloat(now.precip, 0),
      visibility: toInt(now.vis, 25),
      moonPhase: moonPhaseOf(obs),
      updatedAt: obs.toISOString(),
      source: 'qweather',
    };
  }

  private mapHourly(item: QWeatherHourlyItem): WeatherCurrent {
    const t = item.fxTime ? new Date(item.fxTime) : new Date();
    return {
      weather: item.text?.trim() || '未知',
      temperature: toInt(item.temp, 0),
      pressure: toInt(item.pressure, 1010),
      pressureTrend: 'stable',
      windDirection: item.windDir?.trim() || '微风',
      windScale: toInt(item.windScale, 0),
      humidity: toInt(item.humidity, 0),
      precipitation: toFloat(item.precip, 0),
      visibility: 25, // 和风逐小时不含能见度，给一个中性默认值
      moonPhase: moonPhaseOf(t),
      updatedAt: t.toISOString(),
      source: 'qweather',
    };
  }
}
