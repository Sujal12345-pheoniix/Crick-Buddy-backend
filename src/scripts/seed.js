require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seed() {
    console.log('🌱 Seeding PostgreSQL database via Prisma...');

    // Clear existing data (order matters due to foreign keys)
    console.log('🧹 Clearing existing data...');
    await prisma.progressEntry.deleteMany({});
    await prisma.analysisReport.deleteMany({});
    await prisma.upload.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.academy.deleteMany({});

    // Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const coachPassword = await bcrypt.hash('coach123', 10);
    const playerPassword = await bcrypt.hash('demo123', 10);

    console.log('👥 Creating users...');

    // Create Admin
    await prisma.user.create({
        data: {
            name: 'Admin User',
            email: 'admin@crickbuddy.com',
            password: adminPassword,
            role: 'admin',
            playerType: 'batsman',
            experienceLevel: 'professional'
        }
    });

    // Create Coach
    await prisma.user.create({
        data: {
            name: 'Rahul Coach',
            email: 'coach@crickbuddy.com',
            password: coachPassword,
            role: 'coach',
            playerType: 'all-rounder',
            experienceLevel: 'professional'
        }
    });

    // Create Demo Player
    await prisma.user.create({
        data: {
            name: 'Demo Player',
            email: 'demo@crickbuddy.com',
            password: playerPassword,
            role: 'player',
            playerType: 'batsman',
            experienceLevel: 'intermediate',
            battingStyle: 'right-handed',
            totalUploads: 5,
            totalReports: 4,
            overallScore: 76
        }
    });

    console.log('✅ Seeding complete!');
    console.log('\n📋 Demo credentials:');
    console.log('  Admin:  admin@crickbuddy.com / admin123');
    console.log('  Coach:  coach@crickbuddy.com / coach123');
    console.log('  Player: demo@crickbuddy.com / demo123');
}

seed()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
