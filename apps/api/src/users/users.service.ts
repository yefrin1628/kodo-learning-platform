import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userProfile: true,
        userStats: true,
        streak: true,
        // Server-truth progress the dashboard needs to stop deriving from
        // localStorage: per-course % (courseProgress) and which lessons are
        // actually done (lessonProgress), so a fresh device/browser sees the
        // same unlock/continue state as one that's been used all along.
        courseProgress: { include: { course: { select: { slug: true } } } },
        lessonProgress: {
          where: { completed: true },
          include: { lesson: { select: { key: true } } },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const { passwordHash: _passwordHash, ...safeUser } = user;

    // Daily/weekly XP straight from the ledger — never a maintained counter
    // — same "sum the xp_transactions" source of truth ranking.service.ts
    // uses, with the same Monday-start week convention.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - ((now.getDay() + 6) % 7));

    const [xpToday, xpWeek] = await Promise.all([
      this.prisma.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      this.prisma.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: startOfWeek } },
        _sum: { amount: true },
      }),
    ]);

    return {
      ...safeUser,
      xpToday: xpToday._sum.amount ?? 0,
      xpWeek: xpWeek._sum.amount ?? 0,
    };
  }
}
