-- Run once on an existing database (D1 console), after migrate-5.sql
ALTER TABLE bookings ADD COLUMN items TEXT DEFAULT '';
