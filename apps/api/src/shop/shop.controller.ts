import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShopService } from './shop.service';
import { SetEquippedDto } from './dto/set-equipped.dto';

@UseGuards(JwtAuthGuard)
@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('inventory')
  getInventory(@CurrentUser() user: { userId: string }) {
    return this.shopService.getInventory(user.userId);
  }

  // No @Body() here on purpose: price/balance are never read from the
  // client, only itemKey (route param) and the authenticated user.
  @Post(':itemKey/purchase')
  purchase(@CurrentUser() user: { userId: string }, @Param('itemKey') itemKey: string) {
    return this.shopService.purchase(user.userId, itemKey);
  }

  @Post(':itemKey/equip')
  setEquipped(
    @CurrentUser() user: { userId: string },
    @Param('itemKey') itemKey: string,
    @Body() dto: SetEquippedDto,
  ) {
    return this.shopService.setEquipped(user.userId, itemKey, dto.equipped);
  }
}
