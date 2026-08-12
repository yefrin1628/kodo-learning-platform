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
        // Profile stats: only the achievement `key` travels over the wire —
        // the frontend already has name/icon/description for all 25 in its
        // local ACHS catalog (seeded from the same content), so this is
        // purely "which of those the server confirms unlocked", not a second
        // copy of the catalog.
        achievements: { include: { achievement: { select: { key: true } } } },
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

    const [xpToday, xpWeek, exerciseStats] = await Promise.all([
      this.prisma.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      this.prisma.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: startOfWeek } },
        _sum: { amount: true },
      }),
      this.prisma.exerciseProgress.aggregate({
        where: { userId },
        _count: true,
        _sum: { attempts: true, correctAnswers: true },
      }),
    ]);

    const attempts = exerciseStats._sum.attempts ?? 0;
    const correctAnswers = exerciseStats._sum.correctAnswers ?? 0;

    return {
      ...safeUser,
      xpToday: xpToday._sum.amount ?? 0,
      xpWeek: xpWeek._sum.amount ?? 0,
      exercisesAnswered: exerciseStats._count,
      accuracy: attempts > 0 ? Math.round((100 * correctAnswers) / attempts) : 0,
    };
  }
}
