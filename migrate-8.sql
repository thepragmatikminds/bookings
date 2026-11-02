-- Run once on an existing database (D1 console), after migrate-7.sql
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER, ts TEXT DEFAULT CURRENT_TIMESTAMP, amount REAL DEFAULT 0, kind TEXT DEFAULT 'deposit', note TEXT DEFAULT '', proof TEXT DEFAULT '', status TEXT DEFAULT 'pending');
CREATE INDEX IF NOT EXISTS idx_payments_b ON payments (booking_id);
