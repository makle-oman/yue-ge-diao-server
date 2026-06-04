import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { QWeatherProvider } from './qweather.provider';

@Module({
  controllers: [WeatherController],
  providers: [WeatherService, QWeatherProvider],
})
export class WeatherModule {}
