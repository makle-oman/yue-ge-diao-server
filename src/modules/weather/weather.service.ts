import { BadRequestException, Injectable } from '@nestjs/common';
import { WeatherForecastDto, WeatherLocationDto } from './dto/weather.dto';

type WeatherName = '晴' | '多云' | '阴' | '小雨' | '阵雨';
type PressureTrend = 'up' | 'stable' | 'down';

export interface WeatherCurrent {
  weather: WeatherName;
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
  source: 'mock';
}

export interface FishingIndexResp {
  score: number;
  level: 'excellent' | 'good' | 'normal' | 'bad';
  advice: string;
  factors: string[];
  current: WeatherCurrent;
}

const WEATHER_BUCKETS: WeatherName[] = ['晴', '多云', '多云', '阴', '小雨', '阵雨'];
const WIND_DIRECTIONS = ['东风', '东南风', '南风', '西南风', '西风', '西北风', '北风', '东北风'];
const MOON_PHASES = ['新月', '蛾眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];

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
  current(dto: WeatherLocationDto): WeatherCurrent {
    const date = parseDate(dto.date);
    const seed = seedOf(dto.lat, dto.lng, date);
    const month = date.getMonth();
    const seasonal = Math.sin(((month + 10) / 12) * Math.PI * 2);
    const temperature = Math.round(clamp(18 + seasonal * 12 - Math.abs(dto.lat - 30) * 0.25 + seed * 6 - 3, -8, 39));
    const weather = WEATHER_BUCKETS[Math.min(WEATHER_BUCKETS.length - 1, Math.floor(seed * WEATHER_BUCKETS.length))];
    const pressureTrend: PressureTrend = seed > 0.68 ? 'up' : seed < 0.28 ? 'down' : 'stable';

    return {
      weather,
      temperature,
      pressure: Math.round(clamp(1008 + (0.5 - seed) * 18 + (pressureTrend === 'up' ? 4 : pressureTrend === 'down' ? -4 : 0), 985, 1035)),
      pressureTrend,
      windDirection: WIND_DIRECTIONS[Math.floor(seed * WIND_DIRECTIONS.length) % WIND_DIRECTIONS.length],
      windScale: clamp(Math.round(1 + seed * 5), 1, 6),
      humidity: Math.round(clamp(45 + seed * 38 + (weather.includes('雨') ? 12 : 0), 30, 95)),
      precipitation: weather.includes('雨') ? Number((seed * 8).toFixed(1)) : 0,
      visibility: Math.round(clamp(28 - seed * 16 - (weather.includes('雨') ? 8 : 0), 3, 30)),
      moonPhase: MOON_PHASES[Math.floor((date.getDate() / 31) * MOON_PHASES.length) % MOON_PHASES.length],
      updatedAt: date.toISOString(),
      source: 'mock',
    };
  }

  index(dto: WeatherLocationDto): FishingIndexResp {
    const current = this.current(dto);
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
    if (current.weather === '多云' || current.weather === '阴') {
      score += 5;
      factors.push('光照温和');
    }
    if ((month >= 3 && month <= 5) || (month >= 9 && month <= 11)) {
      score += 5;
      factors.push('季节适宜');
    }
    if (current.weather.includes('雨')) {
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

    return {
      score: finalScore,
      level,
      advice,
      factors,
      current,
    };
  }

  forecast(dto: WeatherForecastDto) {
    const start = parseDate(dto.date);
    const hours = dto.hours ?? 12;
    const list = Array.from({ length: hours }, (_, idx) => {
      const d = new Date(start);
      d.setHours(start.getHours() + idx);
      return this.current({ lat: dto.lat, lng: dto.lng, date: d.toISOString() });
    });
    return { list };
  }
}
