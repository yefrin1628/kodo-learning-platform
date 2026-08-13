import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Single source of truth for "does this user have Pro right now" — used
   * by learning.service.ts to grant infinite hearts / XP x2 without either
   * side trusting a client-sent flag. */
  async isPro(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    return sub?.status === 'ACTIVE';
  }

  /** Simulated checkout (no real charge, matches the existing "MVP, sin
   * cobros reales" UI copy) — but the resulting Pro state is real and
   * server-authoritative from here on, not a client-side flag. One
   * meaningful subscription row per user: activating again (e.g. switching
   * monthly -> yearly) just replaces the existing row. */
  async checkout(userId: string, planKey: 'PRO_MONTHLY' | 'PRO_YEARLY') {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan no encontrado.');

    const now = new Date();
    const periodMs = plan.interval === 'YEAR' ? YEAR_MS : MONTH_MS;
    const currentPeriodEnd = new Date(now.getTime() + periodMs);

    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      update: { planId: plan.id, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd, cancelAtPeriodEnd: false },
      create: { userId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd },
    });

    return { planKey: plan.key, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd };
  }

  /** Immediate downgrade to free (no grace period) — matches the existing
   * "Cancelar mi suscripción Pro" button's current instant-downgrade UX. */
  async cancel(userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub || sub.status !== 'ACTIVE') throw new BadRequestException('No tienes una suscripción activa.');

    const updated = await this.prisma.subscription.update({ where: { userId }, data: { status: 'CANCELED' } });
    return { status: updated.status };
  }
}
