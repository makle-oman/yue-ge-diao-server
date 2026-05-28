import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { WeatherForecastDto, WeatherLocationDto } from './dto/weather.dto';
import { WeatherService } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Public()
  @Post('current')
  current(@Body() dto: WeatherLocationDto) {
    return this.weatherService.current(dto);
  }

  @Public()
  @Post('index')
  index(@Body() dto: WeatherLocationDto) {
    return this.weatherService.index(dto);
  }

  @Public()
  @Post('forecast')
  forecast(@Body() dto: WeatherForecastDto) {
    return this.weatherService.forecast(dto);
  }
}
