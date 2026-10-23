-- Run once on an existing database (D1 console), after migrate-1.sql
ALTER TABLE bookings ADD COLUMN assigned TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN photo TEXT DEFAULT '';
