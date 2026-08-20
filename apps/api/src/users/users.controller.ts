import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: { userId: string }) {
    return this.usersService.getMe(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/onboarding-complete')
  completeOnboarding(@CurrentUser() user: { userId: string }, @Body() dto: CompleteOnboardingDto) {
    return this.usersService.completeOnboarding(user.userId, dto);
  }
}
