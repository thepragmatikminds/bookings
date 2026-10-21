CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL, phone TEXT DEFAULT '', service TEXT NOT NULL,
  date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, time);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO settings VALUES ('business_name', 'Nthawi''s Furniture');
INSERT OR IGNORE INTO settings VALUES ('services', 'Showroom visit,Measurement visit,Delivery,Repair');
