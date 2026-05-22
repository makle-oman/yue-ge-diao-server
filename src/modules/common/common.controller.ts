import { Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CommonService } from './common.service';

@Controller('common')
export class CommonController {
  constructor(private readonly commonService: CommonService) {}

  @Public()
  @Post('config')
  getConfig() {
    return this.commonService.getConfig();
  }
}
