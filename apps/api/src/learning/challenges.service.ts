import { Injectable } from '@nestjs/common';
import type { Prisma } from '@kodo/database';

type Tx = Prisma.TransactionClient;
const today = () => new Date().toLocaleDateString('en-CA');

export interface ClaimedChallenge {
  key: string;
  title: string;
  icon: string;
  xp: number;
  gems: number;
}

@Injectable()
export class ChallengesService {
  /**
   * Challenges reset daily by definition (progress is scoped to today's
   * date), so there's no cron/reset job to run — a new day simply has no
   * UserChallengeProgress row yet. Progress is computed live from the real
   * tables each time rather than kept as a separately-maintained counter,
   * so it can never drift out of sync with reality.
   */
  async checkAndClaim(tx: Tx, userId: string): Promise<ClaimedChallenge[]> {
    const t = today();
    const dayStart = new Date(`${t}T00:00:00`);
    const challenges = await tx.challenge.findMany({ where: { isActive: true } });
    const claimedToday = await tx.userChallengeProgress.findMany({
      where: { userId, date: t, claimed: true },
      select: { challengeId: true },
    });
    const alreadyClaimed = new Set(claimedToday.map((c) => c.challengeId));

    const claimed: ClaimedChallenge[] = [];
    for (const ch of challenges) {
      if (alreadyClaimed.has(ch.id)) continue;
      const progress = await this.measure(tx, userId, ch.metric, dayStart);
      if (progress < ch.goal) continue;

      await tx.userChallengeProgress.upsert({
        where: { userId_challengeId_date: { userId, challengeId: ch.id, date: t } },
        update: { progress, claimed: true, claimedAt: new Date() },
        create: { userId, challengeId: ch.id, date: t, progress, claimed: true, claimedAt: new Date() },
      });
      if (ch.rewardXp > 0) {
        await tx.xPTransaction.create({
          data: { userId, amount: ch.rewardXp, reason: 'CHALLENGE_COMPLETE', metadata: { challengeKey: ch.key } },
        });
        await tx.userStats.update({ where: { userId }, data: { xp: { increment: ch.rewardXp } } });
      }
      if (ch.rewardGems > 0) {
        await tx.userStats.update({ where: { userId }, data: { gems: { increment: ch.rewardGems } } });
      }
      claimed.push({ key: ch.key, title: ch.title, icon: ch.icon, xp: ch.rewardXp, gems: ch.rewardGems });
    }
    return claimed;
  }

  private async measure(tx: Tx, userId: string, metric: string, dayStart: Date): Promise<number> {
    switch (metric) {
      case 'lessons_completed':
        return tx.lessonProgress.count({ where: { userId, completedAt: { gte: dayStart } } });
      case 'xp_earned': {
        const agg = await tx.xPTransaction.aggregate({
          where: { userId, createdAt: { gte: dayStart } },
          _sum: { amount: true },
        });
        return agg._sum.amount ?? 0;
      }
      case 'exercises_answered':
        return tx.exerciseProgress.count({ where: { userId, lastAttemptAt: { gte: dayStart } } });
      case 'streak_maintained': {
        const streak = await tx.streak.findUnique({ where: { userId } });
        return streak?.lastActiveDate === today() ? 1 : 0;
      }
      case 'lesson_perfect':
        return tx.lessonProgress.count({ where: { userId, perfect: true, completedAt: { gte: dayStart } } });
      case 'code_run':
        return tx.exerciseProgress.count({ where: { userId, lastAttemptAt: { gte: dayStart }, exercise: { type: 'RUN' } } });
      default:
        return 0;
    }
  }
}
