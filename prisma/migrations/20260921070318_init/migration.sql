-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'ANALYST', 'VIEWER', 'UNIVERSITY_REP');

-- CreateEnum
CREATE TYPE "UniversityStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProgramLevel" AS ENUM ('SPO', 'BACHELOR', 'SPECIALIST', 'MASTER', 'POSTGRADUATE', 'DPO');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BASIC', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "SkillImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('CURRICULUM', 'EXPERT', 'INTEGRATION', 'IMPORT', 'MANUAL', 'MOCK');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "ProductSkillRelevance" AS ENUM ('CORE', 'RELATED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "CooperationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StagePhase" AS ENUM ('ATTRACTION', 'FORMALIZATION', 'IMPLEMENTATION', 'OPERATION', 'CONTROL');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NDA', 'AGREEMENT', 'ANNEX', 'ACT', 'LICENSE', 'CURRICULUM', 'METHODOLOGY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'SIGNED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MeetingFormat" AS ENUM ('ONLINE', 'OFFLINE', 'CALL', 'CORRESPONDENCE');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('PROGRAM', 'UNIVERSITY', 'SKILL', 'ACTION');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'ACCEPTED', 'DISMISSED', 'DONE');

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('MANUAL', 'CSV', 'EXTERNAL_API', 'LMS', 'SITE', 'MOCK');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'CONFIRMED', 'ENROLLED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "university_id" TEXT,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "address" TEXT,
    "website" TEXT,
    "status" "UniversityStatus" NOT NULL DEFAULT 'NEW',
    "direction_count" INTEGER,
    "student_count" INTEGER,
    "description" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educational_programs" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "direction" TEXT,
    "level" "ProgramLevel" NOT NULL,
    "duration_months" INTEGER,
    "status" "ProgramStatus" NOT NULL DEFAULT 'ACTIVE',
    "application_count" INTEGER,
    "student_count" INTEGER,
    "group_count" INTEGER,
    "metrics_source" "DataOrigin",
    "metrics_updated_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "educational_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_skills" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL DEFAULT 'BASIC',
    "importance" "SkillImportance" NOT NULL DEFAULT 'MEDIUM',
    "source" "DataOrigin" NOT NULL DEFAULT 'CURRICULUM',
    "confidence" "ConfidenceLevel",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_demand" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'vacancies',
    "region" TEXT,
    "source" TEXT NOT NULL,
    "data_source_id" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "is_mock" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "documentation_url" TEXT,
    "version" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "it_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skills" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "relevance" "ProductSkillRelevance" NOT NULL DEFAULT 'RELATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooperations" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "product_id" TEXT,
    "status" "CooperationStatus" NOT NULL DEFAULT 'DRAFT',
    "responsible_id" TEXT NOT NULL,
    "goal" TEXT,
    "notes" TEXT,
    "first_contact_at" TIMESTAMP(3),
    "classes_start_at" TIMESTAMP(3),
    "target_date" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cooperations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_stages" (
    "id" TEXT NOT NULL,
    "cooperation_id" TEXT NOT NULL,
    "stage_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "phase" "StagePhase" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "responsible_id" TEXT,
    "deadline" TIMESTAMP(3),
    "comment" TEXT,
    "result" TEXT,
    "blocking_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "from_status" "StageStatus",
    "to_status" "StageStatus" NOT NULL,
    "comment" TEXT,
    "changed_by_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "cooperation_id" TEXT,
    "university_id" TEXT,
    "program_id" TEXT,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "file_reference" TEXT,
    "author_id" TEXT,
    "responsible_id" TEXT,
    "issued_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_history" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "from_status" "DocumentStatus",
    "to_status" "DocumentStatus" NOT NULL,
    "comment" TEXT,
    "changed_by_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "cooperation_id" TEXT,
    "university_id" TEXT,
    "program_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "topic" TEXT NOT NULL,
    "format" "MeetingFormat" NOT NULL DEFAULT 'ONLINE',
    "result" TEXT,
    "next_action" TEXT,
    "next_action_due_at" TIMESTAMP(3),
    "responsible_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT,
    "contact_id" TEXT,
    "external_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'MEDIUM',
    "justification" TEXT NOT NULL,
    "related_data" JSONB,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEW',
    "cooperation_id" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "url" TEXT,
    "collection_date" TIMESTAMP(3),
    "reliability" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "description" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "source" "DataOrigin" NOT NULL DEFAULT 'MANUAL',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "comment" TEXT,
    "external_ref" TEXT,
    "created_by_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_university_id_idx" ON "users"("university_id");

-- CreateIndex
CREATE INDEX "universities_status_idx" ON "universities"("status");

-- CreateIndex
CREATE INDEX "universities_region_idx" ON "universities"("region");

-- CreateIndex
CREATE INDEX "universities_city_idx" ON "universities"("city");

