import { Body, Controller, Delete, Get, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { AvatarService, AVATAR_MAX_BYTES } from './avatar.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
  ) {}

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

  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  updateProfile(@CurrentUser() user: { userId: string }, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  // multipart/form-data — multer usa su propio parser, nunca pasa por el
  // límite global de 100kb de express.json(). Un límite algo mayor que
  // AVATAR_MAX_BYTES aquí (multer) da margen para el overhead del
  // multipart; el límite real de negocio se re-valida en avatar.service.ts.
  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES + 1024 * 100 } }))
  setAvatar(@CurrentUser() user: { userId: string }, @UploadedFile() file?: Express.Multer.File) {
    return this.avatarService.setAvatar(user.userId, file);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/avatar')
  deleteAvatar(@CurrentUser() user: { userId: string }) {
    return this.avatarService.deleteAvatar(user.userId);
  }
}
