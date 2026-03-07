#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
╔══════════════════════════════════════════════════════════╗
║         ANDY BRAIN v2.0 — Enterprise AI Engine          ║
║         FastAPI · Supabase · pgvector · Railway         ║
╚══════════════════════════════════════════════════════════╝

Modules:
  /brain/status    → מצב המוח
  /brain/hunt      → מציאת לידים (Google, Eventbrite, Excel)
  /brain/analyze   → ניתוח ליד + pgvector memory
  /brain/outreach  → campaign אוטומטי (Email + WhatsApp)
  /brain/learn     → self-learning מ-deal outcomes
  /brain/insights  → תובנות ודפוסים
"""

import os, json, re, asyncio, hashlib, time
from datetime import datetime, timezone
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import httpx
from supabase import create_client, Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

load_dotenv()

# ══════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
ANTHROPIC_API_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY       = os.environ.get("OPENAI_API_KEY", "")
SERPAPI_KEY          = os.environ.get("SERPAPI_KEY", "")
EVENTBRITE_TOKEN     = os.environ.get("EVENTBRITE_TOKEN", "")
HUNTER_API_KEY       = os.environ.get("HUNTER_API_KEY", "")
TWILIO_SID           = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN         = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WA_FROM       = os.environ.get("TWILIO_WHATSAPP_FROM", "")
HUBSPOT_TOKEN        = os.environ.get("HUBSPOT_TOKEN", "")
BRAIN_AUTH_TOKEN     = os.environ.get("BRAIN_AUTH_TOKEN", "andy-brain-secret")

# ══════════════════════════════════════════════════════════
# SUPABASE CLIENT
# ══════════════════════════════════════════════════════════

def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(500, "Supabase not configured")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ══════════════════════════════════════════════════════════
# SCHEDULER
# ══════════════════════════════════════════════════════════

scheduler = AsyncIOScheduler(timezone="Asia/Jerusalem")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("🧠 ANDY Brain v2.0 starting...", flush=True)
    scheduler.add_job(job_hourly_hunt,   "interval", hours=1,   id="hourly_hunt",   replace_existing=True)
    scheduler.add_job(job_weekly_learn,  "cron",     day_of_week="mon", hour=8, id="weekly_learn", replace_existing=True)
    scheduler.add_job(job_run_campaigns, "interval", minutes=30, id="run_campaigns", replace_existing=True)
    scheduler.start()
    print("✅ Scheduler started — hunt every 1h, campaigns every 30min, learn every Monday", flush=True)
    yield
    # Shutdown
    scheduler.shutdown()
    print("👋 ANDY Brain stopped", flush=True)

# ══════════════════════════════════════════════════════════
# FASTAPI APP
# ══════════════════════════════════════════════════════════

app = FastAPI(
    title="ANDY Brain v2.0",
    description="Enterprise AI Sales Engine — XTIX Events",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════

class LeadIn(BaseModel):
    name:      str
    domain:    str = ""
    email:     str = ""
    phone:     str = ""
    platform:  str = ""
    segment:   str = "כללי"
    score:     int = 0
    cadence:   str = "cool"
    source:    str = "manual"
    firebase_id: str = ""
    ai_analysis: dict = {}
    enrichment:  dict = {}

class OutcomeIn(BaseModel):
    lead_id: str
    outcome: str   # "closed" | "lost"
    ai_score: int = 0

class HuntRequest(BaseModel):
    source:  str = "google"   # google | eventbrite | linkedin | manual
    query:   str = "מפיק אירועים ישראל"
    limit:   int = 20

class OutreachRequest(BaseModel):
    lead_id:  str
    channel:  str = "email"   # email | whatsapp
    template: str = "opener"

# ══════════════════════════════════════════════════════════
# MODULE 0 — HEALTH & STATUS
# ══════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {"status": "ok", "service": "ANDY Brain v2.0", "time": datetime.now(timezone.utc).isoformat()}

@app.get("/health")
async def health():
    return {
        "status":    "ok",
        "version":   "2.0.0",
        "supabase":  bool(SUPABASE_URL),
        "claude":    bool(ANTHROPIC_API_KEY),
        "openai":    bool(OPENAI_API_KEY),
        "serpapi":   bool(SERPAPI_KEY),
        "eventbrite": bool(EVENTBRITE_TOKEN),
        "twilio":    bool(TWILIO_SID),
        "hubspot":   bool(HUBSPOT_TOKEN),
    }

@app.get("/brain/status")
async def brain_status():
    """מצב מלא של המוח — stats, weights, last activity"""
    try:
        sb = get_supabase()

        # Get current weights
        w_res = sb.table("scoring_weights").select("*").eq("is_current", True).limit(1).execute()
        weights = w_res.data[0] if w_res.data else {}

        # Get lead counts
        total_res  = sb.table("leads").select("id", count="exact").execute()
        won_res    = sb.table("leads").select("id", count="exact").eq("outcome", "closed").execute()
        lost_res   = sb.table("leads").select("id", count="exact").eq("outcome", "lost").execute()
        pattern_res = sb.table("learning_patterns").select("id", count="exact").execute()

        total = total_res.count or 0
        won   = won_res.count or 0
        lost  = lost_res.count or 0

        # Last memory snapshot
        mem_res = sb.table("brain_memory").select("*").order("created_at", desc=True).limit(1).execute()
        memory  = mem_res.data[0] if mem_res.data else {}

        return {
            "ok": True,
            "version": "2.0.0",
            "stats": {
                "total_leads":    total,
                "won_deals":      won,
                "lost_deals":     lost,
                "win_rate":       round((won / max(won + lost, 1)) * 100, 1),
                "accuracy":       weights.get("accuracy", 0),
                "patterns":       pattern_res.count or 0,
            },
            "weights":     weights.get("weights", {}),
            "last_learn":  memory.get("created_at", "never"),
            "scheduler":   {
                "hunt_every":     "1 hour",
                "campaigns_every": "30 min",
                "learn_every":    "Monday 08:00",
            }
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ══════════════════════════════════════════════════════════
# MODULE 1 — LEAD HUNTER
# ══════════════════════════════════════════════════════════

@app.post("/brain/hunt")
async def hunt_leads(req: HuntRequest, background_tasks: BackgroundTasks):
    """הפעל חיפוש לידים — רץ ברקע"""
    sb = get_supabase()

    # Create job record
    job = sb.table("hunt_jobs").insert({
        "source":  req.source,
        "query":   req.query,
        "status":  "pending",
    }).execute()

    job_id = job.data[0]["id"]

    # Run in background
    background_tasks.add_task(_run_hunt_job, job_id, req.source, req.query, req.limit)

    return {"ok": True, "job_id": job_id, "message": f"Hunt job started — {req.source}"}

@app.get("/brain/hunt/jobs")
async def get_hunt_jobs():
    """רשימת hunt jobs אחרונים"""
    sb = get_supabase()
    res = sb.table("hunt_jobs").select("*").order("created_at", desc=True).limit(20).execute()
    return {"ok": True, "jobs": res.data}

@app.post("/brain/hunt/upload")
async def upload_leads(file: UploadFile = File(...)):
    """העלאת Excel/CSV עם לידים"""
    import csv, io
    content = await file.read()
    text    = content.decode("utf-8-sig", errors="ignore")
    reader  = csv.DictReader(io.StringIO(text))

    sb     = get_supabase()
    added  = 0
    errors = []

    for row in reader:
        try:
            lead = {
                "name":     row.get("name", row.get("שם", "")),
                "domain":   row.get("domain", row.get("דומיין", "")),
                "email":    row.get("email", row.get("מייל", "")),
                "phone":    row.get("phone", row.get("טלפון", "")),
                "platform": row.get("platform", row.get("פלטפורמה", "")),
                "segment":  row.get("segment", row.get("סגמנט", "כללי")),
                "source":   "excel",
            }
            if not lead["name"]:
                continue

            # Dedup by domain
            if lead["domain"]:
                existing = sb.table("leads").select("id").eq("domain", lead["domain"]).execute()
                if existing.data:
                    continue

            # Generate xtix_id
            lead["xtix_id"] = "XT-" + hashlib.md5(lead["name"].encode()).hexdigest()[:6].upper()

            sb.table("leads").insert(lead).execute()
            added += 1
        except Exception as e:
            errors.append(str(e))

    return {"ok": True, "added": added, "errors": len(errors)}

async def _run_hunt_job(job_id: str, source: str, query: str, limit: int):
    """Background task — מריץ חיפוש לפי source"""
    sb = get_supabase()

    try:
        sb.table("hunt_jobs").update({"status": "running", "started_at": datetime.now(timezone.utc).isoformat()}).eq("id", job_id).execute()

        leads_found = []

        if source == "google" and SERPAPI_KEY:
            leads_found = await _hunt_google(query, limit)
        elif source == "eventbrite" and EVENTBRITE_TOKEN:
            leads_found = await _hunt_eventbrite(limit)
        else:
            print(f"[Hunt] Source '{source}' — API key missing or source unknown", flush=True)

        # Save leads to Supabase
        added = 0
        for lead_data in leads_found:
            try:
                # Dedup by domain
                if lead_data.get("domain"):
                    existing = sb.table("leads").select("id").eq("domain", lead_data["domain"]).execute()
                    if existing.data:
                        continue

                lead_data["source"] = source
                lead_data["xtix_id"] = "XT-" + hashlib.md5(lead_data.get("name", "").encode()).hexdigest()[:6].upper()
                sb.table("leads").insert(lead_data).execute()
                added += 1
            except Exception as e:
                print(f"[Hunt] Insert error: {e}", flush=True)

        sb.table("hunt_jobs").update({
            "status":      "done",
            "leads_found": len(leads_found),
            "leads_added": added,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()

        print(f"[Hunt] ✅ Job done — {source}: found {len(leads_found)}, added {added}", flush=True)

    except Exception as e:
        sb.table("hunt_jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        print(f"[Hunt] ❌ Job failed: {e}", flush=True)

async def _hunt_google(query: str, limit: int) -> list:
    """חיפוש לידים דרך SerpAPI"""
    leads = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get("https://serpapi.com/search", params={
                "q":       query,
                "api_key": SERPAPI_KEY,
                "hl":      "he",
                "gl":      "il",
                "num":     limit,
            })
            data = resp.json()

        for result in data.get("organic_results", [])[:limit]:
            link   = result.get("link", "")
            domain = re.sub(r"https?://(www\.)?", "", link).split("/")[0]
            if not domain:
                continue

            lead = {
                "name":    result.get("title", domain)[:100],
                "domain":  domain,
                "segment": "גילוי אירועים",
                "score":   50,
            }

            # Try to find email via Hunter.io
            if HUNTER_API_KEY and domain:
                email = await _hunter_find_email(domain)
                if email:
                    lead["email"] = email

            leads.append(lead)

    except Exception as e:
        print(f"[Hunt/Google] Error: {e}", flush=True)

    return leads

async def _hunt_eventbrite(limit: int) -> list:
    """חיפוש מארגני אירועים מ-Eventbrite"""
    leads = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://www.eventbriteapi.com/v3/events/search/",
                headers={"Authorization": f"Bearer {EVENTBRITE_TOKEN}"},
                params={
                    "location.address":       "Israel",
                    "location.within":        "100km",
                    "expand":                 "organizer,venue",
                    "page_size":              limit,
                    "sort_by":                "date",
                }
            )
            data = resp.json()

        seen_organizers = set()
        for event in data.get("events", []):
            org = event.get("organizer", {})
            org_id = org.get("id", "")
            if not org_id or org_id in seen_organizers:
                continue
            seen_organizers.add(org_id)

            lead = {
                "name":    org.get("name", "")[:100],
                "domain":  org.get("website", "").replace("https://", "").replace("http://", "").split("/")[0],
                "email":   org.get("email", ""),
                "segment": "כנסים",
                "score":   60,
                "enrichment": {
                    "eventbrite_id":  org_id,
                    "event_name":     event.get("name", {}).get("text", ""),
                    "event_date":     event.get("start", {}).get("local", ""),
                }
            }
            if lead["name"]:
                leads.append(lead)

    except Exception as e:
        print(f"[Hunt/Eventbrite] Error: {e}", flush=True)

    return leads

async def _hunter_find_email(domain: str) -> str:
    """מציאת אימייל ב-Hunter.io"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://api.hunter.io/v2/domain-search", params={
                "domain":  domain,
                "api_key": HUNTER_API_KEY,
                "limit":   1,
            })
            data = resp.json()
            emails = data.get("data", {}).get("emails", [])
            if emails:
                return emails[0].get("value", "")
    except Exception:
        pass
    return ""

