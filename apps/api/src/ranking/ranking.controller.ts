import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RankingService, RankingPeriod } from './ranking.service';

const PERIODS: RankingPeriod[] = ['weekly', 'monthly', 'allTime'];

@UseGuards(JwtAuthGuard)
@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get()
  get(@CurrentUser() user: { userId: string }, @Query('period') period?: string) {
    const p = PERIODS.includes(period as RankingPeriod) ? (period as RankingPeriod) : 'weekly';
    return this.rankingService.getRanking(user.userId, p);
  }
}
