const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("=== RECENT UPLOADS ===");
    const uploads = await prisma.upload.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    for (const u of uploads) {
        console.log(`Upload ID: ${u.id}`);
        console.log(`Type: ${u.type}`);
        console.log(`Filename: ${u.filename}`);
        console.log(`Status: ${u.status}`);
        console.log(`Progress: ${u.processingProgress}%`);
        console.log(`Error Message: ${u.errorMessage}`);
        console.log(`Created At: ${u.createdAt}`);
        console.log("------------------------");
    }

    console.log("\n=== RECENT REPORTS ===");
    const reports = await prisma.analysisReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3
    });
    for (const r of reports) {
        console.log(`Report ID: ${r.id}`);
        console.log(`Upload ID: ${r.uploadId}`);
        console.log(`Type: ${r.type}`);
        console.log(`Overall Score: ${r.overallScore}`);
        console.log(`Created At: ${r.createdAt}`);
        console.log("------------------------");
    }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
