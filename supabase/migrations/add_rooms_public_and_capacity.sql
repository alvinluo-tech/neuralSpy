ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 6;

ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_max_players_range;

ALTER TABLE public.rooms
ADD CONSTRAINT rooms_max_players_range CHECK (max_players >= 3 AND max_players <= 12);

CREATE INDEX IF NOT EXISTS idx_rooms_public_status_created_at
ON public.rooms (is_public, status, created_at DESC);