# ══════════════════════════════════════════════════════════
# MODULE 2 — SMART ANALYZER + pgvector
# ══════════════════════════════════════════════════════════

@app.post("/brain/analyze/{lead_id}")
async def analyze_lead(lead_id: str, background_tasks: BackgroundTasks):
    """ניתוח עמוק של ליד + שמירת embedding"""
    sb = get_supabase()

    # Get lead
    res = sb.table("leads").select("*").eq("id", lead_id).execute()
    if not res.data:
        raise HTTPException(404, "Lead not found")

    lead = res.data[0]
    background_tasks.add_task(_analyze_lead_task, lead)

    return {"ok": True, "lead_id": lead_id, "message": "Analysis started"}

async def _analyze_lead_task(lead: dict):
    """Background: ניתוח ליד מלא"""
    sb = get_supabase()
    lead_id = lead["id"]

    try:
        print(f"[Analyze] Starting: {lead.get('name', 'unknown')}", flush=True)

        # Step 1: Find similar won leads (pgvector)
        similar_context = ""
        if OPENAI_API_KEY:
            embedding = await _create_embedding(_lead_to_text(lead))
            if embedding:
                # Save embedding
                try:
                    sb.table("lead_embeddings").insert({
                        "lead_id":   lead_id,
                        "embedding": embedding,
                        "content":   _lead_to_text(lead),
                        "embed_type": "full",
                    }).execute()
                except Exception:
                    pass  # embedding already exists

                # Find similar closed leads
                similar = sb.rpc("match_leads", {
                    "query_embedding": embedding,
                    "match_threshold": 0.75,
                    "match_count":     5,
                    "filter":          {"outcome": "closed"}
                }).execute()

                if similar.data:
                    similar_context = "\n\nלידים דומים שנסגרו בעבר:\n" + "\n".join([
                        f"- {s['name']} (segment: {s['segment']}, score: {s['ai_score']}, similarity: {round(s['similarity']*100)}%)"
                        for s in similar.data
                    ])

        # Step 2: Get learned scoring weights
        w_res = sb.table("scoring_weights").select("weights,segment_rates").eq("is_current", True).limit(1).execute()
        weights_info = ""
        if w_res.data:
            weights_info = f"\nמשקלות scoring שנלמדו: {json.dumps(w_res.data[0].get('weights', {}), ensure_ascii=False)}"

        # Step 3: Claude deep analysis
        analysis = await _claude_analyze(lead, similar_context, weights_info)

        if analysis:
            # Step 4: Calculate enhanced score
            enhanced_score = _calculate_score(lead, analysis)

            # Step 5: Save to Supabase
            sb.table("leads").update({
                "ai_analysis": analysis,
                "ai_score":    enhanced_score,
                "tier":        "A" if enhanced_score >= 80 else "B" if enhanced_score >= 60 else "C",
                "updated_at":  datetime.now(timezone.utc).isoformat(),
            }).eq("id", lead_id).execute()

            print(f"[Analyze] ✅ Done: {lead.get('name')} — score {enhanced_score}", flush=True)
        else:
            print(f"[Analyze] ❌ Claude returned empty for {lead.get('name')}", flush=True)

    except Exception as e:
        print(f"[Analyze] ❌ Error for {lead_id}: {e}", flush=True)

