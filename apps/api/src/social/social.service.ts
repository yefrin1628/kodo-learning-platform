import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface Page {
  page?: number;
  limit?: number;
}

function takeSkip({ page, limit }: Page) {
  const take = Math.min(Math.max(limit ?? 20, 1), 50);
  const skip = (Math.max(page ?? 1, 1) - 1) * take;
  return { take, skip };
}

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveByUsername(username: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { username }, select: { userId: true } });
    if (!profile) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    return profile;
  }

  private async isBlockedEitherDirection(aId: string, bId: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: aId, blockedId: bId },
          { blockerId: bId, blockedId: aId },
        ],
      },
    });
    return !!block;
  }

  /** IDs de cualquiera involucrado en un bloqueo (en cualquier dirección)
   * con `userId` — usado para excluir consistentemente de búsqueda,
   * seguidores y siguiendo, no solo del perfil individual. */
  private async blockedEitherDirectionIds(userId: string): Promise<string[]> {
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const b of blocks) {
      ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    return [...ids];
  }

  private toCard(user: {
    userProfile: { username: string; displayName: string; avatarUrl: string | null } | null;
    userStats: { level: number } | null;
  }) {
    return {
      username: user.userProfile?.username ?? null,
      displayName: user.userProfile?.displayName ?? null,
      avatarUrl: user.userProfile?.avatarUrl ?? null,
      level: user.userStats?.level ?? 1,
    };
  }

  async getPublicProfile(requesterId: string, username: string) {
    const target = await this.prisma.userProfile.findUnique({
      where: { username },
      include: {
        user: {
          include: {
            userStats: true,
            streak: true,
            achievements: { include: { achievement: { select: { key: true } } } },
          },
        },
      },
    });
    if (!target) {
      throw new NotFoundException('Usuario no encontrado.');
    }
    const targetId = target.userId;
    const isMe = targetId === requesterId;

    // Nunca revelamos que existe un bloqueo — de cara al que consulta, un
    // perfil bloqueado simplemente "no existe".
    if (!isMe && (await this.isBlockedEitherDirection(requesterId, targetId))) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    const [followersCount, followingCount, isFollowing, isFollowedBy] = await Promise.all([
      this.prisma.follow.count({ where: { followingId: targetId } }),
      this.prisma.follow.count({ where: { followerId: targetId } }),
      isMe
        ? Promise.resolve(false)
        : this.prisma.follow
            .findUnique({ where: { followerId_followingId: { followerId: requesterId, followingId: targetId } } })
            .then(Boolean),
      isMe
        ? Promise.resolve(false)
        : this.prisma.follow
            .findUnique({ where: { followerId_followingId: { followerId: targetId, followingId: requesterId } } })
            .then(Boolean),
    ]);

    return {
      username: target.username,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl,
      bio: target.bio,
      level: target.user.userStats?.level ?? 1,
      xp: target.user.userStats?.xp ?? 0,
      streak: target.user.streak?.current ?? 0,
      followersCount,
      followingCount,
      achievements: target.user.achievements.map((a) => a.achievement.key),
      isFollowing,
      isFollowedBy,
      isMe,
    };
  }

  async search(requesterId: string, q: string, page: Page) {
    const query = q.trim();
    if (query.length < 2) {
      return { items: [] };
    }
    const { take, skip } = takeSkip(page);
    const excludeIds = [requesterId, ...(await this.blockedEitherDirectionIds(requesterId))];

    const profiles = await this.prisma.userProfile.findMany({
      where: {
        userId: { notIn: excludeIds },
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      skip,
      orderBy: { username: 'asc' },
      include: { user: { include: { userStats: true, streak: true } } },
    });

    return {
      items: profiles.map((p) => ({
        username: p.username,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        level: p.user.userStats?.level ?? 1,
        streak: p.user.streak?.current ?? 0,
      })),
    };
  }

  async follow(requesterId: string, username: string) {
    const target = await this.resolveByUsername(username);
    if (target.userId === requesterId) {
      throw new BadRequestException('No puedes seguirte a ti mismo.');
    }
    if (await this.isBlockedEitherDirection(requesterId, target.userId)) {
      throw new ForbiddenException('No puedes seguir a este usuario.');
    }

    // Solo notifica cuando el Follow es realmente nuevo — sin este chequeo,
    // llamar a follow() de forma idempotente (el mismo botón "Seguir"
    // pulsado dos veces, por ejemplo) generaría una notificación duplicada
    // cada vez, encontrado precisamente por la prueba de idempotencia.
    const existing = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: requesterId, followingId: target.userId } },
    });
    if (!existing) {
      await this.prisma.follow.create({ data: { followerId: requesterId, followingId: target.userId } });
      await this.notifications.createForActor(target.userId, requesterId, 'NEW_FOLLOWER');
    }

    const followersCount = await this.prisma.follow.count({ where: { followingId: target.userId } });
    return { following: true, followersCount };
  }

  async unfollow(requesterId: string, username: string) {
    const target = await this.resolveByUsername(username);
    await this.prisma.follow.deleteMany({ where: { followerId: requesterId, followingId: target.userId } });
    const followersCount = await this.prisma.follow.count({ where: { followingId: target.userId } });
    return { following: false, followersCount };
  }

  async getFollowers(requesterId: string, username: string, page: Page) {
    const target = await this.resolveByUsername(username);
    const { take, skip } = takeSkip(page);
    const excludeIds = await this.blockedEitherDirectionIds(requesterId);

    const rows = await this.prisma.follow.findMany({
      where: { followingId: target.userId, followerId: { notIn: excludeIds } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { follower: { include: { userProfile: true, userStats: true } } },
    });
    return { items: rows.map((r) => this.toCard(r.follower)) };
  }

  async getFollowing(requesterId: string, username: string, page: Page) {
    const target = await this.resolveByUsername(username);
    const { take, skip } = takeSkip(page);
    const excludeIds = await this.blockedEitherDirectionIds(requesterId);

    const rows = await this.prisma.follow.findMany({
      where: { followerId: target.userId, followingId: { notIn: excludeIds } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { following: { include: { userProfile: true, userStats: true } } },
    });
    return { items: rows.map((r) => this.toCard(r.following)) };
  }

  async block(requesterId: string, username: string) {
    const target = await this.resolveByUsername(username);
    if (target.userId === requesterId) {
      throw new BadRequestException('No puedes bloquearte a ti mismo.');
    }
    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId: requesterId, blockedId: target.userId } },
        create: { blockerId: requesterId, blockedId: target.userId },
        update: {},
      }),
      this.prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: requesterId, followingId: target.userId },
            { followerId: target.userId, followingId: requesterId },
          ],
        },
      }),
    ]);
    return { blocked: true };
  }

  async unblock(requesterId: string, username: string) {
    const target = await this.resolveByUsername(username);
    await this.prisma.block.deleteMany({ where: { blockerId: requesterId, blockedId: target.userId } });
    return { blocked: false };
  }

  /** Deliberadamente NO comprueba bloqueos — bloquear a alguien nunca debe
   * impedir que te reporten, si no un bloqueo se volvería un escudo contra
   * la moderación. */
  async report(requesterId: string, username: string, reason: string) {
    const target = await this.resolveByUsername(username);
    if (target.userId === requesterId) {
      throw new BadRequestException('No puedes reportarte a ti mismo.');
    }
    await this.prisma.report.create({ data: { reporterId: requesterId, reportedId: target.userId, reason } });
    return { success: true };
  }
}
