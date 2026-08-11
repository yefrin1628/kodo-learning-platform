import { Injectable } from '@nestjs/common';
import { Prisma } from '@kodo/database';
import { PrismaService } from '../prisma/prisma.service';

export type RankingPeriod = 'weekly' | 'monthly' | 'allTime';

interface RankRow {
  userId: string;
  username: string;
  displayName: string;
  xp: bigint;
  lessons: bigint;
  rank: bigint;
}

export interface RankingEntry {
  rank: number;
  username: string;
  displayName: string;
  xp: number;
}

export interface RankingResponse {
  period: RankingPeriod;
  entries: RankingEntry[];
  me: { rank: number; xp: number } | null;
}

const TOP_N = 20;

@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  async getRanking(userId: string, period: RankingPeriod): Promise<RankingResponse> {
    const since = this.periodStart(period);

    // XP for the period is always summed live from the xp_transactions
    // ledger (never from a maintained counter), the same way challenge
    // progress is computed — "allTime" is just the same query with a since
    // date of the epoch, so all three periods share one code path.
    // RANK() (not ROW_NUMBER()) so genuine ties share a position, resolved
    // in this exact order: XP -> lessons completed -> most recent activity.
    const rows = await this.prisma.$queryRaw<RankRow[]>(Prisma.sql`
      WITH agg AS (
        SELECT
          u.id AS "userId",
          up.username AS username,
          up."displayName" AS "displayName",
          COALESCE((
            SELECT SUM(xt.amount) FROM xp_transactions xt
            WHERE xt."userId" = u.id AND xt."createdAt" >= ${since}
          ), 0)::bigint AS xp,
          (
            SELECT COUNT(*) FROM lesson_progress lp
            WHERE lp."userId" = u.id AND lp.completed = true
          )::bigint AS lessons,
          (
            SELECT MAX(xt2."createdAt") FROM xp_transactions xt2 WHERE xt2."userId" = u.id
          ) AS "lastActivity"
        FROM users u
        JOIN user_profiles up ON up."userId" = u.id
      )
      SELECT
        "userId", username, "displayName", xp, lessons,
        RANK() OVER (ORDER BY xp DESC, lessons DESC, "lastActivity" DESC NULLS LAST) AS rank
      FROM agg
      ORDER BY rank ASC
      LIMIT 5000
    `);

    const entries: RankingEntry[] = rows.slice(0, TOP_N).map((r) => ({
      rank: Number(r.rank),
      username: r.username,
      displayName: r.displayName,
      xp: Number(r.xp),
    }));

    const mine = rows.find((r) => r.userId === userId);
    const me = mine ? { rank: Number(mine.rank), xp: Number(mine.xp) } : null;

    return { period, entries, me };
  }

  private periodStart(period: RankingPeriod): Date {
    const now = new Date();
    if (period === 'weekly') {
      const day = (now.getDay() + 6) % 7; // Monday = 0
      const monday = new Date(now);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(now.getDate() - day);
      return monday;
    }
    if (period === 'monthly') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return new Date(0); // allTime
  }
}
