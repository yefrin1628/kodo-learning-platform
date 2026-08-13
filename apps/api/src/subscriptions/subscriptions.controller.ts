import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { SubscribeDto } from './dto/subscribe.dto';

@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('checkout')
  checkout(@CurrentUser() user: { userId: string }, @Body() dto: SubscribeDto) {
    return this.subscriptionsService.checkout(user.userId, dto.planKey);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: { userId: string }) {
    return this.subscriptionsService.cancel(user.userId);
  }
}
