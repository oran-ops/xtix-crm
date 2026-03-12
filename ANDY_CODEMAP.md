# ANDY.AI — Codebase Reference Map
> **Single source of truth for all code work. Read this before touching any file.**
> Generated: 2026-03-11 | index.html: 13,382 lines | server.py: 1,348 lines

---

## ⚡ QUICK REFERENCE

| Need to... | Go to |
|---|---|
| Add new AI analysis logic | `triggerFullAnalysis` L6374 → new file `js/andy-meta.js` |
| Add Hunt feature | `runHuntSearch` L9755 → new file `js/andy-hunt.js` |
| Add KB input type | `_kbSave` L11996 + `_kbSetType` L11954 |
| Record outcome | `markDecisionOutcome` L11197 → new file `js/andy-outcomes.js` |
| Add signal type | `SIGNAL_WEIGHTS` L12121 |
| Add server endpoint | `server.py` do_POST() or do_GET() before final `else 404` |
| Fix Brain BG | `_brainBGScheduler` L12840 (NOT `_kbAutoScheduler` L11819) |
| Fix KB scheduler | `_kbAutoScheduler` L11819 (NOT `_brainBGScheduler` L12840) |

---

## 🚨 DUPLICATE FUNCTIONS — ALWAYS UPDATE BOTH

> This is the #1 source of bugs. Before editing any function below, check this list.

| Function | Lines | Rule |
|---|---|---|
| `patchCard` | **L8756, L10310** | Update BOTH — lead card DOM patcher |
| `renderSimpleLead` | **L4559, L7734, L8747, L10301** | L10301 is active in Hunt context |
| `newHuntSearch` | **L8730, L9673** | L9673 is v2 (active), L8730 is legacy |
| `_showMetaJudgeToast` | **L6475, L11398** | Update BOTH |
| `_autoRun` | **L11834, L12853** | DIFFERENT purposes — L11834=KB, L12853=BrainBG |
| `_markRan` | **L11830, L12850** | DIFFERENT — L11830=KB, L12850=BrainBG |
| `_kbInit` | **L11810, L11863** | L11863 is active — L11810 is stub |
| `addLead` | **L3465, L7751** | L7751 is active |
| `switchMainTab` | **L5271, L9359** | L9359 overrides |
| `setLeadMode` | **L5414, L13091** | L13091 overrides |
| `huntGoStep` | **L9693, L13102** | Different contexts — both may need update |

---

## 📦 SCRIPT BLOCKS IN index.html

```
Block 2:  L3412–L6690   Core CRM — outreach, enrichment, analysis, auth
Block 3:  L7452–L7629   Lead scoring / URL analyzer
Block 4:  L7642–L7903   Lead management helpers
Block 5:  L8268–L9099   Hunt v1 + UI helpers  ← LEGACY, do not edit
Block 6:  L9185–L9374   AI Chat + _callAIFast
Block 7:  L9377–L10643  Hunt v2               ← ACTIVE Hunt code
Block 8:  L10908–L11692 Brain tab — config, decisions, performance
Block 9:  L11694–L12110 KB tab — ingestion, scheduler
Block 10: L12112–L13381 Signal Engine + Brain BG + feedback
```

---

## 🗂️ SEGMENTS

---

### 1. AI HUNT
**New file:** `js/andy-hunt.js` | **Active block:** Block 7 (L9377–L10643)

| Function | Line | Role |
|---|---|---|
| `runHuntSearch` | L9755 | **Entry point** — generates queries → Serper → returns leads |
| `huntAddLead` | L10063 | Adds result to CRM, deduplication by domain |
| `getHuntParams` | L9732 | Reads UI checkboxes → params object |
| `_huntRecordFound` | L8497 | Writes to `hunt_learnings` when segment found |
| `_huntRecordOutcome` | L8521 | Updates win_rate in `hunt_learnings` after outcome |
| `_huntLoadLearnings` | L8554 | Loads learnings sorted by win_rate → feeds queries |
| `_huntFeedback` | L13012 | User approves/rejects Hunt lead |
| `_huntFromCompetitor` | L13341 | Pre-fills Hunt from Intel tab |

**Tables:** `hunt_learnings`, `leads`
**Server:** `POST /hunt`, `POST /ai`
**Globals read:** `window.SERVER`, `window._sb`, `window._authFetch`, `leads`
**Globals write:** `window._huntHistory`, `window._lastHuntParams`

**v4 additions (new file):** `buildHuntStrategy()`, `updateHuntStrategyFromOutcome()`, `_huntPreScore()`
**v4 new table:** `hunt_strategy`

> ⚠️ Do NOT edit Block 5 Hunt functions — they are legacy v1

---

### 2. META-JUDGE
**New file:** `js/andy-meta.js` | **Active blocks:** Block 2 (L6374) + Block 8 (L10908–L11692)

