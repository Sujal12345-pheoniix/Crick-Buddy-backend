const prisma = require('./src/utils/prisma');

async function main() {
  const users = await prisma.user.findMany({ take: 5 });
  console.log('Users:', JSON.stringify(users, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
