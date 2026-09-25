-- Привязка пользователя к личному чату Telegram (решение 102).
-- Новая таблица, существующие не меняются. Откат (данных других таблиц не касается):
--   DROP TABLE "telegram_links";
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "username" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- Уникальные индексы — они же индексы под оба запроса: «привязка пользователя»
-- (профиль, рассылка) и «чей это чат» (команды бота).
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");

ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