| Function | Line | Role |
|---|---|---|
| `triggerFullAnalysis` | L6374 | **Entry point** — enriches + analyzes + saves |
| `saveBrainDecision` | L11293 | **Outcome hub** — writes `ai_decisions`, `outreach_queue`, `hunt_learnings` |
| `_callAI` | L6510 | Claude API call with 2x retry |
| `_callAIFast` | L9499 | Fast Claude call for AI Chat |
| `loadBrainDecisions` | L11032 | Loads `ai_decisions` for Brain tab |
| `loadBrainConfig` | L10979 | Loads brain config from `app_settings` |
| `loadBrainPerformance` | L11231 | Brain tab performance stats |
| `markDecisionOutcome` | L11197 | Oran marks decision correct/incorrect |
| `_ltab_metajudge` | L4990 | Renders Meta-Judge tab in lead modal |

**Tables:** `ai_decisions`, `outreach_queue`, `brain_insights`, `app_settings`, `brain_memory`
**Server:** `POST /ai`, `POST /gpt`, `POST /gemini`

**v4 additions:** `runMetaJudge()`, `_metaVote()`, `_metaSelfAnalysis()`, `_metaKBAlignment()`, `_metaBuildOutreach()`

> ⚠️ `_showMetaJudgeToast` exists at **L6475 AND L11398** — update BOTH
> ⚠️ `outreach_queue` insert happens in `generateOutreach` (L3609), NOT in `triggerFullAnalysis`
> ⚠️ All outcome hooks belong in `saveBrainDecision` at L11293

---

### 3. ENRICHMENT
**No new file** — extend existing | **Block:** Block 2 (L5928–L6690)

| Function | Line | Role |
|---|---|---|
| `autoEnrichLead` | L5928 | **Entry point** — single Claude call, returns enriched object |
| `callAI` (inner) | L5943 | Closure inside `autoEnrichLead` — NOT a global |
| `_enqueue` | L6120 | Adds to analysis queue |
| `_processQueue` | L6135 | Processes queue one-at-a-time |
| `reEnrichLead` | L6633 | Re-runs enrichment on existing lead |

**v4 change:** Inject `brain_insights.tone_guidelines` into Claude system prompt

> ⚠️ `callAI` at L5943 is a closure — not accessible globally
> ⚠️ Never bypass `_enqueue` — the queue prevents parallel overload

---

### 4. SIGNAL ENGINE
**No new file** — add to `SIGNAL_WEIGHTS` only | **Block:** Block 10 (L12112–L13381)

| Function | Line | Role |
|---|---|---|
| `_signalRecord` | L12316 | **Core writer** → `lead_signals` table |
| `SIGNAL_WEIGHTS` | L12121 | ~120 signal types with weights — **add new signals here** |
| `_signalOnStatusChange` | L12334 | Hook: fires on lead status change |
| `_signalOnAnalysis` | L12445 | Hook: fires after AI analysis |
| `_signalEmailSent` | L12462 | Hook: fires on email send |

**Table:** `lead_signals`
**v4 adds to SIGNAL_WEIGHTS:** `hunt_strategy_updated`, `kb_uploaded`, `outcome_reason_recorded`, `re_engage_scheduled`

> ⚠️ `_signalRecord` is fire-and-forget — never await in critical path
> ⚠️ Signals are append-only — never delete from `lead_signals`

---

### 5. BRAIN BACKGROUND
**New file:** `js/andy-brain-bg.js` (additions only) | **Blocks:** Block 10 (L12840) + Block 9 (L11819)

| Function | Line | Role |
|---|---|---|
| `_brainBGScheduler` | L12840 | Runs every 6h → calls `_brainBackgroundAnalysis` |
| `_brainBackgroundAnalysis` | L12599 | Core analysis → writes `brain_memory` |
| `_kbAutoScheduler` | L11819 | **Separate** KB scheduler → calls `/kb/run` on server |

**localStorage keys:** `andyBrainBGLastRun`, `andyKBLastRun`
**Tables:** `brain_memory`, `brain_insights`, `ai_decisions`, `lead_signals`
**Server:** `POST /kb/run`

**v4 additions:** `analyzeLossReasons()`, `recalibrateEngineWeights()`

> ⚠️ TWO separate schedulers — BrainBG (local) and KB (server) — never merge them
> ⚠️ `_autoRun` and `_markRan` exist as closures in BOTH schedulers — they are NOT the same

---

### 6. KB INGESTION
**New file:** `js/andy-kb.js` | **Block:** Block 9 (L11694–L12110)

| Function | Line | Role |
|---|---|---|
| `_kbInit` | L11863 | **Active init** (L11810 is stub — ignore) |
| `_kbSave` | L11996 | Saves new KB doc |
| `_kbFetchContent` | L12049 | Fetches URL via `/analyze` → extend to `/kb/fetch-url` |
| `_kbFetchGithub` | L12063 | Fetches GitHub README — **exists, extend don't rewrite** |
| `_kbSetType` | L11954 | Switches input type in modal |
| `_kbFileSelected` | L11967 | File input handler |
| `_kbTriggerJob` | L11730 | Manually triggers `/kb/run` |

