-- Brings the migration history in line with prisma/schema.prisma.
-- The init migration predates the temporal-metric columns and the
-- RawFrameMetric / AggregateMetric / FaultLog / MatchPerformanceEntry tables.
-- Statements are idempotent so databases previously synced with `prisma db push`
-- can apply this migration without errors.

-- AlterTable
ALTER TABLE "AnalysisReport"
    ADD COLUMN IF NOT EXISTS "headStabilityScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "headStabilityVariance" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "peakKneeFlexion" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "peakKneeExtension" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "rangeOfMotion" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "wristYDelta" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "strideScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "avgStrideRatio" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "armSmoothnessScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "avgJerk" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "peakWristY" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "releaseArmAngle" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "speedClassification" TEXT,
    ADD COLUMN IF NOT EXISTS "balanceScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "avgHipTilt" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "avgSpineOffset" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProgressEntry"
    ADD COLUMN IF NOT EXISTS "headStabilityScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "strideScore" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "armSmoothnessScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RawFrameMetric" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "reportId" TEXT,
    "frameIndex" INTEGER NOT NULL,
    "frameType" TEXT NOT NULL,
    "landmarks" JSONB,
    "leftKneeAngle" DOUBLE PRECISION,
    "rightKneeAngle" DOUBLE PRECISION,
    "leftElbowAngle" DOUBLE PRECISION,
    "rightElbowAngle" DOUBLE PRECISION,
    "shoulderTilt" DOUBLE PRECISION,
    "hipTilt" DOUBLE PRECISION,
    "spineOffset" DOUBLE PRECISION,
    "wristY" DOUBLE PRECISION,
    "noseY" DOUBLE PRECISION,
    "ankleSpread" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawFrameMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AggregateMetric" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "headStabilityScore" DOUBLE PRECISION,
    "headStabilityVariance" DOUBLE PRECISION,
    "balanceScore" DOUBLE PRECISION,
    "avgHipTilt" DOUBLE PRECISION,
    "avgSpineOffset" DOUBLE PRECISION,
    "timingScore" DOUBLE PRECISION,
    "peakKneeFlexion" DOUBLE PRECISION,
    "kneeExtensionAtEnd" DOUBLE PRECISION,
    "rangeOfMotion" DOUBLE PRECISION,
    "strideScore" DOUBLE PRECISION,
    "avgStrideRatio" DOUBLE PRECISION,
    "armSmoothnessScore" DOUBLE PRECISION,
    "avgJerk" DOUBLE PRECISION,
    "releasePointScore" DOUBLE PRECISION,
    "peakWristY" DOUBLE PRECISION,
    "followThroughScore" DOUBLE PRECISION,
    "wristYDelta" DOUBLE PRECISION,
    "detectedShotType" TEXT,
    "bowlingStyle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AggregateMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FaultLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "faultCode" TEXT NOT NULL,
    "faultText" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "severity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaultLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchPerformanceEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchDate" TIMESTAMP(3) NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "balls" INTEGER NOT NULL DEFAULT 0,
    "wickets" INTEGER NOT NULL DEFAULT 0,
    "oversBowled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runsConceded" INTEGER NOT NULL DEFAULT 0,
    "catches" INTEGER NOT NULL DEFAULT 0,
    "stumpings" INTEGER NOT NULL DEFAULT 0,
    "strikeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "economy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "battingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bowlingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fieldingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchPerformanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RawFrameMetric_uploadId_idx" ON "RawFrameMetric"("uploadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RawFrameMetric_reportId_idx" ON "RawFrameMetric"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AggregateMetric_reportId_key" ON "AggregateMetric"("reportId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FaultLog_reportId_idx" ON "FaultLog"("reportId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MatchPerformanceEntry_userId_matchDate_idx" ON "MatchPerformanceEntry"("userId", "matchDate");

-- AddForeignKey (guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RawFrameMetric_reportId_fkey') THEN
        ALTER TABLE "RawFrameMetric" ADD CONSTRAINT "RawFrameMetric_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalysisReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RawFrameMetric_uploadId_fkey') THEN
        ALTER TABLE "RawFrameMetric" ADD CONSTRAINT "RawFrameMetric_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AggregateMetric_reportId_fkey') THEN
        ALTER TABLE "AggregateMetric" ADD CONSTRAINT "AggregateMetric_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalysisReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FaultLog_reportId_fkey') THEN
        ALTER TABLE "FaultLog" ADD CONSTRAINT "FaultLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalysisReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MatchPerformanceEntry_userId_fkey') THEN
        ALTER TABLE "MatchPerformanceEntry" ADD CONSTRAINT "MatchPerformanceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
