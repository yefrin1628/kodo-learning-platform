import { prisma } from './client';

async function main() {
  await prisma.plan.upsert({
    where: { key: 'FREE' },
    update: {},
    create: { key: 'FREE', name: 'Gratis', priceCents: 0, currency: 'USD', interval: null },
  });
  await prisma.plan.upsert({
    where: { key: 'PRO_MONTHLY' },
    update: {},
    create: { key: 'PRO_MONTHLY', name: 'Pro Mensual', priceCents: 499, currency: 'USD', interval: 'MONTH' },
  });
  await prisma.plan.upsert({
    where: { key: 'PRO_YEARLY' },
    update: {},
    create: { key: 'PRO_YEARLY', name: 'Pro Anual', priceCents: 3999, currency: 'USD', interval: 'YEAR' },
  });
  console.log('Seed complete: plans (FREE, PRO_MONTHLY, PRO_YEARLY)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
