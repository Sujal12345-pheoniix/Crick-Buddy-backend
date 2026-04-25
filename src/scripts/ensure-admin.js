require('dotenv').config();
const prisma = require('../utils/prisma');
const bcrypt = require('bcryptjs');

async function main() {
    console.log('🛡️  Ensuring Admin user exists...');
    
    const adminEmail = 'admin@crickbuddy.com';
    const exists = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (exists) {
        if (exists.role !== 'admin') {
            console.log('🔄 Updating existing user to Admin role...');
            await prisma.user.update({
                where: { email: adminEmail },
                data: { role: 'admin' }
            });
        }
        console.log('✅ Admin user already exists.');
    } else {
        console.log('➕ Creating new Admin user...');
        const hashedPassword = await bcrypt.hash('admin123', 12);
        await prisma.user.create({
            data: {
                name: 'System Admin',
                email: adminEmail,
                password: hashedPassword,
                role: 'admin',
                experienceLevel: 'professional',
                playerType: 'all-rounder'
            }
        });
        console.log('✅ Admin user created successfully.');
    }
}

main()
    .catch(e => console.error('❌ Error:', e))
    .finally(() => prisma.$disconnect());
