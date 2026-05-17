-- =============================================
-- Migration 002: Add username field to profiles
-- =============================================

-- Add username column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text;

-- Create unique index on username (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON profiles (lower(username))
  WHERE username IS NOT NULL;

-- RPC function: look up email by username (callable without auth, for login)
CREATE OR REPLACE FUNCTION get_email_by_username(p_username text)
RETURNS text AS $$
  SELECT email
  FROM profiles
  WHERE lower(username) = lower(p_username)
    AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Grant execute to anonymous users (needed for pre-auth lookup)
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO anon;
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO authenticated;