**Tables:** `knowledge_base`, `brain_insights`
**Server:** `POST /kb/run`, `POST /kb/fetch-url` (NEW), `POST /kb/fetch-github` (NEW)

**v4 additions:** `kbIngestContent()` pipeline, Stream B auto-learn from WON
**v4 new table:** `kb_ingestion_log`

> ⚠️ KB docs need `status='ready'` to be used by Brain BG
> ⚠️ `_kbInit` has TWO definitions — edit **only L11863**

---

### 7. OUTREACH QUEUE
**No new file** | **Block:** Block 2 (L3609–L4162)

| Function | Line | Role |
|---|---|---|
| `generateOutreach` | L3609 | Generates email/WA via Claude → inserts to `outreach_queue` |
| `_outreachApprove` | L4042 | Approve → send → status='sent' |
| `_outreachReject` | L4095 | Reject → status='rejected' |
| `_outreachEdit` | L4107 | Edit body before send |
| `_outreachSchedule` | L4142 | Set scheduled_at |

**Status flow:** `pending_approval` → `sent` | `rejected` | `scheduled`
**Server:** `POST /send-email` (SendGrid → Gmail fallback), `POST /send-whatsapp`

---

### 8. OUTCOME TAXONOMY
**New file:** `js/andy-outcomes.js` | **Block:** Block 8 (L11197, L11372)

| Function | Line | Role |
|---|---|---|
| `markDecisionOutcome` | L11197 | **Extend this** — currently only won/not-won |
| `_setLeadOutcome` | L11372 | Sets lead outcome from Brain tab |

**v4 additions:**
- `showOutcomeModal(leadId)` — 6-button reason selector
- `recordOutcome(leadId, reason, subReason, reEngageDate)`
- 6 reason types: `won`, `no_reply`, `not_now`, `too_expensive`, `tech_mismatch`, `no_need`

**v4 new table:** `outcome_reasons`

---

### 9. SERVER.PY ENDPOINTS

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | none | Serves index.html |
| GET | `/health` | none | API keys status |
| GET | `/analyze` | sales | Scrape URL |
| POST | `/ai` | sales | → Anthropic Claude |
| POST | `/gpt` | sales | → OpenAI GPT |
| POST | `/gemini` | sales | → Google Gemini |
| POST | `/send-email` | sales | SendGrid → Gmail |
| POST | `/send-whatsapp` | sales | Twilio |
| POST | `/kb/run` | sales | KB synthesis via Claude |
| POST | `/hunt` | sales | Serper.dev search |
| POST | `/webhook/lead` | none | Clay/Zapier intake |
| **POST** | **`/kb/fetch-url`** | sales | **NEW v4** |
| **POST** | **`/kb/fetch-github`** | sales | **NEW v4** |
| **POST** | **`/hunt/strategy`** | sales | **NEW v4** |

**Pattern for new endpoints:**
```python
elif p.path == '/new-endpoint':
    if not self.auth_check('sales'): return
    if not self.rate_check('/new-endpoint'): return
    # logic
    self.json_out(result)
```

---

## 🗄️ SUPABASE TABLES

### Existing
`leads` · `ai_decisions` · `knowledge_base` · `outreach_queue` · `competitors` · `hunt_learnings` · `lead_signals` · `users` · `activities` · `reminders` · `emails_sent` · `tasks` · `app_settings` · `methodology` · `brain_insights` · `brain_memory`

### New — v4 (must create before deploying)
| Table | Status |
|---|---|
| `hunt_strategy` | ❌ Create now |
| `kb_ingestion_log` | ❌ Create now |
| `outcome_reasons` | ❌ Create now |

---

## 📁 NEW FILES STRUCTURE

```
js/
  andy-hunt.js       Hunt Engine v2 additions
  andy-meta.js       Meta-Judge v2
  andy-kb.js         KB Ingestion additions
  andy-outcomes.js   Outcome Taxonomy
  andy-brain-bg.js   Brain BG additions
```

**Add to bottom of index.html before `</body>`:**
```html
<script src="js/andy-hunt.js"></script>
<script src="js/andy-meta.js"></script>
<script src="js/andy-kb.js"></script>
<script src="js/andy-outcomes.js"></script>
<script src="js/andy-brain-bg.js"></script>
```

**Every new JS file starts with:**
```javascript
// ╔══════════════════════════════════════════════╗
// ║  andy-{name}.js                              ║
// ║  Depends: window._sb, window._authFetch      ║
// ║  Writes:  {tables}                           ║
// ║  Hooks into index.html: L{line}              ║
// ║  Last updated: {date}                        ║
// ╚══════════════════════════════════════════════╝
```

---

## 🔄 SESSION BRIEF TEMPLATE

> Paste this at the start of every coding session:

```
עובדים על: [feature/segment]
קובץ: [index.html / server.py / js/andy-X.js]
שורות רלוונטיות: [אם ידוע]
מה עבד אחרון: [...]
מה שבור / מה רוצים: [...]
```

---
*ANDY_CODEMAP.md — reference only, do not deploy*
