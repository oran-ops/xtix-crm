-- ============================================================
--  ANDY Brain v2.0 — Full Migration SQL
--  יום 1: כל הטבלאות החסרות + Auth + KB
--  הרץ ב-SQL Editor של Supabase
-- ============================================================

-- ============================================================
-- TABLE: users (מחליף Firebase Auth + pending_users)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT DEFAULT '',
  photo       TEXT DEFAULT '',
  role        TEXT DEFAULT 'viewer' CHECK (role IN ('admin','sales','viewer')),
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','pending','disabled')),
  invited_by  TEXT DEFAULT '',
  invited_at  TIMESTAMPTZ,
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: knowledge_base (מחליף Firebase knowledge_base)
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_base (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL DEFAULT '',
  type         TEXT DEFAULT 'article' CHECK (type IN ('article','github','file','url','text','methodology')),
  url          TEXT DEFAULT '',
  content      TEXT DEFAULT '',
  summary      TEXT DEFAULT '',
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','ready','error','processing')),
  tags         TEXT[] DEFAULT '{}',
  embedding    vector(1536),
  word_count   INTEGER DEFAULT 0,
  refreshed_at TIMESTAMPTZ,
  added_by     TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for KB vector search
CREATE INDEX IF NOT EXISTS kb_embedding_idx
  ON knowledge_base USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ============================================================
-- TABLE: reminders (מחליף Firebase reminders)
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     TEXT DEFAULT '',
  lead_name   TEXT DEFAULT '',
  date        DATE NOT NULL,
  note        TEXT DEFAULT '',
  done        BOOLEAN DEFAULT FALSE,
  created_by  TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: app_settings (מחליף Firebase settings)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT UNIQUE NOT NULL,
  value        JSONB NOT NULL DEFAULT '{}',
  updated_by   TEXT DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Insert defaults
INSERT INTO app_settings (key, value) VALUES
  ('config', '{"sender_name":"XTIX Sales","theme":"dark"}'),
  ('meta',   '{"nextId": 100}')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TABLE: emails_sent (מחליף Firebase emails_sent)
-- ============================================================
CREATE TABLE IF NOT EXISTS emails_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     TEXT DEFAULT '',
  lead_name   TEXT DEFAULT '',
  to_email    TEXT DEFAULT '',
  subject     TEXT DEFAULT '',
  body        TEXT DEFAULT '',
  status      TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed','opened','replied')),
  sent_by     TEXT DEFAULT '',
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: activities (מחליף Firebase activities)
-- ============================================================
CREATE TABLE IF NOT EXISTS activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT DEFAULT '',
  description TEXT DEFAULT '',
  lead_id     TEXT DEFAULT '',
  lead_name   TEXT DEFAULT '',
  user_email  TEXT DEFAULT '',
  meta        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: competitors (מחליף Firebase competitors)
-- ============================================================
CREATE TABLE IF NOT EXISTS competitors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  strengths   TEXT[] DEFAULT '{}',
  weaknesses  TEXT[] DEFAULT '{}',
  counter     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed competitors
INSERT INTO competitors (id, name, description, counter) VALUES
  ('smarticket', 'SmarTicket', 'פלטפורמה ישראלית מובילה', 'עמלה גבוהה יותר, ממשק מיושן'),
  ('eventbrite', 'Eventbrite', 'פלטפורמה בינלאומית', 'אין תמיכה בעברית, יקר'),
  ('billeto', 'Billeto', 'פלטפורמה ישראלית חדשה', 'קטנה, מעט לקוחות'),
  ('bimot', 'Bimot', 'כרטיסים לאירועי ספורט', 'ספציפי לספורט בלבד')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABLE: methodology (מחליף Firebase methodology)
-- ============================================================
CREATE TABLE IF NOT EXISTS methodology (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT DEFAULT '',
  category    TEXT DEFAULT 'general',
  order_idx   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: email_cadences (מחליף Firebase email_cadences)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_cadences (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cadence     TEXT DEFAULT 'warm' CHECK (cadence IN ('hot','warm','cool')),
  steps       JSONB DEFAULT '[]',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: ai_decisions (מחליף Firebase ai_decisions)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            TEXT DEFAULT '',
  lead_name          TEXT DEFAULT '',
  meta_score         INTEGER DEFAULT 0,
  recommended_cadence TEXT DEFAULT 'cool',
  platform           TEXT DEFAULT '',
  segment            TEXT DEFAULT '',
  outcome            TEXT,
  analysis           JSONB DEFAULT '{}',
  engine             TEXT DEFAULT 'claude',
  timestamp          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: brain_insights (מחליף Firebase brain_insights)
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_insights (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_latest               BOOLEAN DEFAULT FALSE,
  sales_methodology_summary TEXT DEFAULT '',
  winning_patterns        TEXT[] DEFAULT '{}',
  losing_patterns         TEXT[] DEFAULT '{}',
  score_calibration       TEXT DEFAULT '',
  cadence_rules           JSONB DEFAULT '{}',
  tone_guidelines         TEXT DEFAULT '',
  key_objections          TEXT[] DEFAULT '{}',
  meta_judge_instructions TEXT DEFAULT '',
  platform_intelligence   JSONB DEFAULT '{}',
  kb_sources_count        INTEGER DEFAULT 0,
  decisions_analyzed      INTEGER DEFAULT 0,
  generated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Only one latest at a time
CREATE UNIQUE INDEX IF NOT EXISTS brain_insights_latest_idx
  ON brain_insights (is_latest) WHERE is_latest = TRUE;

-- ============================================================
-- FUNCTION: match_knowledge_base (KB semantic search)
-- ============================================================
CREATE OR REPLACE FUNCTION match_knowledge_base(
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.70,
  match_count     INT   DEFAULT 5
)
RETURNS TABLE (
  id         UUID,
  title      TEXT,
  content    TEXT,
  type       TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.title,
    kb.content,
    kb.type,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE
    kb.status = 'ready'
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails_sent        ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE methodology        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_cadences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_insights     ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS
CREATE POLICY "service_all" ON users              FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON knowledge_base     FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON reminders          FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON app_settings       FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON emails_sent        FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON activities         FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON competitors        FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON methodology        FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON email_cadences     FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON ai_decisions       FOR ALL USING (TRUE);
CREATE POLICY "service_all" ON brain_insights     FOR ALL USING (TRUE);

-- Authenticated users can read most tables
CREATE POLICY "auth_read" ON knowledge_base     FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON competitors        FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON methodology        FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON email_cadences     FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON brain_insights     FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_read" ON reminders          FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS kb_status_idx       ON knowledge_base (status);
CREATE INDEX IF NOT EXISTS kb_type_idx         ON knowledge_base (type);
CREATE INDEX IF NOT EXISTS reminders_date_idx  ON reminders (date);
CREATE INDEX IF NOT EXISTS reminders_done_idx  ON reminders (done);
CREATE INDEX IF NOT EXISTS activities_type_idx ON activities (type);
CREATE INDEX IF NOT EXISTS activities_time_idx ON activities (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_dec_lead_idx     ON ai_decisions (lead_id);
CREATE INDEX IF NOT EXISTS ai_dec_time_idx     ON ai_decisions (timestamp DESC);
CREATE INDEX IF NOT EXISTS brain_latest_idx    ON brain_insights (generated_at DESC);

-- ============================================================
-- AUTO-HANDLE new Supabase Auth users
-- Creates a record in public.users when someone signs up
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, photo, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    'viewer',   -- default role — admin upgrades manually
    'pending'   -- pending until admin approves
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- DONE ✅
-- ============================================================
SELECT
  'Migration 002 — Full Schema installed! 🚀' AS message,
  COUNT(*) AS total_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'users','knowledge_base','reminders','app_settings',
    'emails_sent','activities','competitors','methodology',
    'email_cadences','ai_decisions','brain_insights',
    'leads','lead_embeddings','campaigns','outreach_log',
    'learning_patterns','scoring_weights','brain_memory',
    'hunt_jobs','email_templates','improvement_log'
  );