def _lead_to_text(lead: dict) -> str:
    """המר ליד לטקסט לצורך embedding"""
    parts = [
        f"שם: {lead.get('name', '')}",
        f"דומיין: {lead.get('domain', '')}",
        f"פלטפורמה: {lead.get('platform', '')}",
        f"סגמנט: {lead.get('segment', '')}",
        f"מייל: {lead.get('email', '')}",
    ]
    ai = lead.get("ai_analysis", {})
    if isinstance(ai, dict) and ai.get("executive_summary"):
        parts.append(f"סיכום: {ai['executive_summary'][:300]}")
    return " | ".join(p for p in parts if p.split(": ")[1])

async def _create_embedding(text: str) -> Optional[list]:
    """צור embedding דרך OpenAI text-embedding-3-small"""
    if not OPENAI_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={"model": "text-embedding-3-small", "input": text[:8000]},
            )
            data = resp.json()
            return data["data"][0]["embedding"]
    except Exception as e:
        print(f"[Embed] Error: {e}", flush=True)
        return None

async def _claude_analyze(lead: dict, similar_context: str, weights_info: str) -> Optional[dict]:
    """ניתוח Claude עמוק עם context"""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        prompt = f"""אתה מנוע AI של XTIX Events — מערכת מכירות לתחום אירועים בישראל.
נתח את הליד הבא וספק ניתוח מכירות מלא.

פרטי הליד:
שם: {lead.get('name', '')}
דומיין: {lead.get('domain', '')}
פלטפורמה: {lead.get('platform', '')}
סגמנט: {lead.get('segment', '')}
מייל: {lead.get('email', '')}
טלפון: {lead.get('phone', '')}
{similar_context}
{weights_info}

ICP של XTIX: מפיקי אירועים קטנים-בינוניים בישראל עם דומיין פרטי שמשתמשים בפלטפורמת כרטוס חיצונית.
מוצר: פלטפורמת כרטוס עם דומיין פרטי, עמלה 3-5%.
מתחרים: SmarTicket, Eventbrite, Billeto.

החזר JSON בלבד (ללא backticks):
{{
  "executive_summary": "סיכום 2-3 משפטים",
  "fit_score": 0-100,
  "pain_points": ["כאב 1", "כאב 2"],
  "sales_attack": "אסטרטגיית תקיפה",
  "opener_email_subject": "שורת נושא למייל ראשון",
  "opener_email_body": "גוף מייל ראשון קצר ומותאם אישית",
  "whatsapp_opener": "הודעת WhatsApp קצרה",
  "next_action": "הפעולה הבאה",
  "recommended_cadence": "hot|warm|cool",
  "competitors_used": ["מתחרה 1"],
  "close_probability": 0-100
}}"""

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key":         ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json={
                    "model":      "claude-haiku-4-5-20251001",
                    "max_tokens": 1500,
                    "messages":   [{"role": "user", "content": prompt}],
                }
            )
            data = resp.json()
            text = data.get("content", [{}])[0].get("text", "")

        # Parse JSON
        s = text.find("{"); e = text.rfind("}") + 1
        if s >= 0 and e > s:
            analysis = json.loads(text[s:e])
            analysis["status"]      = "done"
            analysis["analyzed_at"] = datetime.now(timezone.utc).isoformat()
            analysis["engine"]      = "claude-haiku"
            return analysis

    except Exception as e:
        print(f"[Analyze/Claude] Error: {e}", flush=True)
    return None

