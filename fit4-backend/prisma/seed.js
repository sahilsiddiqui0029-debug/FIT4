const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data...');

  // Create a Test User (Punjabi Region)
  const testUser = await prisma.user.upsert({
    where: { phone: '919876543210' },
    update: {},
    create: {
      phone: '919876543210',
      abhaId: 'test-user@abdm',
      region: 'Punjab',
      subscription: {
        create: {
          tier: 'PRO',
          status: 'ACTIVE'
        }
      }
    }
  });

  // Create initial Health Logs for trend analysis
  await prisma.healthLog.createMany({
    data: [
      { userId: testUser.id, type: 'GLUCOSE', value1: 145, source: 'IOT' },
      { userId: testUser.id, type: 'BP', value1: 120, value2: 80, source: 'MANUAL' }
    ]
  });

  console.log('Seeding complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
