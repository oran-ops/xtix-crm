-- ============================================================
-- MIGRATION: הוספת עמודות חסרות + עדכון status CHECK
-- הרץ ב-Supabase SQL Editor
-- ============================================================

-- 1. הוסף עמודות tracking חדשות
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS analysis_completed_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS post_analysis_emailed  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_contacted_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notes                  TEXT        DEFAULT '';

-- 2. עדכן status CHECK — הוסף כל הסטטוסים החדשים
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN (
    'new', 'contacted', 'followup', 'meeting', 'negotiation',
    'won', 'lost', 'ghosted', 'not_relevant',
    'future_potential', 'referred_us',
    'closed', 'closed_won', 'closed_lost'  -- legacy
  ));

-- 3. וידוא
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leads'
  AND column_name IN ('analysis_completed_at','post_analysis_emailed','last_contacted_at','notes','status')
ORDER BY column_name;
