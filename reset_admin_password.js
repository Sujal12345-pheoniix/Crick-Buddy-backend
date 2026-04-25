require('dotenv').config();
const prisma = require('./src/utils/prisma');
const bcrypt = require('bcryptjs');

async function main() {
    const newPassword = await bcrypt.hash('admin123', 12);
    const updated = await prisma.user.upsert({
        where: { email: 'admin@crickbuddy.com' },
        update: { password: newPassword },
        create: {
            email: 'admin@crickbuddy.com',
            password: newPassword,
            name: 'System Admin',
            role: 'admin'
        },
        select: { id: true, email: true, role: true, name: true }
    });
    console.log('✅ Admin account configured to "admin123"');
    console.log('User:', JSON.stringify(updated, null, 2));
}

main()
    .catch(e => console.error('❌ Error:', e))
    .finally(() => prisma.$disconnect());
