-- New accounts use the complete 3–24 character username as their default name.
-- Existing identities, custom callsigns and progression remain unchanged.
ALTER TABLE accounts ALTER COLUMN callsign TYPE VARCHAR(24);
