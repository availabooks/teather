-- The student's Google name and profile photo URL, refreshed at most once a day.
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN picture TEXT;
ALTER TABLE users ADD COLUMN profile_checked INTEGER;
