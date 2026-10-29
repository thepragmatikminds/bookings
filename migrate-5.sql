-- Run once on an existing database (D1 console), after migrate-4.sql
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER, ts TEXT DEFAULT CURRENT_TIMESTAMP, label TEXT);
CREATE INDEX IF NOT EXISTS idx_events_b ON events (booking_id);
