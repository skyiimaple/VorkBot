-- A user cannot own two Bots whose names differ only by letter case.

CREATE UNIQUE INDEX IF NOT EXISTS bots_user_name_lower_unique
  ON bots (user_id, lower(name));
