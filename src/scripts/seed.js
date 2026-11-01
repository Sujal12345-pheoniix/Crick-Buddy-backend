require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');

// Demo accounts used by the login page's "Try with demo credentials" button.
// Accounts that already exist are left untouched — this script never deletes data.
const DEMO_USERS = [
    {
        name: 'Admin User',
        email: 'admin@crickbuddy.com',
        password: 'admin123',
        role: 'admin',
        playerType: 'batsman',
        experienceLevel: 'professional'
    },
    {
        name: 'Rahul Coach',
        email: 'coach@crickbuddy.com',
        password: 'coach123',
        role: 'coach',
        playerType: 'all-rounder',
        experienceLevel: 'professional'
    },
    {
        name: 'Demo Player',
        email: 'demo@crickbuddy.com',
        password: 'demo123',
        role: 'player',
        playerType: 'all-rounder',
        experienceLevel: 'intermediate',
        battingStyle: 'right-handed',
        bowlingStyle: 'right-arm-fast'
    }
];

async function seed() {
    if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
        throw new Error('Refusing to create demo accounts with known passwords in production. '
            + 'Set SEED_ALLOW_PRODUCTION=true to override.');
    }

    console.log('🌱 Ensuring demo accounts exist...');
    for (const { password, ...profile } of DEMO_USERS) {
        const existing = await prisma.user.findUnique({ where: { email: profile.email } });
        if (existing) {
            console.log(`  ✓ ${profile.email} already exists (${existing.role}) — left unchanged`);
            continue;
        }
        await prisma.user.create({ data: { ...profile, password: await bcrypt.hash(password, 12) } });
        console.log(`  + created ${profile.email} (${profile.role})`);
    }

    console.log('\n📋 Demo credentials:');
    for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(6)} ${u.email} / ${u.password}`);
}

seed()
    .catch((e) => {
        console.error('❌ Seeding failed:', e.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
