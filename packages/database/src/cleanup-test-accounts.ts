import { prisma } from './client';

// Convención usada en todas las baterías de pruebas de este proyecto desde
// el principio (ver docs/API_CONTRACT.md, kodaschool_realtest@kodo.test,
// pipeline_check_...@kodo.test, y toda cuenta creada durante el bloque
// Perfil+Social): el TLD ".test" no es resoluble/registrable de verdad
// (reservado por la IANA exactamente para esto), así que ninguna cuenta
// real puede tener un correo con este dominio. Es la única señal que se
// usa para borrar — nunca patrones de username, para no arriesgar jamás
// una cuenta real.
const TEST_EMAIL_SUFFIX = '@kodo.test';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true, email: true, createdAt: true, userProfile: { select: { username: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Encontradas ${testUsers.length} cuenta(s) con email terminado en "${TEST_EMAIL_SUFFIX}":\n`);
  for (const u of testUsers) {
    console.log(`  ${u.email}  (@${u.userProfile?.username ?? '?'})  creada ${u.createdAt.toISOString()}`);
  }

  if (testUsers.length === 0) {
    console.log('\nNada que limpiar.');
    return;
  }

  if (!confirm) {
    console.log(`\nModo simulación (dry-run) — no se borró nada. Vuelve a correr con --confirm para eliminar estas ${testUsers.length} cuenta(s).`);
    return;
  }

  const result = await prisma.user.deleteMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
  });
  console.log(`\nEliminada(s) ${result.count} cuenta(s) y todo su contenido asociado (perfil, progreso, follows, notificaciones, etc. vía cascade).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
