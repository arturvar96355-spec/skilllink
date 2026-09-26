-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'HEAD';

-- AlterTable
ALTER TABLE "universities" ADD COLUMN     "responsible_user_id" TEXT;

-- CreateTable
CREATE TABLE "workflow_stage_templates" (
    "id" TEXT NOT NULL,
    "stage_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "phase" "StagePhase" NOT NULL,
    "normative_days" INTEGER NOT NULL,
    "is_control_point" BOOLEAN NOT NULL DEFAULT false,
    "default_tasks" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_stage_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_stage_templates_stage_number_key" ON "workflow_stage_templates"("stage_number");

-- CheckConstraint (та же граница, что у workflow_stages.stage_number)
ALTER TABLE "workflow_stage_templates"
  ADD CONSTRAINT "workflow_stage_templates_stage_number_check"
    CHECK ("stage_number" BETWEEN 1 AND 14);

-- CreateIndex
CREATE INDEX "universities_responsible_user_id_idx" ON "universities"("responsible_user_id");

-- AddForeignKey
ALTER TABLE "universities" ADD CONSTRAINT "universities_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stage_templates" ADD CONSTRAINT "workflow_stage_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