def _calculate_score(lead: dict, analysis: dict) -> int:
    """חשב ציון משופר עם learned weights"""
    base = analysis.get("fit_score", 50)
    close_prob = analysis.get("close_probability", 50)
    return min(100, max(0, round(base * 0.7 + close_prob * 0.3)))

@app.post("/brain/analyze/similar")
async def find_similar(body: dict):
    """מצא לידים דומים בעזרת pgvector"""
    lead_id   = body.get("lead_id")
    outcome   = body.get("outcome")  # "closed" | "lost" | None
    threshold = body.get("threshold", 0.75)
    limit     = body.get("limit", 5)

    if not lead_id:
        raise HTTPException(400, "lead_id required")

    sb  = get_supabase()
    res = sb.table("lead_embeddings").select("embedding").eq("lead_id", lead_id).limit(1).execute()

    if not res.data:
        return {"ok": False, "message": "No embedding for this lead yet", "similar": []}

    embedding = res.data[0]["embedding"]
    filt = {}
    if outcome:
        filt["outcome"] = outcome

    similar = sb.rpc("match_leads", {
        "query_embedding": embedding,
        "match_threshold": threshold,
        "match_count":     limit,
        "filter":          filt,
    }).execute()

    return {"ok": True, "similar": similar.data or []}

# ══════════════════════════════════════════════════════════
# MODULE 3 — OUTREACH ENGINE
# ══════════════════════════════════════════════════════════

