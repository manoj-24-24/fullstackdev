-- FullstackDev platform — MySQL 8 schema
-- Executed automatically by server/db.js on boot (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  reset_token VARCHAR(255) NULL,
  reset_expires DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL DEFAULT '',
  username VARCHAR(255) NOT NULL DEFAULT '',
  avatar VARCHAR(1000) NULL,
  bio TEXT NULL,
  github_url VARCHAR(1000) NULL,
  linkedin_url VARCHAR(1000) NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_profiles_username (username),
  CONSTRAINT fk_profiles_user FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contributions (
  id CHAR(36) PRIMARY KEY,
  student_id CHAR(36) NOT NULL,
  subject_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  description MEDIUMTEXT NULL,
  code MEDIUMTEXT NULL,
  github_url VARCHAR(1000) NULL,
  contribution_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  score DECIMAL(5,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_contributions_student (student_id),
  KEY idx_contributions_subject (subject_id),
  KEY idx_contributions_date (contribution_date),
  CONSTRAINT fk_contributions_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contribution_files (
  id CHAR(36) PRIMARY KEY,
  contribution_id CHAR(36) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_files_contribution (contribution_id),
  CONSTRAINT fk_files_contribution FOREIGN KEY (contribution_id) REFERENCES contributions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feedback (
  id CHAR(36) PRIMARY KEY,
  contribution_id CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  reviewer_name VARCHAR(255) NULL,
  reviewer_role VARCHAR(20) NULL,
  feedback TEXT NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_feedback_contribution (contribution_id),
  KEY idx_feedback_teacher (teacher_id),
  CONSTRAINT fk_feedback_contribution FOREIGN KEY (contribution_id) REFERENCES contributions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_activity (
  id CHAR(36) PRIMARY KEY,
  student_id CHAR(36) NOT NULL,
  activity_date DATE NOT NULL,
  contribution_count INT NOT NULL DEFAULT 0,
  daily_score DECIMAL(7,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_activity_student_date (student_id, activity_date),
  KEY idx_activity_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NULL,
  sender_name VARCHAR(200) NULL,
  sender_role VARCHAR(20) NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'info',
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (user_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS study_notes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  category VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notes_user (user_id),
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scoring_rules (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  action VARCHAR(255) NOT NULL,
  target_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin-authored learning notes: subject-tagged, visible to everyone, no approval.
CREATE TABLE IF NOT EXISTS admin_notes (
  id CHAR(36) PRIMARY KEY,
  author_id CHAR(36) NOT NULL,
  subject_id CHAR(36) NULL,
  title VARCHAR(500) NOT NULL,
  summary VARCHAR(1000) NULL,
  description MEDIUMTEXT NULL,
  code MEDIUMTEXT NULL,
  file_path VARCHAR(1000) NULL,
  file_name VARCHAR(500) NULL,
  file_type VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_admin_notes_subject (subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comments students and teachers leave on an admin note (open to all roles).
CREATE TABLE IF NOT EXISTS note_feedback (
  id CHAR(36) PRIMARY KEY,
  note_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  reviewer_name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NULL,
  feedback TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_note_feedback_note (note_id),
  CONSTRAINT fk_note_feedback_note FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_note_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;