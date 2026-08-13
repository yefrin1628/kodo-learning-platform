import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SHOP_ITEMS } from './shop-items.constants';

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventory(userId: string) {
    const [stats, items] = await Promise.all([
      this.prisma.userStats.findUniqueOrThrow({ where: { userId } }),
      this.prisma.userInventory.findMany({ where: { userId } }),
    ]);
    return {
      gems: stats.gems,
      hearts: stats.hearts,
      items: items.map((i) => ({ itemKey: i.itemKey, equipped: i.equipped, purchasedAt: i.purchasedAt })),
    };
  }

  /**
   * Server-authoritative purchase. Takes no client-supplied price/balance —
   * itemKey is the only input, price/kind always come from SHOP_ITEMS.
   * The gems (and, for hearts, the hearts-full check) are validated and
   * decremented in one guarded UPDATE so a concurrent duplicate request
   * always re-checks against the latest committed row instead of a stale
   * read, and owned-item double-purchase is closed by the unique
   * (userId, itemKey) constraint + P2002 catch below.
   */
  async purchase(userId: string, itemKey: string) {
    const item = SHOP_ITEMS[itemKey];
    if (!item) throw new NotFoundException('Objeto no encontrado.');

    if (item.kind === 'owned') {
      const existing = await this.prisma.userInventory.findUnique({
        where: { userId_itemKey: { userId, itemKey } },
      });
      if (existing) throw new ConflictException('Ya tienes este objeto.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const where: Record<string, unknown> = { userId, gems: { gte: item.price } };
        const data: Record<string, unknown> = { gems: { decrement: item.price } };
        if (itemKey === 'hearts') {
          where.hearts = { lt: 5 };
          data.hearts = 5;
        }

        const deducted = await tx.userStats.updateMany({ where, data });
        if (deducted.count === 0) {
          if (itemKey === 'hearts') {
            const stats = await tx.userStats.findUniqueOrThrow({ where: { userId } });
            if (stats.hearts >= 5) throw new BadRequestException('Tus vidas ya están llenas.');
          }
          throw new BadRequestException('No tienes suficientes gemas.');
        }

        if (item.kind === 'owned') {
          await tx.userInventory.create({ data: { userId, itemKey, equipped: !!item.equippable } });
        }

        const stats = await tx.userStats.findUniqueOrThrow({ where: { userId } });
        return { itemKey, gems: stats.gems, hearts: stats.hearts };
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Ya tienes este objeto.');
      throw e;
    }
  }

  async setEquipped(userId: string, itemKey: string, equipped: boolean) {
    const item = SHOP_ITEMS[itemKey];
    if (!item || !item.equippable) throw new NotFoundException('Objeto no equipable.');

    const owned = await this.prisma.userInventory.findUnique({
      where: { userId_itemKey: { userId, itemKey } },
    });
    if (!owned) throw new ForbiddenException('No tienes este objeto.');

    const updated = await this.prisma.userInventory.update({
      where: { userId_itemKey: { userId, itemKey } },
      data: { equipped },
    });
    return { itemKey, equipped: updated.equipped };
  }
}
