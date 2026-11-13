-- Demo accounts for local testing only. Do not load on a production database.
-- Logins (username / password):
--   demostudent / demo1234   (student, section "Demo Section")
--   demoteacher / demo1234   (admin: the teacher account also has admin rights)
-- Safe to re-run: existing demo accounts are updated, not duplicated.

INSERT INTO users (username, password_hash, role, full_name, is_active)
VALUES
  ('demostudent', '$2y$12$wG1adY2udF6zeQ2toRfWbuJK7slFF1noq6cZpWiZjWjQreiyVdyS.', 'student', 'Demo Student', 1),
  ('demoteacher', '$2y$12$wG1adY2udF6zeQ2toRfWbuJK7slFF1noq6cZpWiZjWjQreiyVdyS.', 'admin',   'Demo Teacher', 1)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  role          = VALUES(role),
  full_name     = VALUES(full_name),
  is_active     = 1;

INSERT INTO student_profiles (user_id, student_id, section, grade_level, school_year)
SELECT user_id, 'DEMO-S001', 'Demo Section', 'Grade 11', '2026-2027'
FROM users WHERE username = 'demostudent'
ON DUPLICATE KEY UPDATE
  section     = VALUES(section),
  grade_level = VALUES(grade_level),
  school_year = VALUES(school_year);

INSERT INTO teacher_profiles (user_id, teacher_id, subject)
SELECT user_id, 'DEMO-T001', 'Science'
FROM users WHERE username = 'demoteacher'
ON DUPLICATE KEY UPDATE
  subject = VALUES(subject);

-- Remove the old separate admin account, if an earlier version of this seed created it.
DELETE FROM users WHERE username = 'demoadmin';
