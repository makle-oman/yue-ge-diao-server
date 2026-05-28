import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './modules/common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SpotsModule } from './modules/spots/spots.module';
import { CatchesModule } from './modules/catches/catches.module';
import { CommentsModule } from './modules/comments/comments.module';
import { TeamsModule } from './modules/teams/teams.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    SpotsModule,
    CatchesModule,
    CommentsModule,
    TeamsModule,
    NotificationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}
