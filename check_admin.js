const prisma = require('./src/utils/prisma');

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' }
  });
  console.log('Admin User Found:', JSON.stringify(admin, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
