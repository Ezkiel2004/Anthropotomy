-- Structure only. No demo accounts or learning records.
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS `announcements` (
  `announcement_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `teacher_id` int(10) unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `category` enum('general','lesson','quiz','urgent','event') NOT NULL DEFAULT 'general',
  `audience` varchar(200) NOT NULL DEFAULT 'all',
  `is_pinned` tinyint(1) NOT NULL DEFAULT 0,
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`announcement_id`),
  KEY `teacher_id` (`teacher_id`),
  KEY `idx_pinned` (`is_pinned`),
  CONSTRAINT `announcements_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `answer_options` (
  `option_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `question_id` int(10) unsigned NOT NULL,
  `option_text` varchar(500) NOT NULL,
  `is_correct` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`option_id`),
  KEY `question_id` (`question_id`),
  CONSTRAINT `answer_options_ibfk_1` FOREIGN KEY (`question_id`) REFERENCES `questions` (`question_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `answer_responses` (
  `response_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `submission_id` int(10) unsigned NOT NULL,
  `question_id` int(10) unsigned NOT NULL,
  `selected_option` int(10) unsigned DEFAULT NULL,
  `response_text` text DEFAULT NULL,
  `hotspot_clicked` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Clicked area id for hotspot questions' CHECK (json_valid(`hotspot_clicked`)),
  `is_correct` tinyint(1) DEFAULT NULL,
  `points_earned` decimal(5,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`response_id`),
  KEY `submission_id` (`submission_id`),
  KEY `question_id` (`question_id`),
  CONSTRAINT `answer_responses_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `assessment_submissions` (`submission_id`) ON DELETE CASCADE,
  CONSTRAINT `answer_responses_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `questions` (`question_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `assessment_submissions` (
  `submission_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` int(10) unsigned NOT NULL,
  `assessment_id` int(10) unsigned NOT NULL,
  `attempt_number` int(10) unsigned NOT NULL DEFAULT 1,
  `score` decimal(5,2) DEFAULT NULL,
  `raw_score` decimal(7,2) DEFAULT NULL,
  `max_score` decimal(7,2) DEFAULT NULL,
  `time_taken_secs` int(10) unsigned DEFAULT NULL,
  `status` enum('in_progress','submitted','graded','returned') NOT NULL DEFAULT 'in_progress',
  `teacher_feedback` text DEFAULT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `submitted_at` timestamp NULL DEFAULT NULL,
  `graded_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`submission_id`),
  KEY `idx_student` (`student_id`),
  KEY `idx_assessment` (`assessment_id`),
  CONSTRAINT `assessment_submissions_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `assessment_submissions_ibfk_2` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`assessment_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `assessments` (
  `assessment_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `teacher_id` int(10) unsigned NOT NULL,
  `system_id` int(10) unsigned DEFAULT NULL,
  `module_id` int(10) unsigned DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `assessment_type` enum('quiz','identification','diagram','exploration','mixed') NOT NULL DEFAULT 'quiz',
  `instructions` text DEFAULT NULL,
  `time_limit_mins` int(11) DEFAULT NULL,
  `passing_score` decimal(5,2) NOT NULL DEFAULT 75.00,
  `max_attempts` int(11) NOT NULL DEFAULT 3,
  `status` enum('draft','scheduled','active','closed') NOT NULL DEFAULT 'draft',
  `due_date` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`assessment_id`),
  KEY `system_id` (`system_id`),
  KEY `module_id` (`module_id`),
  KEY `idx_status` (`status`),
  KEY `idx_teacher` (`teacher_id`),
  CONSTRAINT `assessments_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `assessments_ibfk_2` FOREIGN KEY (`system_id`) REFERENCES `body_systems` (`system_id`) ON DELETE SET NULL,
  CONSTRAINT `assessments_ibfk_3` FOREIGN KEY (`module_id`) REFERENCES `modules` (`module_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `body_systems` (
  `system_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `system_code` varchar(30) NOT NULL,
  `system_name` varchar(100) NOT NULL,
  `icon_emoji` varchar(10) DEFAULT NULL,
  `color_hex` varchar(10) DEFAULT '#3b82f6',
  `description` text DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`system_id`),
  UNIQUE KEY `system_code` (`system_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `lessons` (
  `lesson_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `module_id` int(10) unsigned NOT NULL,
  `teacher_id` int(10) unsigned NOT NULL,
  `title` varchar(200) NOT NULL,
  `lesson_type` enum('reading','video','3d_model','interactive','quiz_prep') NOT NULL DEFAULT 'reading',
  `content_text` longtext DEFAULT NULL,
  `media_url` varchar(255) DEFAULT NULL,
  `duration_mins` int(11) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`lesson_id`),
  KEY `teacher_id` (`teacher_id`),
  KEY `idx_module` (`module_id`),
  CONSTRAINT `lessons_ibfk_1` FOREIGN KEY (`module_id`) REFERENCES `modules` (`module_id`) ON DELETE CASCADE,
  CONSTRAINT `lessons_ibfk_2` FOREIGN KEY (`teacher_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `media_files` (
  `media_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `uploader_id` int(10) unsigned NOT NULL,
  `system_id` int(10) unsigned DEFAULT NULL,
  `file_name` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `file_type` enum('image','video','model_3d','pdf','audio') NOT NULL,
  `file_size_kb` int(10) unsigned NOT NULL DEFAULT 0,
  `file_path` varchar(500) NOT NULL,
  `thumbnail_url` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `tags` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`media_id`),
  KEY `uploader_id` (`uploader_id`),
  KEY `system_id` (`system_id`),
  CONSTRAINT `media_files_ibfk_1` FOREIGN KEY (`uploader_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `media_files_ibfk_2` FOREIGN KEY (`system_id`) REFERENCES `body_systems` (`system_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `modules` (
  `module_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `system_id` int(10) unsigned NOT NULL,
  `teacher_id` int(10) unsigned NOT NULL,
  `title` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `thumbnail_url` varchar(255) DEFAULT NULL,
  `status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `published_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`module_id`),
  KEY `teacher_id` (`teacher_id`),
  KEY `idx_system` (`system_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `modules_ibfk_1` FOREIGN KEY (`system_id`) REFERENCES `body_systems` (`system_id`),
  CONSTRAINT `modules_ibfk_2` FOREIGN KEY (`teacher_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `token_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `token_hash` varchar(64) NOT NULL COMMENT 'SHA-256 hash of the raw token',
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`token_id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_token` (`token_hash`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `password_reset_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `questions` (
  `question_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `assessment_id` int(10) unsigned NOT NULL,
  `question_text` text NOT NULL,
  `question_type` enum('multiple_choice','true_false','identification','fill_blank','drag_drop','hotspot','interactive') NOT NULL DEFAULT 'multiple_choice',
  `image_url` varchar(255) DEFAULT NULL,
  `hotspot_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Clickable areas for hotspot type: [{id, x, y, w, h, label}]' CHECK (json_valid(`hotspot_data`)),
  `points` decimal(5,2) NOT NULL DEFAULT 1.00,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`question_id`),
  KEY `idx_assessment` (`assessment_id`),
  CONSTRAINT `questions_ibfk_1` FOREIGN KEY (`assessment_id`) REFERENCES `assessments` (`assessment_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `student_lesson_progress` (
  `progress_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `status` enum('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
  `completion_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `time_spent_secs` int(10) unsigned NOT NULL DEFAULT 0,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`progress_id`),
  UNIQUE KEY `uq_student_lesson` (`student_id`,`lesson_id`),
  KEY `lesson_id` (`lesson_id`),
  CONSTRAINT `student_lesson_progress_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `student_lesson_progress_ibfk_2` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`lesson_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `student_profiles` (
  `profile_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `student_id` varchar(20) NOT NULL,
  `section` varchar(60) NOT NULL,
  `grade_level` varchar(20) NOT NULL DEFAULT '',
  `birth_date` date DEFAULT NULL,
  `guardian_name` varchar(120) DEFAULT NULL,
  `contact_no` varchar(20) DEFAULT NULL,
  `school_year` varchar(20) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`profile_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `student_id` (`student_id`),
  CONSTRAINT `student_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `student_progress_summary` (
  `summary_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` int(10) unsigned NOT NULL,
  `total_lessons` int(10) unsigned NOT NULL DEFAULT 0,
  `completed_lessons` int(10) unsigned NOT NULL DEFAULT 0,
  `avg_quiz_score` decimal(5,2) DEFAULT NULL,
  `quizzes_taken` int(10) unsigned NOT NULL DEFAULT 0,
  `quizzes_passed` int(10) unsigned NOT NULL DEFAULT 0,
  `systems_explored` int(10) unsigned NOT NULL DEFAULT 0,
  `total_time_hours` decimal(8,2) NOT NULL DEFAULT 0.00,
  `class_rank` int(10) unsigned DEFAULT NULL,
  `last_updated` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`summary_id`),
  UNIQUE KEY `student_id` (`student_id`),
  CONSTRAINT `student_progress_summary_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `system_exploration_log` (
  `log_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` int(10) unsigned NOT NULL,
  `system_id` int(10) unsigned NOT NULL,
  `session_start` timestamp NOT NULL DEFAULT current_timestamp(),
  `session_end` timestamp NULL DEFAULT NULL,
  `duration_secs` int(10) unsigned DEFAULT NULL,
  `interactions` int(10) unsigned NOT NULL DEFAULT 0,
  `structures_viewed` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`structures_viewed`)),
  PRIMARY KEY (`log_id`),
  KEY `system_id` (`system_id`),
  KEY `idx_student` (`student_id`),
  CONSTRAINT `system_exploration_log_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `system_exploration_log_ibfk_2` FOREIGN KEY (`system_id`) REFERENCES `body_systems` (`system_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `teacher_profiles` (
  `profile_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `teacher_id` varchar(20) NOT NULL,
  `subject` varchar(100) NOT NULL DEFAULT 'Science',
  `department` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`profile_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `teacher_id` (`teacher_id`),
  CONSTRAINT `teacher_profiles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `announcement_reads` (
  `read_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `announcement_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `read_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`read_id`),
  UNIQUE KEY `uq_ann_user` (`announcement_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `announcement_reads_ibfk_1` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`announcement_id`) ON DELETE CASCADE,
  CONSTRAINT `announcement_reads_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `user_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('student','teacher','admin') NOT NULL DEFAULT 'student',
  `full_name` varchar(120) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `profile_pic` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_login` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
SET FOREIGN_KEY_CHECKS=1;
