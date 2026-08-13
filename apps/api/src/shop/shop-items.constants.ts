export interface ShopItemDef {
  price: number;
  kind: 'consumable' | 'owned';
  equippable?: boolean;
}

/**
 * Mirrors the SHOP catalog in index.html (icon/name/desc stay client-side,
 * purely cosmetic display copy). This is the only list the server trusts for
 * price/kind — a client can never supply its own price. `theme-violet` is
 * intentionally absent: it's a free, non-owned "reset to default" action
 * that never touches gems or inventory, so it never goes through purchase.
 */
export const SHOP_ITEMS: Record<string, ShopItemDef> = {
  hearts: { price: 30, kind: 'consumable' },
  shield: { price: 50, kind: 'consumable' },
  boost: { price: 40, kind: 'consumable' },
  'theme-cyan': { price: 80, kind: 'owned' },
  'theme-sunset': { price: 80, kind: 'owned' },
  glasses: { price: 60, kind: 'owned', equippable: true },
  headphones: { price: 60, kind: 'owned', equippable: true },
  crown: { price: 100, kind: 'owned', equippable: true },
  badge: { price: 70, kind: 'owned' },
};
