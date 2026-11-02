-- Run once on an existing database (D1 console), after migrate-6.sql
ALTER TABLE bookings ADD COLUMN due_date TEXT DEFAULT '';