-- CreateIndex
CREATE INDEX "contacts_university_id_idx" ON "contacts"("university_id");

-- CreateIndex
CREATE INDEX "educational_programs_university_id_idx" ON "educational_programs"("university_id");

-- CreateIndex
CREATE INDEX "educational_programs_level_idx" ON "educational_programs"("level");

-- CreateIndex
CREATE INDEX "educational_programs_status_idx" ON "educational_programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE INDEX "skills_category_idx" ON "skills"("category");

-- CreateIndex
CREATE INDEX "program_skills_skill_id_idx" ON "program_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_skills_program_id_skill_id_key" ON "program_skills"("program_id", "skill_id");

-- CreateIndex
CREATE INDEX "market_demand_period_idx" ON "market_demand"("period");

-- CreateIndex
CREATE UNIQUE INDEX "market_demand_skill_id_period_source_key" ON "market_demand"("skill_id", "period", "source");

-- CreateIndex
CREATE UNIQUE INDEX "it_products_name_key" ON "it_products"("name");

-- CreateIndex
CREATE INDEX "it_products_category_idx" ON "it_products"("category");

-- CreateIndex
CREATE INDEX "it_products_status_idx" ON "it_products"("status");

-- CreateIndex
CREATE INDEX "product_skills_skill_id_idx" ON "product_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_skills_product_id_skill_id_key" ON "product_skills"("product_id", "skill_id");

-- CreateIndex
CREATE INDEX "cooperations_university_id_idx" ON "cooperations"("university_id");

-- CreateIndex
CREATE INDEX "cooperations_program_id_idx" ON "cooperations"("program_id");

-- CreateIndex
CREATE INDEX "cooperations_product_id_idx" ON "cooperations"("product_id");

-- CreateIndex
CREATE INDEX "cooperations_status_idx" ON "cooperations"("status");

-- CreateIndex
CREATE INDEX "cooperations_responsible_id_idx" ON "cooperations"("responsible_id");

-- CreateIndex
CREATE INDEX "workflow_stages_status_idx" ON "workflow_stages"("status");

-- CreateIndex
CREATE INDEX "workflow_stages_deadline_idx" ON "workflow_stages"("deadline");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_stages_cooperation_id_stage_number_key" ON "workflow_stages"("cooperation_id", "stage_number");

-- CreateIndex
CREATE INDEX "tasks_stage_id_idx" ON "tasks"("stage_id");

-- CreateIndex
CREATE INDEX "stage_history_stage_id_idx" ON "stage_history"("stage_id");

-- CreateIndex
CREATE INDEX "stage_history_changed_at_idx" ON "stage_history"("changed_at");

-- CreateIndex
CREATE INDEX "documents_cooperation_id_idx" ON "documents"("cooperation_id");

-- CreateIndex
CREATE INDEX "documents_university_id_idx" ON "documents"("university_id");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "document_history_document_id_idx" ON "document_history"("document_id");

-- CreateIndex
CREATE INDEX "meetings_cooperation_id_idx" ON "meetings"("cooperation_id");

-- CreateIndex
CREATE INDEX "meetings_university_id_idx" ON "meetings"("university_id");

-- CreateIndex
CREATE INDEX "meetings_date_idx" ON "meetings"("date");

-- CreateIndex
CREATE INDEX "meeting_participants_meeting_id_idx" ON "meeting_participants"("meeting_id");

-- CreateIndex
CREATE INDEX "recommendations_status_priority_idx" ON "recommendations"("status", "priority");

-- CreateIndex
CREATE INDEX "recommendations_type_idx" ON "recommendations"("type");

-- CreateIndex
CREATE UNIQUE INDEX "recommendations_rule_key_object_type_object_id_key" ON "recommendations"("rule_key", "object_type", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_name_key" ON "data_sources"("name");

-- CreateIndex
CREATE INDEX "audit_log_object_type_object_id_idx" ON "audit_log"("object_type", "object_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "applications_program_id_idx" ON "applications"("program_id");

-- CreateIndex
CREATE INDEX "applications_university_id_idx" ON "applications"("university_id");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_programs" ADD CONSTRAINT "educational_programs_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_skills" ADD CONSTRAINT "program_skills_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_skills" ADD CONSTRAINT "program_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_demand" ADD CONSTRAINT "market_demand_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_demand" ADD CONSTRAINT "market_demand_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_skills" ADD CONSTRAINT "product_skills_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "it_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_skills" ADD CONSTRAINT "product_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooperations" ADD CONSTRAINT "cooperations_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooperations" ADD CONSTRAINT "cooperations_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "educational_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooperations" ADD CONSTRAINT "cooperations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "it_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooperations" ADD CONSTRAINT "cooperations_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_history" ADD CONSTRAINT "document_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_history" ADD CONSTRAINT "document_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
