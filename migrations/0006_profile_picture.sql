-- Profile picture comes only from a verified Google ID token.
ALTER TABLE users ADD COLUMN picture TEXT;
