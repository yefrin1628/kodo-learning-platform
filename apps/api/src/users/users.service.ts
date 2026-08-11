import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userProfile: true, userStats: true, streak: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
