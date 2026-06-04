import { BadRequestException, Injectable } from '@nestjs/common';
import { WeatherForecastDto, WeatherLocationDto } from './dto/weather.dto';
import { QWeatherProvider } from './qweather.provider';
import { moonPhaseOf } from './weather.types';
import type { FishingIndexResp, PressureTrend, WeatherCurrent } from './weather.types';

type WeatherName = '晴' | '多云' | '阴' | '小雨' | '阵雨';

const WEATHER_BUCKETS: WeatherName[] = ['晴', '多云', '多云', '阴', '小雨', '阵雨'];
const WIND_DIRECTIONS = ['东风', '东南风', '南风', '西南风', '西风', '西北风', '北风', '东北风'];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseDate(raw?: string): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('date 格式错误');
  }
  return d;
}

function seedOf(lat: number, lng: number, date: Date): number {
  const day = Math.floor(date.getTime() / 86_400_000);
  const x = Math.sin(lat * 12.9898 + lng * 78.233 + day * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

@Injectable()
export class WeatherService {
  constructor(private readonly qweather: QWeatherProvider) {}

  /**
   * 实况天气。优先和风真实数据；未配 Key 或请求失败时降级到内置 mock。
   * （和风实况只反映「当前」，传 date 查历史时刻无效，记录此刻天气足够。）
   */
  async current(dto: WeatherLocationDto): Promise<WeatherCurrent> {
    if (this.qweather.isEnabled()) {
      const real = await this.qweather.getCurrent(dto.lat, dto.lng);
      if (real) return real;
    }
    return this.mockCurrent(dto);
  }

  /** 宜钓指数：拿到（真实或 mock 的）实况后，跑同一套可解释的评分算法 */
  async index(dto: WeatherLocationDto): Promise<FishingIndexResp> {
    const current = await this.current(dto);
    const month = parseDate(dto.date).getMonth() + 1;
    const factors: string[] = [];
    let score = 60;

    if (current.pressureTrend === 'up' || current.pressureTrend === 'stable') {
      score += 10;
      factors.push('气压稳定');
    } else {
      score -= 15;
      factors.push('气压下降');
    }
    if (current.windScale >= 3 && current.windScale <= 5) {
      score += 10;
      factors.push('风力合适');
    }
    if (current.weather.includes('多云') || current.weather.includes('阴')) {
      score += 5;
      factors.push('光照温和');
    }
    if ((month >= 3 && month <= 5) || (month >= 9 && month <= 11)) {
      score += 5;
      factors.push('季节适宜');
    }
    if (/雨|雪/.test(current.weather)) {
      score -= 20;
      factors.push('降雨影响');
    }
    if (current.windScale >= 6) {
      score -= 20;
      factors.push('风力偏大');
    }
    if (current.temperature <= 3 || current.temperature >= 35) {
      score -= 10;
      factors.push('温度偏极端');
    }

    const finalScore = clamp(Math.round(score), 0, 100);
    const level = finalScore >= 85 ? 'excellent' : finalScore >= 70 ? 'good' : finalScore >= 50 ? 'normal' : 'bad';
    const advice =
      level === 'excellent'
        ? '鱼口积极，适合出钓'
        : level === 'good'
          ? '条件不错，留意水层变化'
          : level === 'normal'
            ? '可以试钓，建议避开强风时段'
            : '条件一般，建议改期或短时探点';

    return { score: finalScore, level, advice, factors, current };
  }

  /** 逐小时预报。优先和风未来 N 小时；失败降级 mock 逐小时。 */
  async forecast(dto: WeatherForecastDto): Promise<{ list: WeatherCurrent[] }> {
    const hours = dto.hours ?? 12;
    if (this.qweather.isEnabled()) {
      const real = await this.qweather.getForecast(dto.lat, dto.lng, hours);
      if (real) return { list: real };
    }
    const start = parseDate(dto.date);
    const list = Array.from({ length: hours }, (_, idx) => {
      const d = new Date(start);
      d.setHours(start.getHours() + idx);
      return this.mockCurrent({ lat: dto.lat, lng: dto.lng, date: d.toISOString() });
    });
    return { list };
  }

  // ---------------------------------------------------------------------------
  // 内置 mock：无 Key / 和风请求失败时的兜底，保证天气接口永不挂
  // ---------------------------------------------------------------------------
  private mockCurrent(dto: WeatherLocationDto): WeatherCurrent {
    const date = parseDate(dto.date);
    const seed = seedOf(dto.lat, dto.lng, date);
    const month = date.getMonth();
    const seasonal = Math.sin(((month + 10) / 12) * Math.PI * 2);
    const temperature = Math.round(
      clamp(18 + seasonal * 12 - Math.abs(dto.lat - 30) * 0.25 + seed * 6 - 3, -8, 39),
    );
    const weather = WEATHER_BUCKETS[Math.min(WEATHER_BUCKETS.length - 1, Math.floor(seed * WEATHER_BUCKETS.length))];
    const pressureTrend: PressureTrend = seed > 0.68 ? 'up' : seed < 0.28 ? 'down' : 'stable';

    return {
      weather,
      temperature,
      pressure: Math.round(
        clamp(
          1008 + (0.5 - seed) * 18 + (pressureTrend === 'up' ? 4 : pressureTrend === 'down' ? -4 : 0),
          985,
          1035,
        ),
      ),
      pressureTrend,
      windDirection: WIND_DIRECTIONS[Math.floor(seed * WIND_DIRECTIONS.length) % WIND_DIRECTIONS.length],
      windScale: clamp(Math.round(1 + seed * 5), 1, 6),
      humidity: Math.round(clamp(45 + seed * 38 + (weather.includes('雨') ? 12 : 0), 30, 95)),
      precipitation: weather.includes('雨') ? Number((seed * 8).toFixed(1)) : 0,
      visibility: Math.round(clamp(28 - seed * 16 - (weather.includes('雨') ? 8 : 0), 3, 30)),
      moonPhase: moonPhaseOf(date),
      updatedAt: date.toISOString(),
      source: 'mock',
    };
  }
}