@app.post("/brain/outreach/campaign")
async def create_campaign(req: OutreachRequest, background_tasks: BackgroundTasks):
    """צור campaign לליד"""
    sb  = get_supabase()
    res = sb.table("leads").select("*").eq("id", req.lead_id).execute()
    if not res.data:
        raise HTTPException(404, "Lead not found")

    lead = res.data[0]
    ai   = lead.get("ai_analysis", {})

    # Build 4-step campaign
    now = datetime.now(timezone.utc)
    steps = [
        {
            "step":    1,
            "channel": "email",
            "delay_days": 0,
            "subject": ai.get("opener_email_subject", f"XTIX — פלטפורמת כרטוס חדשה עבור {lead.get('name','')}"),
            "body":    ai.get("opener_email_body", ""),
            "status":  "pending",
        },
        {
            "step":    2,
            "channel": "email",
            "delay_days": 3,
            "subject": f"המשך שיחה — {lead.get('name','')}",
            "body":    "",
            "status":  "pending",
        },
        {
            "step":    3,
            "channel": "whatsapp" if lead.get("phone") else "email",
            "delay_days": 5,
            "subject": "",
            "body":    ai.get("whatsapp_opener", ""),
            "status":  "pending",
        },
        {
            "step":    4,
            "channel": "email",
            "delay_days": 8,
            "subject": f"הזדמנות אחרונה — {lead.get('name','')}",
            "body":    "",
            "status":  "pending",
        },
    ]

    campaign = sb.table("campaigns").insert({
        "lead_id":      req.lead_id,
        "status":       "active",
        "current_step": 0,
        "total_steps":  len(steps),
        "steps":        steps,
        "next_action":  now.isoformat(),
    }).execute()

    campaign_id = campaign.data[0]["id"]

    # Run first step immediately
    background_tasks.add_task(_run_campaign_step, campaign_id, lead, steps[0])

    return {"ok": True, "campaign_id": campaign_id, "steps": len(steps)}

async def _run_campaign_step(campaign_id: str, lead: dict, step: dict):
    """הרץ צעד בקמפיין"""
    sb = get_supabase()
    channel = step.get("channel", "email")
    success = False

    try:
        if channel == "email" and lead.get("email"):
            success = await _send_email(
                to=lead["email"],
                subject=step.get("subject", ""),
                body=step.get("body", ""),
                lead=lead,
            )
        elif channel == "whatsapp" and lead.get("phone"):
            success = await _send_whatsapp(
                to=lead["phone"],
                body=step.get("body", ""),
            )

        # Log outreach
        sb.table("outreach_log").insert({
            "lead_id":     lead["id"],
            "campaign_id": campaign_id,
            "channel":     channel,
            "subject":     step.get("subject", ""),
            "body":        step.get("body", "")[:500],
            "status":      "sent" if success else "failed",
        }).execute()

        # Update campaign
        sb.table("campaigns").update({
            "current_step": step["step"],
            "updated_at":   datetime.now(timezone.utc).isoformat(),
        }).eq("id", campaign_id).execute()

        # Update lead status
        if success and lead.get("status") == "new":
            sb.table("leads").update({"status": "contacted"}).eq("id", lead["id"]).execute()

    except Exception as e:
        print(f"[Outreach] Step error: {e}", flush=True)

async def _send_email(to: str, subject: str, body: str, lead: dict) -> bool:
    """שלח מייל דרך HubSpot / Gmail (fallback לשרת הקיים)"""
    if not subject or not body:
        print(f"[Email] Empty subject or body for {to}", flush=True)
        return False
    try:
        # Use existing server.py email endpoint as proxy
        existing_server = os.environ.get("XTIX_SERVER_URL", "https://xtix-crm-test.up.railway.app")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{existing_server}/send-email", json={
                "to":      to,
                "subject": subject,
                "html":    body,
                "text":    body,
            }, headers={"Authorization": f"Bearer {BRAIN_AUTH_TOKEN}"})
            result = resp.json()
            return result.get("ok", False)
    except Exception as e:
        print(f"[Email] Error: {e}", flush=True)
        return False

async def _send_whatsapp(to: str, body: str) -> bool:
    """שלח WhatsApp דרך Twilio"""
    if not TWILIO_SID or not TWILIO_TOKEN or not body:
        return False
    try:
        # Format phone number
        phone = re.sub(r"[^\d+]", "", to)
        if phone.startswith("0"):
            phone = "+972" + phone[1:]
        if not phone.startswith("+"):
            phone = "+972" + phone

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
                auth=(TWILIO_SID, TWILIO_TOKEN),
                data={
                    "From": TWILIO_WA_FROM or "whatsapp:+14155238886",
                    "To":   f"whatsapp:{phone}",
                    "Body": body[:1600],
                }
            )
            return resp.status_code == 201
    except Exception as e:
        print(f"[WhatsApp] Error: {e}", flush=True)
        return False

# ══════════════════════════════════════════════════════════
# MODULE 4 — SELF-LEARNING ENGINE
# ══════════════════════════════════════════════════════════

