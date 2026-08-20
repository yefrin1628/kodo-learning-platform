import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@kodo/database';
import { PrismaService } from '../prisma/prisma.service';

interface ListOptions {
  cursor?: string;
  limit?: number;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea una notificación con actor, salvo que exista un Block entre las
   * partes en cualquier dirección — el bloqueo no debe poder generar
   * actividad nueva. Centralizado aquí para que cualquier notificación
   * futura con actor (logros de amigos, retos, etc.) herede la misma regla
   * sin tener que repetirla en cada feature. */
  async createForActor(
    userId: string,
    actorId: string,
    type: NotificationType,
    metadata?: Prisma.InputJsonValue,
  ) {
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: actorId },
          { blockerId: actorId, blockedId: userId },
        ],
      },
    });
    if (blocked) return null;
    return this.prisma.notification.create({ data: { userId, actorId, type, metadata } });
  }

  async list(userId: string, { cursor, limit = 20 }: ListOptions) {
    const take = Math.min(Math.max(limit, 1), 50);

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          actor: { select: { userProfile: { select: { username: true, displayName: true, avatarUrl: true } } } },
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        actor: n.actor?.userProfile
          ? {
              username: n.actor.userProfile.username,
              displayName: n.actor.userProfile.displayName,
              avatarUrl: n.actor.userProfile.avatarUrl,
            }
          : null,
        metadata: n.metadata,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    const notif = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notif) {
      throw new NotFoundException('Notificación no encontrada.');
    }
    if (!notif.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
