-- Migration: Add fetch locking and triggered_by tracking
-- Safe migration: uses IF NOT EXISTS to preserve existing data

-- Add triggered_by column to fetch_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fetch_logs' AND column_name = 'triggered_by'
  ) THEN
    ALTER TABLE fetch_logs ADD COLUMN triggered_by TEXT DEFAULT 'unknown';
  END IF;
END $$;

-- Add image_count column to fetch_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fetch_logs' AND column_name = 'image_count'
  ) THEN
    ALTER TABLE fetch_logs ADD COLUMN image_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create fetch_locks table for distributed locking
CREATE TABLE IF NOT EXISTS fetch_locks (
  lock_name TEXT PRIMARY KEY,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  locked_by TEXT,
  expires_at TIMESTAMP NOT NULL
);

-- Create index for lock expiry cleanup
CREATE INDEX IF NOT EXISTS idx_fetch_locks_expires ON fetch_locks(expires_at);

-- Update fetch_logs index to include triggered_by
CREATE INDEX IF NOT EXISTS idx_fetch_logs_triggered ON fetch_logs(triggered_by);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_started ON fetch_logs(started_at);
