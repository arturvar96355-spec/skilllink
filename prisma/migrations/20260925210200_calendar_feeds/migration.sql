-- Подписка на календарь сроков и встреч (.ics, решение 105).
-- Одна строка на пользователя: хеш SHA-256 токена личной ссылки. Сам токен
-- в базе не хранится. Перевыпуск заменяет хеш, отзыв удаляет строку, удаление
-- пользователя удаляет и подписку.
--
-- Откат (Prisma down-миграций не пишет — выполнить вручную, данные подписок
-- теряются, пользователям придётся выпустить ссылки заново):
--   DROP TABLE "calendar_feeds";
--   DROP INDEX "meeting_participants_user_id_idx";
--   DROP INDEX "meetings_responsible_id_idx";

-- CreateTable
CREATE TABLE "calendar_feeds" (
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("user_id"),
    -- Хеш, а не токен: 64 шестнадцатеричных знака. Запись самого токена
    -- по ошибке база не примет.
    CONSTRAINT "calendar_feeds_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_hash_key" ON "calendar_feeds"("token_hash");

-- Лента календаря выбирает встречи, где сотрудник ответственный или участник.
-- CreateIndex

-- CreateIndex

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
