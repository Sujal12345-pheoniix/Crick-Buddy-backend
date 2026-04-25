-- CreateTable
CREATE TABLE "Academy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'player',
    "avatar" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "battingStyle" TEXT NOT NULL DEFAULT 'right-handed',
    "bowlingStyle" TEXT NOT NULL DEFAULT 'none',
    "playerType" TEXT NOT NULL DEFAULT 'batsman',
    "experienceLevel" TEXT NOT NULL DEFAULT 'beginner',
    "academyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "totalUploads" INTEGER NOT NULL DEFAULT 0,
    "totalReports" INTEGER NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "fileUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processingProgress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "notes" TEXT,
    "duration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisReport" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stanceScore" DOUBLE PRECISION,
    "batSwingAngle" DOUBLE PRECISION,
    "headPosition" TEXT,
    "headPositionScore" DOUBLE PRECISION,
    "timingScore" DOUBLE PRECISION,
    "followThroughScore" DOUBLE PRECISION,
    "shotType" TEXT,
    "overallBattingScore" DOUBLE PRECISION,
    "wristPositionScore" DOUBLE PRECISION,
    "wristPositionNote" TEXT,
    "armRotationAngle" DOUBLE PRECISION,
    "armRotationScore" DOUBLE PRECISION,
    "releasePointScore" DOUBLE PRECISION,
    "releasePointNote" TEXT,
    "estimatedBallSpeed" DOUBLE PRECISION,
    "balanceScoreBowling" DOUBLE PRECISION,
    "bowlingStyle" TEXT,
    "overallBowlingScore" DOUBLE PRECISION,
    "shoulderAlignmentScore" DOUBLE PRECISION,
    "shoulderAlignmentNote" TEXT,
    "kneeBendAngle" DOUBLE PRECISION,
    "kneeBendScore" DOUBLE PRECISION,
    "balanceScorePosture" DOUBLE PRECISION,
    "spinePosScore" DOUBLE PRECISION,
    "overallPostureScore" DOUBLE PRECISION,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "improvementSuggestions" JSONB,
    "trainingDrills" JSONB,
    "overallScore" DOUBLE PRECISION,
    "landmarks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bestPractices" JSONB,
    "recommendations" JSONB,
    "mistakes" JSONB,

    CONSTRAINT "AnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batSwingAngle" DOUBLE PRECISION,
    "stanceScore" DOUBLE PRECISION,
    "timingScore" DOUBLE PRECISION,
    "followThroughScore" DOUBLE PRECISION,
    "estimatedBallSpeed" DOUBLE PRECISION,
    "armRotationAngle" DOUBLE PRECISION,
    "wristPositionScore" DOUBLE PRECISION,
    "releasePointScore" DOUBLE PRECISION,
    "balanceScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "scoreData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "source" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Match_externalId_source_idx" ON "Match"("externalId", "source");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisReport" ADD CONSTRAINT "AnalysisReport_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisReport" ADD CONSTRAINT "AnalysisReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalysisReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
