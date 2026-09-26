-- CreateTable
CREATE TABLE "external_import_links" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "cooperation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_import_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_import_links_cooperation_id_idx" ON "external_import_links"("cooperation_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_import_links_source_external_id_key" ON "external_import_links"("source", "external_id");

-- AddForeignKey
ALTER TABLE "external_import_links" ADD CONSTRAINT "external_import_links_cooperation_id_fkey" FOREIGN KEY ("cooperation_id") REFERENCES "cooperations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
