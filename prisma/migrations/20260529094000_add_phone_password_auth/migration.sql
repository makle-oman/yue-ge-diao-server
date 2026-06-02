-- AlterTable
ALTER TABLE `users` ADD COLUMN `password_hash` VARCHAR(255) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `uk_phone` ON `users`(`phone`);
