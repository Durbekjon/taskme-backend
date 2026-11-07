import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  
  // Seed Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN' },
  });
  
  const studioRole = await prisma.role.upsert({
    where: { name: 'STUDIO' },
    update: {},
    create: { name: 'STUDIO' },
  });

  const workerRole = await prisma.role.upsert({
    where: { name: 'WORKER' },
    update: {},
    create: { name: 'WORKER' },
  });

  console.log('Roles seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
