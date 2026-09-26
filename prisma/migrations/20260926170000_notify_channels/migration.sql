-- CreateEnum
CREATE TYPE "NotifyChannelKind" AS ENUM ('TELEGRAM', 'MAX', 'VK');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_channel" "NotifyChannelKind";

-- CreateTable
CREATE TABLE "notification_channel_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "NotifyChannelKind" NOT NULL,
    "chat_ref" TEXT NOT NULL,
    "username" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channel_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_updates_seen" (
    "channel" "NotifyChannelKind" NOT NULL,
    "update_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_updates_seen_pkey" PRIMARY KEY ("channel","update_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_links_user_id_channel_key" ON "notification_channel_links"("user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_links_channel_chat_ref_key" ON "notification_channel_links"("channel", "chat_ref");

-- CreateIndex
CREATE INDEX "channel_updates_seen_seen_at_idx" ON "channel_updates_seen"("seen_at");

-- AddForeignKey
ALTER TABLE "notification_channel_links" ADD CONSTRAINT "notification_channel_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