@app.post("/brain/learn/outcome")
async def record_outcome(req: OutcomeIn, background_tasks: BackgroundTasks):
    """רשום תוצאת עסקה והפעל למידה"""
    if req.outcome not in ("closed", "lost"):
        raise HTTPException(400, "outcome must be 'closed' or 'lost'")

    sb  = get_supabase()
    res = sb.table("leads").select("*").eq("id", req.lead_id).execute()
    if not res.data:
        raise HTTPException(404, "Lead not found")

    lead     = res.data[0]
    ai_score = req.ai_score or lead.get("ai_score", 0)

    # Update lead outcome
    sb.table("leads").update({
        "outcome":    req.outcome,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", req.lead_id).execute()

    # Trigger learning in background
    background_tasks.add_task(_learn_from_deal, lead, req.outcome, ai_score)

    return {"ok": True, "message": f"Outcome recorded: {req.outcome}. Learning triggered."}

async def _learn_from_deal(lead: dict, outcome: str, ai_score: int):
    """למד מעסקה — עדכן patterns, weights, segment rates"""
    sb     = get_supabase()
    won    = outcome == "closed"
    was_correct = (won and ai_score >= 60) or (not won and ai_score < 60)

    # 1. Save learning pattern
    try:
        sb.table("learning_patterns").insert({
            "lead_id":     lead["id"],
            "outcome":     outcome,
            "ai_score":    ai_score,
            "was_correct": was_correct,
            "segment":     lead.get("segment", ""),
            "platform":    lead.get("platform", ""),
            "has_domain":  bool(lead.get("domain")),
            "has_email":   bool(lead.get("email")),
            "has_phone":   bool(lead.get("phone")),
            "cadence":     lead.get("cadence", "cool"),
            "source":      lead.get("source", ""),
            "feature_hash": hashlib.md5(f"{lead.get('segment','')}{lead.get('platform','')}".encode()).hexdigest()[:8],
        }).execute()
    except Exception as e:
        print(f"[Learn] Pattern save error: {e}", flush=True)

    # 2. Update scoring weights (gradient nudge)
    try:
        w_res = sb.table("scoring_weights").select("*").eq("is_current", True).limit(1).execute()
        if w_res.data:
            current = w_res.data[0]
            weights = current.get("weights", {})
            lr      = 0.02  # learning rate
            direction = 1 if won else -1

            # Nudge features present in this lead
            if lead.get("domain"):    weights["domain"]   = round(max(0.01, min(0.40, weights.get("domain", 0.20) + direction * lr)), 4)
            if lead.get("platform"):  weights["platform"] = round(max(0.01, min(0.40, weights.get("platform", 0.18) + direction * lr)), 4)
            if lead.get("email") or lead.get("phone"):
                weights["contact"] = round(max(0.01, min(0.40, weights.get("contact", 0.10) + direction * lr * 0.5)), 4)

            # Normalize to sum = 1.0
            total = sum(weights.values())
            weights = {k: round(v / total, 4) for k, v in weights.items()}

            # Update segment rates (EMA)
            seg_rates = current.get("segment_rates", {})
            seg       = lead.get("segment", "כללי")
            alpha     = 0.1
            seg_rates[seg] = round(alpha * (1 if won else 0) + (1 - alpha) * seg_rates.get(seg, 0.45), 4)

            # Recalculate accuracy
            acc_res = sb.table("learning_patterns").select("was_correct").execute()
            if acc_res.data:
                correct = sum(1 for p in acc_res.data if p.get("was_correct"))
                accuracy = round((correct / len(acc_res.data)) * 100, 2)
            else:
                accuracy = 0

            sb.table("scoring_weights").update({
                "weights":       weights,
                "segment_rates": seg_rates,
                "total_deals":   current.get("total_deals", 0) + 1,
                "accuracy":      accuracy,
            }).eq("id", current["id"]).execute()

            print(f"[Learn] ✅ Weights updated — accuracy: {accuracy}%", flush=True)

    except Exception as e:
        print(f"[Learn] Weights update error: {e}", flush=True)

    # 3. Update vector memory with outcome label
    try:
        if OPENAI_API_KEY:
            embedding = await _create_embedding(_lead_to_text(lead) + f" | תוצאה: {outcome}")
            if embedding:
                sb.table("lead_embeddings").insert({
                    "lead_id":    lead["id"],
                    "embedding":  embedding,
                    "content":    f"{_lead_to_text(lead)} | outcome:{outcome}",
                    "embed_type": "analysis",
                }).execute()
    except Exception as e:
        print(f"[Learn] Embedding update error: {e}", flush=True)

    # 4. Save memory snapshot
    await _save_brain_snapshot(sb)
    print(f"[Learn] 🧠 Deal learned: {lead.get('name')} → {outcome} | was_correct: {was_correct}", flush=True)

async def _save_brain_snapshot(sb: Client):
    """שמור snapshot של מצב המוח"""
    try:
        won_res  = sb.table("leads").select("id", count="exact").eq("outcome", "closed").execute()
        lost_res = sb.table("leads").select("id", count="exact").eq("outcome", "lost").execute()
        w_res    = sb.table("scoring_weights").select("weights,segment_rates,accuracy").eq("is_current", True).limit(1).execute()

        won  = won_res.count or 0
        lost = lost_res.count or 0
        total = won + lost
        weights_data = w_res.data[0] if w_res.data else {}

        sb.table("brain_memory").insert({
            "snapshot_type": "auto",
            "won_deals":     won,
            "lost_deals":    lost,
            "total_deals":   total,
            "accuracy":      weights_data.get("accuracy", 0),
            "win_rate":      round((won / max(total, 1)) * 100, 2),
            "weights":       weights_data.get("weights", {}),
            "segment_rates": weights_data.get("segment_rates", {}),
        }).execute()
    except Exception as e:
        print(f"[Memory] Snapshot error: {e}", flush=True)

@app.get("/brain/insights")
async def get_insights():
    """תובנות ודפוסים שהמוח למד"""
    sb = get_supabase()

    # Patterns analysis
    patterns = sb.table("learning_patterns").select("*").order("created_at", desc=True).limit(200).execute()
    data = patterns.data or []

    won  = [p for p in data if p["outcome"] == "closed"]
    lost = [p for p in data if p["outcome"] == "lost"]

    # Top segments
    seg_wins = {}
    for p in won:
        s = p.get("segment", "")
        seg_wins[s] = seg_wins.get(s, 0) + 1

    # Accuracy
    decided = [p for p in data if p.get("was_correct") is not None]
    accuracy = round((sum(1 for p in decided if p["was_correct"]) / max(len(decided), 1)) * 100, 1)

    # Last improvement
    imp = sb.table("improvement_log").select("*").order("created_at", desc=True).limit(1).execute()

    return {
        "ok": True,
        "stats": {
            "total_patterns": len(data),
            "won":            len(won),
            "lost":           len(lost),
            "win_rate":       round(len(won) / max(len(data), 1) * 100, 1),
            "accuracy":       accuracy,
        },
        "top_segments":   sorted(seg_wins.items(), key=lambda x: x[1], reverse=True)[:5],
        "last_improvement": imp.data[0] if imp.data else None,
    }

@app.post("/brain/learn/weekly")
async def trigger_weekly_analysis(background_tasks: BackgroundTasks):
    """הפעל ניתוח שבועי ידני"""
    background_tasks.add_task(job_weekly_learn)
    return {"ok": True, "message": "Weekly analysis started"}

# ══════════════════════════════════════════════════════════
# SCHEDULED JOBS
# ══════════════════════════════════════════════════════════

async def job_hourly_hunt():
    """כל שעה — חפש לידים חדשים"""
    print("[Scheduler] 🔍 Hourly hunt starting...", flush=True)
    queries = [
        "מפיק אירועים ישראל",
        "להקות ואמנים ישראל אירועים",
        "כנסים ועידות ישראל 2026",
        "פסטיבלים ישראל",
    ]
    import random
    query = random.choice(queries)

    if SERPAPI_KEY:
        leads = await _hunt_google(query, 10)
        sb    = get_supabase()
        added = 0
        for lead in leads:
            try:
                if lead.get("domain"):
                    existing = sb.table("leads").select("id").eq("domain", lead["domain"]).execute()
                    if existing.data:
                        continue
                lead["source"]   = "google"
                lead["xtix_id"]  = "XT-" + hashlib.md5(lead.get("name", "").encode()).hexdigest()[:6].upper()
                sb.table("leads").insert(lead).execute()
                added += 1
            except Exception:
                pass
        print(f"[Scheduler] Hunt done — added {added} leads", flush=True)

async def job_run_campaigns():
    """כל 30 דקות — הרץ צעד הבא בקמפיינים פעילים"""
    print("[Scheduler] 📧 Running campaigns...", flush=True)
    try:
        sb  = get_supabase()
        now = datetime.now(timezone.utc)

        # Get active campaigns that need action
        campaigns = sb.table("campaigns").select("*").eq("status", "active").lte("next_action", now.isoformat()).execute()

        for campaign in (campaigns.data or []):
            lead_id  = campaign["lead_id"]
            steps    = campaign.get("steps", [])
            curr     = campaign.get("current_step", 0)

            if curr >= len(steps):
                sb.table("campaigns").update({"status": "completed"}).eq("id", campaign["id"]).execute()
                continue

            step = steps[curr]
            lead_res = sb.table("leads").select("*").eq("id", lead_id).execute()
            if not lead_res.data:
                continue

            await _run_campaign_step(campaign["id"], lead_res.data[0], step)

            # Set next action time
            next_step_idx = curr + 1
            if next_step_idx < len(steps):
                delay = steps[next_step_idx].get("delay_days", 3)
                next_action = now.replace(hour=9, minute=0, second=0)
                next_action = next_action.isoformat()
                sb.table("campaigns").update({
                    "current_step": next_step_idx,
                    "next_action":  next_action,
                }).eq("id", campaign["id"]).execute()
            else:
                sb.table("campaigns").update({"status": "completed"}).eq("id", campaign["id"]).execute()

    except Exception as e:
        print(f"[Scheduler] Campaigns error: {e}", flush=True)

async def job_weekly_learn():
    """כל יום שני — ניתוח שבועי עם Claude"""
    print("[Scheduler] 🔬 Weekly learning analysis...", flush=True)
    try:
        sb = get_supabase()

        # Get stats
        patterns = sb.table("learning_patterns").select("*").order("created_at", desc=True).limit(100).execute()
        weights  = sb.table("scoring_weights").select("*").eq("is_current", True).limit(1).execute()

        data = patterns.data or []
        won  = [p for p in data if p["outcome"] == "closed"]
        lost = [p for p in data if p["outcome"] == "lost"]

        if not data:
            print("[Scheduler] No data for weekly analysis", flush=True)
            return

        w_data   = weights.data[0] if weights.data else {}
        accuracy = w_data.get("accuracy", 0)

        prompt = f"""אתה מנוע הלמידה של ANDY — מערכת מכירות XTIX Events.
נתח את ביצועי השבוע האחרון וספק המלצות.

נתונים:
- סה"כ עסקאות שנלמדו: {len(data)}
- נסגרו: {len(won)}
- לא נסגרו: {len(lost)}
- דיוק AI: {accuracy}%
- סגמנטים מנצחים: {list(set(p.get('segment','') for p in won))[:5]}

משקלות נוכחיות: {json.dumps(w_data.get('weights', {}), ensure_ascii=False)}

ספק ניתוח ב-JSON בלבד:
{{
  "overall_assessment": "הערכה כללית",
  "top_insight": "תובנה עיקרית",
  "suggested_weight_change": {{"parameter": "שם", "direction": "up/down", "reason": "סיבה"}},
  "next_action": "פעולה הבאה",
  "confidence_score": 0-100,
  "recommendations": ["המלצה 1", "המלצה 2", "המלצה 3"]
}}"""

        if not ANTHROPIC_API_KEY:
            return

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": "claude-haiku-4-5-20251001", "max_tokens": 800,
                      "messages": [{"role": "user", "content": prompt}]}
            )
            text = resp.json().get("content", [{}])[0].get("text", "")

        s = text.find("{"); e = text.rfind("}") + 1
        if s >= 0 and e > s:
            analysis = json.loads(text[s:e])

            # Apply suggested weight change
            if w_data and analysis.get("suggested_weight_change"):
                change = analysis["suggested_weight_change"]
                param  = change.get("parameter", "")
                direction = change.get("direction", "")
                weights_dict = w_data.get("weights", {})
                if param in weights_dict:
                    delta = 0.02 if direction == "up" else -0.02
                    weights_dict[param] = round(max(0.01, min(0.40, weights_dict[param] + delta)), 4)
                    total = sum(weights_dict.values())
                    weights_dict = {k: round(v / total, 4) for k, v in weights_dict.items()}
                    sb.table("scoring_weights").update({"weights": weights_dict}).eq("id", w_data["id"]).execute()

            # Save to improvement_log
            sb.table("improvement_log").insert({
                "analysis_type":  "weekly",
                "overall_score":  analysis.get("confidence_score", 0),
                "insights":       [analysis.get("top_insight", "")],
                "recommendations": analysis.get("recommendations", []),
                "weight_changes": [analysis.get("suggested_weight_change", {})],
                "raw_analysis":   json.dumps(analysis, ensure_ascii=False),
            }).execute()

            print(f"[Scheduler] ✅ Weekly analysis done — confidence: {analysis.get('confidence_score')}%", flush=True)

    except Exception as e:
        print(f"[Scheduler] Weekly learn error: {e}", flush=True)

