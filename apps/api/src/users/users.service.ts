import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@kodo/database';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const USERNAME_COOLDOWN_DAYS = 30;

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
        // Solo la suscripción activa importa para el cliente (Pro sí/no y
        // qué plan) — historial/estado cancelado no se expone, igual que
        // achievements solo manda `.key`, no la fila completa.
        subscriptions: { where: { status: 'ACTIVE' }, include: { plan: { select: { key: true } } } },
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
    const todayKey = now.toLocaleDateString('en-CA'); // YYYY-MM-DD, same format challenges.service.ts uses for date

    const [xpToday, xpWeek, exerciseStats, exercisesToday, challengesClaimedToday] = await Promise.all([
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
      // Same window/metric challenges.service.ts uses for the "exercises_answered"
      // challenge, so the dashboard's progress bar and the server's actual
      // claim can never disagree about what "today" counted.
      this.prisma.exerciseProgress.count({
        where: { userId, lastAttemptAt: { gte: startOfToday } },
      }),
      // Which of today's challenges are already claimed — a fresh device has
      // no local U.day.claimed, so without this it would show a claimed
      // challenge as still in-progress even though the server will (rightly)
      // refuse to pay it again.
      this.prisma.userChallengeProgress.findMany({
        where: { userId, date: todayKey, claimed: true },
        include: { challenge: { select: { key: true } } },
      }),
    ]);

    const attempts = exerciseStats._sum.attempts ?? 0;
    const correctAnswers = exerciseStats._sum.correctAnswers ?? 0;

    return {
      ...safeUser,
      isPro: safeUser.subscriptions.length > 0,
      xpToday: xpToday._sum.amount ?? 0,
      xpWeek: xpWeek._sum.amount ?? 0,
      exercisesAnswered: exerciseStats._count,
      exercisesToday,
      accuracy: attempts > 0 ? Math.round((100 * correctAnswers) / attempts) : 0,
      challengesClaimedToday: challengesClaimedToday.map((c) => c.challenge.key),
    };
  }

  /** Persists the one-time onboarding quiz result server-side — previously
   * lived only in localStorage, so a new device/browser (or a different
   * origin, e.g. the apex domain vs the .vercel.app one) always saw a blank
   * user and got sent through onboarding again despite having real
   * progress. onboardingCompleted is now the single source of truth for
   * whether to route to home or onboarding, everywhere the frontend does
   * that check. */
  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: { onboardingCompleted: true, goalMin: dto.goalMin, product: dto.product },
    });
    return {
      onboardingCompleted: profile.onboardingCompleted,
      goalMin: profile.goalMin,
      product: profile.product,
    };
  }

  /** No admite avatarUrl — ese campo solo se modifica a través del flujo de
   * avatar (avatar.service.ts), que valida el blob subido de verdad antes
   * de persistir. Un cambio de username paga un cooldown de 30 días y deja
   * rastro en UsernameHistory (soporte/abuso), no solo se sobrescribe. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const current = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!current) {
      throw new NotFoundException('Perfil no encontrado.');
    }

    const data: Prisma.UserProfileUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.bio !== undefined) data.bio = dto.bio;

    if (dto.username !== undefined && dto.username !== current.username) {
      if (current.usernameChangedAt) {
        const daysSince = (Date.now() - current.usernameChangedAt.getTime()) / 86_400_000;
        if (daysSince < USERNAME_COOLDOWN_DAYS) {
          const daysLeft = Math.ceil(USERNAME_COOLDOWN_DAYS - daysSince);
          throw new BadRequestException(`Puedes cambiar tu nombre de usuario en ${daysLeft} día(s) más.`);
        }
      }
      const taken = await this.prisma.userProfile.findUnique({ where: { username: dto.username } });
      if (taken) {
        throw new ConflictException('Ese nombre de usuario ya está en uso.');
      }

      await this.prisma.usernameHistory.create({ data: { userId, username: current.username } });
      data.username = dto.username;
      data.usernameChangedAt = new Date();
    }

    const updated = await this.prisma.userProfile.update({ where: { userId }, data });
    return {
      username: updated.username,
      displayName: updated.displayName,
      bio: updated.bio,
      avatarUrl: updated.avatarUrl,
      usernameChangedAt: updated.usernameChangedAt,
    };
  }
}
