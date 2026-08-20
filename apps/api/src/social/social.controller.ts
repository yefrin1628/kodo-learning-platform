import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SocialService } from './social.service';
import { SearchUsersDto } from './dto/search-users.dto';
import { PaginationDto } from './dto/pagination.dto';
import { CreateReportDto } from './dto/create-report.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  // Debe declararse antes de ':username' — si no, "/users/search" quedaría
  // atrapado por la ruta con parámetro (username='search').
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search')
  search(@CurrentUser() user: { userId: string }, @Query() dto: SearchUsersDto) {
    return this.social.search(user.userId, dto.q, { page: dto.page, limit: dto.limit });
  }

  @Get(':username')
  getProfile(@CurrentUser() user: { userId: string }, @Param('username') username: string) {
    return this.social.getPublicProfile(user.userId, username);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':username/follow')
  follow(@CurrentUser() user: { userId: string }, @Param('username') username: string) {
    return this.social.follow(user.userId, username);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Delete(':username/follow')
  unfollow(@CurrentUser() user: { userId: string }, @Param('username') username: string) {
    return this.social.unfollow(user.userId, username);
  }

  @Get(':username/followers')
  followers(@CurrentUser() user: { userId: string }, @Param('username') username: string, @Query() page: PaginationDto) {
    return this.social.getFollowers(user.userId, username, page);
  }

  @Get(':username/following')
  following(@CurrentUser() user: { userId: string }, @Param('username') username: string, @Query() page: PaginationDto) {
    return this.social.getFollowing(user.userId, username, page);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':username/block')
  block(@CurrentUser() user: { userId: string }, @Param('username') username: string) {
    return this.social.block(user.userId, username);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete(':username/block')
  unblock(@CurrentUser() user: { userId: string }, @Param('username') username: string) {
    return this.social.unblock(user.userId, username);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':username/report')
  report(@CurrentUser() user: { userId: string }, @Param('username') username: string, @Body() dto: CreateReportDto) {
    return this.social.report(user.userId, username, dto.reason);
  }
}