# ══════════════════════════════════════════════════════════
# LEADS CRUD (for index.html)
# ══════════════════════════════════════════════════════════

@app.get("/brain/leads")
async def get_leads(status: Optional[str] = None, segment: Optional[str] = None, limit: int = 100):
    """קבל לידים מ-Supabase"""
    sb    = get_supabase()
    query = sb.table("leads").select("*").order("created_at", desc=True).limit(limit)
    if status:  query = query.eq("status", status)
    if segment: query = query.eq("segment", segment)
    res = query.execute()
    return {"ok": True, "leads": res.data, "total": len(res.data)}

@app.post("/brain/leads")
async def create_lead(lead: LeadIn):
    """הוסף ליד ל-Supabase"""
    sb = get_supabase()
    data = lead.model_dump()
    data["xtix_id"] = "XT-" + hashlib.md5(lead.name.encode()).hexdigest()[:6].upper()

    # Dedup
    if lead.domain:
        existing = sb.table("leads").select("id").eq("domain", lead.domain).execute()
        if existing.data:
            return {"ok": False, "message": "Lead with this domain already exists", "id": existing.data[0]["id"]}

    res = sb.table("leads").insert(data).execute()
    return {"ok": True, "lead": res.data[0]}

@app.put("/brain/leads/{lead_id}")
async def update_lead(lead_id: str, body: dict):
    """עדכן ליד"""
    sb = get_supabase()
    body["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = sb.table("leads").update(body).eq("id", lead_id).execute()
    return {"ok": True, "lead": res.data[0] if res.data else {}}

# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"""
╔══════════════════════════════════════════╗
║       ANDY BRAIN v2.0 — Starting        ║
║       Port: {port:<30}║
║       Supabase: {'✅' if SUPABASE_URL else '❌':<28}║
║       Claude:   {'✅' if ANTHROPIC_API_KEY else '❌':<28}║
║       OpenAI:   {'✅' if OPENAI_API_KEY else '❌':<28}║
║       SerpAPI:  {'✅' if SERPAPI_KEY else '❌':<28}║
╚══════════════════════════════════════════╝
    """)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
