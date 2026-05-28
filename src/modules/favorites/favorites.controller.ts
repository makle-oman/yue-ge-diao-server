import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ListFavoritesDto, RemoveFavoriteDto } from './dto/favorites.dto';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post('list')
  list(@CurrentUserId() userId: bigint, @Body() dto: ListFavoritesDto) {
    return this.favoritesService.list(userId, dto);
  }

  @Post('remove')
  remove(@CurrentUserId() userId: bigint, @Body() dto: RemoveFavoriteDto) {
    return this.favoritesService.remove(userId, dto);
  }
}
