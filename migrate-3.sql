-- Run once on an existing database (D1 console), after migrate-2.sql. Run each line separately if the console asks.
ALTER TABLE bookings ADD COLUMN price REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN paid REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN source TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN confirmed_at TEXT DEFAULT '';
CREATE TABLE IF NOT EXISTS visits (day TEXT, source TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (day, source));
