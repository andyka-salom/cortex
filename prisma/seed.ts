import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Seed 1 Superadmin awal dari env. Idempotent (upsert by email). */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123';
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Superadmin',
      email,
      passwordHash,
      role: Role.SUPERADMIN,
      isActive: true,
    },
  });

  console.log(`Seed selesai. Superadmin: ${admin.email} (role ${admin.role})`);
  console.log('Ganti password default setelah login pertama.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
