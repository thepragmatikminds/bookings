-- Run once on an existing database (D1 console)
ALTER TABLE bookings ADD COLUMN address TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN amount TEXT DEFAULT '';
