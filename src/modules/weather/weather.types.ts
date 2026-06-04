// =============================================================================
// 天气模块共享类型 + 工具
//
// WeatherCurrent / FishingIndexResp 同时被 weather.service(mock 兜底）和
// qweather.provider（真实数据源）使用，抽到这里避免两边互相 import 形成循环。
// =============================================================================

export type PressureTrend = 'up' | 'stable' | 'down';

/** 天气数据来源：qweather=和风真实数据，mock=内置兜底（无 Key/请求失败时） */
export type WeatherSource = 'qweather' | 'mock';

export interface WeatherCurrent {
  /** 天气文字（真实数据下直接用和风的 text，如「多云」「雷阵雨」） */
  weather: string;
  temperature: number;
  pressure: number;
  pressureTrend: PressureTrend;
  windDirection: string;
  windScale: number;
  humidity: number;
  precipitation: number;
  visibility: number;
  moonPhase: string;
  updatedAt: string;
  source: WeatherSource;
}

export interface FishingIndexResp {
  score: number;
  level: 'excellent' | 'good' | 'normal' | 'bad';
  advice: string;
  factors: string[];
  current: WeatherCurrent;
}

export const MOON_PHASES = [
  '新月',
  '蛾眉月',
  '上弦月',
  '盈凸月',
  '满月',
  '亏凸月',
  '下弦月',
  '残月',
] as const;

// 朔望月平均长度（天）
const SYNODIC_MONTH = 29.530588853;
// 一次已知新月时刻：2000-01-06 18:14 UTC（天文历）
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

/**
 * 按日期估算月相（天文 API 一般不返回月相，本地算即可，钓鱼参考足够）。
 * 把朔望周期等分成 8 相，返回最接近的相位名。
 */
export function moonPhaseOf(date: Date): string {
  const days = (date.getTime() - KNOWN_NEW_MOON_MS) / 86_400_000;
  let phase = (days % SYNODIC_MONTH) / SYNODIC_MONTH;
  if (phase < 0) phase += 1;
  const idx = Math.round(phase * MOON_PHASES.length) % MOON_PHASES.length;
  return MOON_PHASES[idx];
}
