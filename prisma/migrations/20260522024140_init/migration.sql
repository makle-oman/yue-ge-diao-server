-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `openid` VARCHAR(64) NOT NULL,
    `unionid` VARCHAR(64) NULL,
    `phone` VARCHAR(20) NULL,
    `nickname` VARCHAR(32) NULL,
    `avatar` VARCHAR(256) NULL,
    `gender` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `city` VARCHAR(32) NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lng` DECIMAL(9, 6) NULL,
    `geohash` CHAR(8) NULL,
    `fishing_age_band` VARCHAR(16) NULL,
    `play_styles` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `allow_nearby` BOOLEAN NOT NULL DEFAULT true,
    `allow_show_loc` BOOLEAN NOT NULL DEFAULT true,
    `last_active_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_openid`(`openid`),
    INDEX `idx_geohash`(`geohash`),
    INDEX `idx_unionid`(`unionid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spots` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `water_type` VARCHAR(16) NULL,
    `lat` DECIMAL(9, 6) NOT NULL,
    `lng` DECIMAL(9, 6) NOT NULL,
    `geohash` CHAR(8) NOT NULL,
    `address` VARCHAR(128) NULL,
    `city` VARCHAR(32) NULL,
    `creator_id` BIGINT UNSIGNED NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `fish_species` JSON NULL,
    `facilities` JSON NULL,
    `description` TEXT NULL,
    `photos` JSON NULL,
    `avg_rating` DECIMAL(3, 2) NOT NULL DEFAULT 0,
    `rating_count` INTEGER NOT NULL DEFAULT 0,
    `want_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_geohash_status`(`geohash`, `status`),
    INDEX `idx_city_status`(`city`, `status`),
    INDEX `idx_creator`(`creator_id`),
    INDEX `idx_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catches` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `spot_id` BIGINT UNSIGNED NULL,
    `photos` JSON NOT NULL,
    `fish_species` JSON NOT NULL,
    `weight_g` INTEGER UNSIGNED NULL,
    `length_cm` INTEGER UNSIGNED NULL,
    `technique` VARCHAR(16) NULL,
    `bait` VARCHAR(32) NULL,
    `content` TEXT NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lng` DECIMAL(9, 6) NULL,
    `geohash` CHAR(8) NULL,
    `location_visible` BOOLEAN NOT NULL DEFAULT true,
    `allow_comments` BOOLEAN NOT NULL DEFAULT true,
    `weather_snapshot` JSON NULL,
    `like_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `comment_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `fav_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `review_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user_time`(`user_id`, `created_at`),
    INDEX `idx_spot_time`(`spot_id`, `created_at`),
    INDEX `idx_geohash_status`(`geohash`, `review_status`),
    INDEX `idx_feed`(`review_status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `owner_id` BIGINT UNSIGNED NOT NULL,
    `spot_id` BIGINT UNSIGNED NOT NULL,
    `start_time` DATETIME(3) NOT NULL,
    `end_time` DATETIME(3) NOT NULL,
    `target_fish` JSON NULL,
    `max_people` SMALLINT UNSIGNED NOT NULL,
    `cost_mode` VARCHAR(16) NOT NULL,
    `need_carpool` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'recruiting',
    `joined_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_status_start`(`status`, `start_time`),
    INDEX `idx_owner`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_members` (
    `team_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `message` VARCHAR(256) NULL,
    `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,

    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`team_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `ref_type` VARCHAR(16) NULL,
    `ref_id` BIGINT UNSIGNED NULL,
    `actor_id` BIGINT UNSIGNED NULL,
    `payload` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user_unread`(`user_id`, `read_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follows` (
    `follower_id` BIGINT UNSIGNED NOT NULL,
    `followee_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_followee`(`followee_id`),
    PRIMARY KEY (`follower_id`, `followee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catch_likes` (
    `catch_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`catch_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catch_favorites` (
    `catch_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`catch_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spot_wants` (
    `spot_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`spot_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spot_reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `spot_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `rating` TINYINT UNSIGNED NOT NULL,
    `content` TEXT NULL,
    `photos` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_spot_time`(`spot_id`, `created_at`),
    UNIQUE INDEX `uk_spot_user`(`spot_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catch_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `parent_id` BIGINT UNSIGNED NULL,
    `content` TEXT NOT NULL,
    `like_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_catch_time`(`catch_id`, `created_at`),
    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comment_likes` (
    `comment_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_user`(`user_id`),
    PRIMARY KEY (`comment_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `from_id` BIGINT UNSIGNED NOT NULL,
    `to_id` BIGINT UNSIGNED NOT NULL,
    `content` TEXT NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'text',
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_pair_time`(`from_id`, `to_id`, `created_at`),
    INDEX `idx_to_unread`(`to_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fishes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name_cn` VARCHAR(32) NOT NULL,
    `name_latin` VARCHAR(64) NULL,
    `category` VARCHAR(16) NULL,
    `waters` JSON NULL,
    `icon` VARCHAR(256) NULL,
    `common` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_name_cn`(`name_cn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_fish_records` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `fish_id` BIGINT UNSIGNED NOT NULL,
    `first_catch_at` DATETIME(3) NOT NULL,
    `max_weight_g` INTEGER UNSIGNED NULL,

    INDEX `idx_fish`(`fish_id`),
    PRIMARY KEY (`user_id`, `fish_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_reviews` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` BIGINT UNSIGNED NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `raw` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_target`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `spots` ADD CONSTRAINT `spots_creator_id_fkey` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catches` ADD CONSTRAINT `catches_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catches` ADD CONSTRAINT `catches_spot_id_fkey` FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_spot_id_fkey` FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_follower_id_fkey` FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_followee_id_fkey` FOREIGN KEY (`followee_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catch_likes` ADD CONSTRAINT `catch_likes_catch_id_fkey` FOREIGN KEY (`catch_id`) REFERENCES `catches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catch_likes` ADD CONSTRAINT `catch_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catch_favorites` ADD CONSTRAINT `catch_favorites_catch_id_fkey` FOREIGN KEY (`catch_id`) REFERENCES `catches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catch_favorites` ADD CONSTRAINT `catch_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `spot_wants` ADD CONSTRAINT `spot_wants_spot_id_fkey` FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `spot_wants` ADD CONSTRAINT `spot_wants_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `spot_reviews` ADD CONSTRAINT `spot_reviews_spot_id_fkey` FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `spot_reviews` ADD CONSTRAINT `spot_reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_catch_id_fkey` FOREIGN KEY (`catch_id`) REFERENCES `catches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comment_likes` ADD CONSTRAINT `comment_likes_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comment_likes` ADD CONSTRAINT `comment_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_from_id_fkey` FOREIGN KEY (`from_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_to_id_fkey` FOREIGN KEY (`to_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_fish_records` ADD CONSTRAINT `user_fish_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_fish_records` ADD CONSTRAINT `user_fish_records_fish_id_fkey` FOREIGN KEY (`fish_id`) REFERENCES `fishes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
