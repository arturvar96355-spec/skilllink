-- Вендоры, курсы ИТ-Школы, потоки и заказы с сайта (решение 122).
--
-- vendors — компании-вендоры продуктов; it_products.vendor_id — необязательная связь
-- (продукты до решения 131 остаются без вендора, обратная совместимость).
-- vendor_contacts — деловые контакты вендоров (ФИО, рабочие почта и телефон, каналы связи,
-- основание обработки — по умолчанию законный интерес, как у контактов вузов, решение 111).
-- school_courses, course_streams — курсы ИТ-Школы на сайте и их потоки.
-- site_orders — заказы с сайта БЕЗ персональных данных слушателя: номер заявки, курс,
-- поток, дата из номера и HMAC-SHA256 от нормализованных почты и телефона (ключ
-- ORDERS_HMAC_KEY вне базы). ФИО, телефон и почта в базу не попадают.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную; вендоры, контакты вендоров,
-- курсы, потоки и заказы теряются, сами продукты остаются):
--   DROP TABLE "site_orders"; DROP TABLE "course_streams"; DROP TABLE "school_courses";
--   DROP TABLE "vendor_contact_products"; DROP TABLE "vendor_contacts";
--   ALTER TABLE "it_products" DROP COLUMN "vendor_id";
--   DROP TABLE "vendors"; DROP TYPE "VendorContactChannel";

-- CreateEnum
CREATE TYPE "VendorContactChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'PHONE');

-- AlterTable
ALTER TABLE "it_products" ADD COLUMN     "vendor_id" TEXT;

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contacts" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferred_channels" "VendorContactChannel"[],
    "legal_basis" "ContactLegalBasis" NOT NULL DEFAULT 'LEGITIMATE_INTEREST',
    "basis_reference" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contact_products" (
    "contact_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "vendor_contact_products_pkey" PRIMARY KEY ("contact_id","product_id")
);

-- CreateTable
CREATE TABLE "school_courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_streams" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "stream_id" TEXT,
    "email_hash" TEXT,
    "phone_hash" TEXT,
    "ordered_at" TIMESTAMP(3),
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_batch_id" TEXT NOT NULL,
    "imported_by_id" TEXT,
    "lms_exported_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "site_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key_key" ON "vendors"("name_key");

-- CreateIndex
CREATE INDEX "vendor_contacts_vendor_id_idx" ON "vendor_contacts"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_contact_products_product_id_idx" ON "vendor_contact_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_courses_name_key_key" ON "school_courses"("name_key");

-- CreateIndex
CREATE INDEX "school_courses_product_id_idx" ON "school_courses"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_streams_course_id_number_key" ON "course_streams"("course_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "site_orders_order_no_key" ON "site_orders"("order_no");

-- CreateIndex
CREATE INDEX "site_orders_course_id_idx" ON "site_orders"("course_id");

-- CreateIndex
CREATE INDEX "site_orders_stream_id_idx" ON "site_orders"("stream_id");

-- CreateIndex
CREATE INDEX "site_orders_email_hash_idx" ON "site_orders"("email_hash");

-- CreateIndex
CREATE INDEX "site_orders_phone_hash_idx" ON "site_orders"("phone_hash");

-- CreateIndex
CREATE INDEX "site_orders_import_batch_id_idx" ON "site_orders"("import_batch_id");

-- CreateIndex
CREATE INDEX "site_orders_imported_by_id_idx" ON "site_orders"("imported_by_id");

-- CreateIndex
CREATE INDEX "it_products_vendor_id_idx" ON "it_products"("vendor_id");

-- AddForeignKey
ALTER TABLE "it_products" ADD CONSTRAINT "it_products_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contact_products" ADD CONSTRAINT "vendor_contact_products_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "vendor_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contact_products" ADD CONSTRAINT "vendor_contact_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "it_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_courses" ADD CONSTRAINT "school_courses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "it_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_streams" ADD CONSTRAINT "course_streams_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "school_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_orders" ADD CONSTRAINT "site_orders_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "school_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_orders" ADD CONSTRAINT "site_orders_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "course_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_orders" ADD CONSTRAINT "site_orders_imported_by_id_fkey" FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Русская сортировка названий в списках (как у остальных справочников, миграция russian_collation).
ALTER TABLE "vendors"
  ALTER COLUMN "name" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "school_courses"
  ALTER COLUMN "name" TYPE TEXT COLLATE "ru-x-icu";

ALTER TABLE "vendor_contacts"
  ALTER COLUMN "full_name" TYPE TEXT COLLATE "ru-x-icu";

-- Ключ названия не пустой: пустой ключ склеил бы все «безымянные» записи в одну.
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_name_key_check" CHECK ("name_key" <> '');
ALTER TABLE "school_courses" ADD CONSTRAINT "school_courses_name_key_check" CHECK ("name_key" <> '');

-- Телефон делового контакта — только +7XXXXXXXXXX, почта — только в нижнем регистре:
-- так их записывает загрузка, и запись в обход неё не разойдётся с правилом.
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_phone_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+7[0-9]{10}$');
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_email_check"
  CHECK ("email" IS NULL OR "email" = lower("email"));

-- Номер потока — положительный.
ALTER TABLE "course_streams" ADD CONSTRAINT "course_streams_number_check"
  CHECK ("number" BETWEEN 1 AND 10000);

-- В заказе только хеши: 64 шестнадцатеричных знака (HMAC-SHA256), хотя бы один задан.
-- Почта или телефон открытым текстом в эти колонки не лягут — формат не тот.
ALTER TABLE "site_orders" ADD CONSTRAINT "site_orders_contact_hash_check"
  CHECK (
    ("email_hash" IS NOT NULL OR "phone_hash" IS NOT NULL)
    AND ("email_hash" IS NULL OR "email_hash" ~ '^[0-9a-f]{64}$')
    AND ("phone_hash" IS NULL OR "phone_hash" ~ '^[0-9a-f]{64}$')
  );
