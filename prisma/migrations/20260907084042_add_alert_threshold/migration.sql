-- CreateTable
CREATE TABLE "alert_thresholds" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT,
    "metricType" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_thresholds_vpsId_idx" ON "alert_thresholds"("vpsId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_thresholds_vpsId_metricType_key" ON "alert_thresholds"("vpsId", "metricType");

-- AddForeignKey
ALTER TABLE "alert_thresholds" ADD CONSTRAINT "alert_thresholds_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
