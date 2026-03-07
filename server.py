#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XTIX CRM — Full Stack Server v2.1 — KB /kb/run (no SA)
הרצה:  python server.py
פתח:   xtix-crm.html בדפדפן
עצירה: Ctrl+C
"""

import json, re, ssl, os, csv, io, smtplib, datetime, threading, time, collections, base64, hashlib, hmac
import urllib.request, urllib.parse

# ══════════════════════════════════════════════════════════════════
#  KNOWLEDGE BASE — Background Learning Engine
#  Client sends KB docs + decisions → server synthesizes with Claude
#  → returns insights JSON → client writes to Firebase (no SA needed)
# ══════════════════════════════════════════════════════════════════

FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', 'xtix-crm')

# In-memory cache — client uploads KB docs + decisions via /kb/run
_kb_cache = {
    'knowledge_base': [],
    'ai_decisions':   [],
    'last_updated':   None,
}
# Last insights result — stored in memory, returned to client
_kb_last_insights = None
_kb_job_running   = False

def _call_claude_background(system_prompt, user_prompt, max_tokens=2000):
    """Call Anthropic Claude directly from server (no auth needed — internal)."""
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        return None
    try:
        payload = json.dumps({
            'model': 'claude-haiku-4-5-20251001',
            'max_tokens': max_tokens,
            'system': system_prompt,
            'messages': [{'role': 'user', 'content': user_prompt}]
        }).encode()
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01'
            }, method='POST')
        with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=120) as r:
            result = json.loads(r.read())
        return result.get('content', [{}])[0].get('text', '')
    except Exception as e:
        print(f'[KB] Claude call failed: {e}', flush=True)
        return None

def _kb_learning_job():
    """
    Background job — runs every 6 hours.
    1. Reads knowledge_base collection via Firebase REST (needs SA key) OR
       returns insights JSON for client to write (no SA key needed).
    2. Reads recent ai_decisions
    3. Asks Claude to synthesize insights
    4. Returns insights dict (client writes to Firebase)
    """
    print(f'\n[KB] ══ Background Learning Job started — {datetime.datetime.now().isoformat()} ══', flush=True)

    # ── Step 1: Load KB docs passed from client (no SA needed) ──
    # kb_docs and decisions are passed in via /kb/run endpoint
    # This function now accepts optional data or reads from in-memory cache
    kb_docs   = _kb_cache.get('knowledge_base', [])
    decisions = _kb_cache.get('ai_decisions', [])

    kb_ready = [d for d in kb_docs if d.get('status') == 'ready' and d.get('content')]
    if not kb_ready:
        print(f'[KB] No ready KB docs in cache — skipping.', flush=True)
        return None

    print(f'[KB] {len(kb_ready)} KB docs, {len(decisions)} decisions', flush=True)

    decisions_with_outcome = [d for d in decisions if d.get('outcome') and d.get('meta_score')]
    decisions_recent       = sorted(decisions, key=lambda x: x.get('timestamp',''), reverse=True)[:30]

    # ── Step 2: Build KB context ──
    kb_text = '\n\n'.join([
        f"[{d.get('title','מקור')}]\n{str(d.get('content',''))[:1500]}"
        for d in kb_ready[:10]
    ])

    # ── Step 3: Build outcomes summary ──
    outcomes_summary = ''
    if decisions_with_outcome:
        closed_won  = [d for d in decisions_with_outcome if d.get('outcome') == 'נסגר']
        closed_lost = [d for d in decisions_with_outcome if d.get('outcome') == 'לא נסגר']
        outcomes_summary = f"""
ניתוחי עבר עם תוצאות ({len(decisions_with_outcome)} סה"כ):
נסגרו ({len(closed_won)}): {', '.join([f"{d.get('lead_name','')} (ציון:{d.get('meta_score','?')})" for d in closed_won[:10]])}
לא נסגרו ({len(closed_lost)}): {', '.join([f"{d.get('lead_name','')} (ציון:{d.get('meta_score','?')})" for d in closed_lost[:10]])}

דפוסים בציונים:
- ממוצע ניצחון: {round(sum(int(d.get('meta_score',0)) for d in closed_won)/max(len(closed_won),1))}
- ממוצע כישלון: {round(sum(int(d.get('meta_score',0)) for d in closed_lost)/max(len(closed_lost),1))}
- פלטפורמות שנסגרו: {', '.join(set(d.get('platform','') for d in closed_won if d.get('platform')))}
"""

    recent_summary = '\n'.join([
        f"- {d.get('lead_name','')} | ציון:{d.get('meta_score','?')} | cadence:{d.get('recommended_cadence','?')} | תוצאה:{d.get('outcome','לא ידוע')}"
        for d in decisions_recent[:20]
    ])

    # ── Step 4: Claude synthesis ──
    system = """אתה מנוע למידה של מערכת CRM לתחום הופעות ואירועים בישראל.
תפקידך: לנתח מידע מתודולוגי ממקורות ידע + ניתוחי עבר של לידים → ולייצר insights מעשיים.
ה-insights שתייצר ישמשו את ה-Meta-Judge בניתוחים הבאים.
ענה אך ורק ב-JSON תקני. עברית בלבד."""

    user = f"""
=== מקורות ידע (מתודולוגיה, מאמרים, טון מכירות) ===
{kb_text}

=== ניתוחי עבר עם תוצאות ===
{outcomes_summary}

=== ניתוחים אחרונים ===
{recent_summary}

בהתבסס על מקורות הידע וניתוחי העבר, ייצר insights מעשיים שיעזרו ל-Meta-Judge.
החזר JSON בדיוק:
{{
  "sales_methodology_summary": "סיכום 3-4 משפטים של המתודולוגיה המרכזית שלמדת מהמקורות",
  "winning_patterns": ["דפוס ניצחון 1", "דפוס ניצחון 2", "דפוס ניצחון 3"],
  "losing_patterns": ["דפוס כישלון 1", "דפוס כישלון 2"],
  "score_calibration": "הנחיה לכיול ציונים לפי ניתוחי עבר",
  "cadence_rules": {{"hot": "מתי hot", "warm": "מתי warm", "cool": "מתי cool"}},
  "tone_guidelines": "הנחיות טון ושפה לנציג מכירות",
  "key_objections": ["התנגדות נפוצה 1 + תגובה", "התנגדות נפוצה 2 + תגובה"],
  "meta_judge_instructions": "הנחיות ישירות ל-Meta-Judge: מה לתת עדיפות, מה לבדוק, מה להזהיר",
  "platform_intelligence": {{"SmarTicket": "מה למדנו", "Mevalim": "מה למדנו"}},
  "generated_at": "{datetime.datetime.now().isoformat()}",
  "kb_sources_count": {len(kb_ready)},
  "decisions_analyzed": {len(decisions_with_outcome)}
}}"""

    print('[KB] Calling Claude for synthesis...', flush=True)
    raw = _call_claude_background(system, user, max_tokens=2500)
    if not raw:
        print('[KB] Claude returned empty — aborting.', flush=True)
        return None

    # ── Step 5: Parse — strip markdown fences ──
    import re as _re
    def _clean_and_parse(text):
        text = _re.sub(r'```json', '', text)
        text = _re.sub(r'```', '', text)
        text = text.strip()
        s = text.find('{'); e = text.rfind('}')
        if s == -1: raise ValueError('No JSON object found')
        return json.loads(text[s:e+1])

    try:
        insights = _clean_and_parse(raw)
    except Exception as ex:
        print('[KB] JSON parse failed: ' + str(ex) + ' — retrying', flush=True)
        retry_u = 'תקן את ה-JSON הבא ללא markdown:\n' + raw[:2000]
        raw2 = _call_claude_background('ענה רק ב-JSON תקני. ללא backticks.', retry_u, max_tokens=3000)
        try:
            insights = _clean_and_parse(raw2 or '')
            print('[KB] Retry parse succeeded', flush=True)
        except Exception as ex2:
            print('[KB] Retry also failed: ' + str(ex2), flush=True)
            insights = {
                'sales_methodology_summary': 'שגיאת parse — נסה שוב',
                'parse_error': str(ex)
            }

    # Stamp metadata
    insights['generated_at']       = datetime.datetime.now().isoformat()
    insights['kb_sources_count']   = len(kb_ready)
    insights['decisions_analyzed'] = len(decisions_with_outcome)
    insights['version']            = f'v{int(time.time())}'

    print(f'[KB] ✅ Insights ready — {len(kb_ready)} KB sources, {len(decisions_with_outcome)} outcomes', flush=True)
    print(f'[KB] ══ Job complete — {datetime.datetime.now().isoformat()} ══\n', flush=True)

    # Return insights — CLIENT writes to Firebase (no SA key needed)
    return insights

def _kb_scheduler_loop():
    """
    Every 6 hours: checks if client has uploaded fresh KB data.
    If yes — runs synthesis job and stores result in memory.
    Client polls /kb/poll to get result and writes to Firebase.
    """
    time.sleep(120)  # wait 2min after startup
    while True:
        try:
            if _kb_cache['knowledge_base']:
                print('[KB] Scheduler: running job...', flush=True)
                result = _kb_learning_job()
                if result:
                    global _kb_last_insights
                    _kb_last_insights = result
                    print('[KB] Scheduler: insights ready for client pickup', flush=True)
            else:
                print('[KB] Scheduler: no KB data yet — waiting for client upload', flush=True)
        except Exception as e:
            print(f'[KB] Scheduler crashed: {e}', flush=True)
        time.sleep(6 * 60 * 60)


from http.server import HTTPServer, BaseHTTPRequestHandler
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ── Firebase Token Verifier ─────────────────────────────────────────────────
# Verifies Firebase ID Tokens (JWT) using Google's public keys
# No external dependencies — pure stdlib

FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', 'xtix-crm')
_google_certs = {}          # cache: {kid: public_key_pem}
_google_certs_expiry = 0    # unix timestamp
_certs_lock = threading.Lock()

def _fetch_google_certs():
    """Fetch Firebase public keys from Google (cached 1 hour)."""
    global _google_certs, _google_certs_expiry
    with _certs_lock:
        if time.time() < _google_certs_expiry:
            return _google_certs
        try:
            url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as r:
                _google_certs = json.loads(r.read().decode('utf-8'))
                _google_certs_expiry = time.time() + 3600  # cache 1 hour
                print(f'[Auth] Google certs refreshed ({len(_google_certs)} keys)', flush=True)
        except Exception as e:
            print(f'[Auth] Failed to fetch Google certs: {e}', flush=True)
        return _google_certs

def _b64_decode(s):
    """Base64url decode without padding."""
    s = s.replace('-', '+').replace('_', '/')
    s += '=' * (4 - len(s) % 4)
    return base64.b64decode(s)

def _verify_firebase_token(id_token):
    """
    Verify Firebase ID Token.
    Returns (uid, email, decoded_payload) on success.
    Raises ValueError with reason on failure.
    """
    # Step 1: decode header (no verify yet)
    try:
        parts = id_token.split('.')
        if len(parts) != 3:
            raise ValueError('Invalid JWT format')
        header  = json.loads(_b64_decode(parts[0]))
        payload = json.loads(_b64_decode(parts[1]))
    except Exception as e:
        raise ValueError(f'JWT decode failed: {e}')

    # Step 2: basic payload checks
    now = time.time()
    if payload.get('aud') != FIREBASE_PROJECT_ID:
        raise ValueError(f'Wrong audience: {payload.get("aud")}')
    if payload.get('iss') != f'https://securetoken.google.com/{FIREBASE_PROJECT_ID}':
        raise ValueError('Wrong issuer')
    if payload.get('exp', 0) < now:
        raise ValueError('Token expired')
    if payload.get('iat', 0) > now + 300:
        raise ValueError('Token issued in future')
    if not payload.get('sub'):
        raise ValueError('Missing subject (uid)')

    # Step 3: verify signature using Google public key
    try:
        import cryptography
        HAS_CRYPTO = True
    except ImportError:
        HAS_CRYPTO = False

    if HAS_CRYPTO:
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import padding
            from cryptography.x509 import load_pem_x509_certificate
            from cryptography.hazmat.backends import default_backend

            kid = header.get('alg_kid') or header.get('kid')
            certs = _fetch_google_certs()
            if kid not in certs:
                raise ValueError(f'Unknown key id: {kid}')

            cert_pem = certs[kid].encode('utf-8')
            cert = load_pem_x509_certificate(cert_pem, default_backend())
            pub_key = cert.public_key()

            msg = f'{parts[0]}.{parts[1]}'.encode('utf-8')
            sig = _b64_decode(parts[2])
            pub_key.verify(sig, msg, padding.PKCS1v15(), hashes.SHA256())
        except Exception as e:
            raise ValueError(f'Signature verification failed: {e}')
    else:
        # Fallback: verify token online via Firebase REST API
        # (less secure but works without cryptography package)
        try:
            verify_url = f'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={os.environ.get("FIREBASE_WEB_API_KEY","")}'
            vreq = urllib.request.Request(
                verify_url,
                data=json.dumps({'idToken': id_token}).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(vreq, context=ssl_ctx, timeout=10) as r:
                vdata = json.loads(r.read().decode('utf-8'))
                if 'error' in vdata:
                    raise ValueError(vdata['error'].get('message', 'Invalid token'))
                users = vdata.get('users', [])
                if not users:
                    raise ValueError('User not found')
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f'Online verification failed: {e}')

    uid   = payload.get('sub')
    email = payload.get('email', '')
    return uid, email, payload

# Token cache — avoid verifying same token repeatedly (tokens valid 60 min)
_token_cache = {}   # token_hash -> (uid, email, role, expiry)
_token_cache_lock = threading.Lock()

def _get_token_from_cache(id_token):
    h = hashlib.sha256(id_token.encode()).hexdigest()
    with _token_cache_lock:
        entry = _token_cache.get(h)
        if entry and entry['expiry'] > time.time():
            return entry
        if h in _token_cache:
            del _token_cache[h]
    return None

def _set_token_cache(id_token, uid, email, role):
    h = hashlib.sha256(id_token.encode()).hexdigest()
    with _token_cache_lock:
        _token_cache[h] = {'uid': uid, 'email': email, 'role': role, 'expiry': time.time() + 300}
        # Prune old entries
        if len(_token_cache) > 500:
            now = time.time()
            keys = [k for k,v in _token_cache.items() if v['expiry'] < now]
            for k in keys: del _token_cache[k]

def _fetch_user_role_from_firestore(uid, id_token):
    """Fetch user role from Firestore REST API using the user's own ID token."""
    try:
        fs_url = f'https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/users/{uid}'
        req = urllib.request.Request(fs_url, headers={'Authorization': 'Bearer ' + id_token})
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
            fields = data.get('fields', {})
            role = fields.get('role', {}).get('stringValue', '')
            return role
    except Exception as e:
        print(f'[Auth] Role fetch failed for {uid}: {e}', flush=True)
        return None


def _verify_supabase_token(id_token):
    """Verify Supabase JWT by calling /auth/v1/user endpoint."""
    SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ugluksyfpfgzbpmayodg.supabase.co')
    SUPABASE_ANON = os.environ.get('SUPABASE_ANON_KEY', '')
    try:
        req = urllib.request.Request(
            SUPABASE_URL + '/auth/v1/user',
            headers={
                'apikey': SUPABASE_ANON,
                'Authorization': 'Bearer ' + id_token,
            }
        )
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
            if data.get('id'):
                return data
            return None
    except Exception as e:
        print(f'[Auth] Supabase token verify failed: {e}', flush=True)
        return None


def _fetch_user_role_from_supabase(uid):
    """Fetch user role from public.users table in Supabase."""
    SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ugluksyfpfgzbpmayodg.supabase.co')
    SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
    try:
        url = SUPABASE_URL + '/rest/v1/users?id=eq.' + uid + '&select=role&limit=1'
        req = urllib.request.Request(
            url,
            headers={
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
            }
        )
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=8) as r:
            rows = json.loads(r.read().decode('utf-8'))
            if rows and rows[0].get('role'):
                return rows[0]['role']
            return None
    except Exception as e:
        print(f'[Auth] Supabase role fetch failed for {uid}: {e}', flush=True)
        return None


# ── Rate Limiter ────────────────────────────────────────────────────────────
# Tracks requests per IP per endpoint, resets every window_seconds
class RateLimiter:
    def __init__(self):
        self._lock   = threading.Lock()
        self._counts = {}  # (ip, endpoint) -> deque of timestamps

    # Returns (allowed: bool, remaining: int, retry_after: int)
    def check(self, ip, endpoint, limit, window_seconds=60):
        key = (ip, endpoint)
        now = time.time()
        with self._lock:
            if key not in self._counts:
                self._counts[key] = collections.deque()
            dq = self._counts[key]
            # Remove old timestamps outside window
            while dq and dq[0] < now - window_seconds:
                dq.popleft()
            if len(dq) >= limit:
                retry_after = int(window_seconds - (now - dq[0])) + 1
                return False, 0, retry_after
            dq.append(now)
            return True, limit - len(dq), 0

_limiter = RateLimiter()

# Rate limits per endpoint (requests per 60 seconds per IP)
RATE_LIMITS = {
    '/ai':      20,   # Claude — expensive, limit tightly
    '/gpt':     20,   # GPT
    '/gemini':  30,   # Gemini — cheaper
    '/analyze': 30,   # Website analyzer
    '/send-email': 10, # Email sending
    'default':  120,  # All other endpoints
}

PORT           = int(os.environ.get('PORT', 8765))
CONFIG_FILE    = os.path.join(os.path.dirname(__file__), 'xtix_config.json')
REMINDERS_FILE = os.path.join(os.path.dirname(__file__), 'xtix_reminders.json')
LEADS_FILE     = os.path.join(os.path.dirname(__file__), 'xtix_leads.json')
CLAY_PENDING_FILE = os.path.join(os.path.dirname(__file__), 'xtix_clay_pending.json')

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode    = ssl.CERT_NONE

TICKET_PLATFORMS = {
    'smarticket':'SmarTicket','mevalim':'Mevalim','bravo':'Bravo',
    'leaan':'Leaan','tickchak':'Tickchak','eventer':'Eventer',
    'easytix':'Easytix','eventbrite':'Eventbrite','ticketmaster':'Ticketmaster',
    'eventim':'Eventim','lineapp':'Lineapp','eventobot':'Eventobot',
    'zygo':'Zygo','glatticket':'Glatticket',
}
SOCIAL_PATTERNS = {
    'facebook.com':'Facebook','instagram.com':'Instagram','linkedin.com':'LinkedIn',
    'youtube.com':'YouTube','tiktok.com':'TikTok','twitter.com':'Twitter/X',
}

# ── Config ─────────────────────────────────────────────────────────────────
def load_config():
    # Railway: read from environment variables first
    env_cfg = {
        'gmail_user':         os.environ.get('GMAIL_USER', ''),
        'gmail_app_password': os.environ.get('GMAIL_APP_PASSWORD', ''),
        'hubspot_token':      os.environ.get('HUBSPOT_TOKEN', ''),
        'sender_name':        os.environ.get('SENDER_NAME', 'XTIX Sales'),
    }
    if any(env_cfg.values()):
        # Merge with file config if exists
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE,'r',encoding='utf-8') as f:
                    file_cfg = json.load(f)
                    for k,v in file_cfg.items():
                        if not env_cfg.get(k): env_cfg[k] = v
            except: pass
        return env_cfg
    # Fallback: local file
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE,'r',encoding='utf-8') as f: return json.load(f)
        except: pass
    return {'gmail_user':'','gmail_app_password':'','hubspot_token':'','sender_name':'XTIX Sales'}

def save_config(cfg):
    with open(CONFIG_FILE,'w',encoding='utf-8') as f: json.dump(cfg,f,ensure_ascii=False,indent=2)

def load_reminders():
    if os.path.exists(REMINDERS_FILE):
        try:
            with open(REMINDERS_FILE,'r',encoding='utf-8') as f: return json.load(f)
        except: pass
    return []

def save_reminders(r):
    with open(REMINDERS_FILE,'w',encoding='utf-8') as f: json.dump(r,f,ensure_ascii=False,indent=2)

# ── URL Analyzer ───────────────────────────────────────────────────────────

def load_leads_file():
    if os.path.exists(LEADS_FILE):
        try:
            with open(LEADS_FILE,'r',encoding='utf-8') as f: return json.load(f)
        except: pass
    return None  # None means "no file yet, use defaults"

def save_leads_file(leads):
    with open(LEADS_FILE,'w',encoding='utf-8') as f: json.dump(leads,f,ensure_ascii=False,indent=2)

def load_clay_pending():
    if os.path.exists(CLAY_PENDING_FILE):
        try:
            with open(CLAY_PENDING_FILE,'r',encoding='utf-8') as f: return json.load(f)
        except: pass
    return []

def save_clay_pending(leads):
    with open(CLAY_PENDING_FILE,'w',encoding='utf-8') as f: json.dump(leads,f,ensure_ascii=False,indent=2)


# ════════════════════════════════════════════════════════
# WEBHOOK — unified lead intake (Clay, API, Zapier, etc.)
# ════════════════════════════════════════════════════════
WEBHOOK_FILE = os.path.join(os.path.dirname(__file__), 'webhook_pending.json')

def load_webhook_pending():
    try:
        if os.path.exists(WEBHOOK_FILE):
            return json.load(open(WEBHOOK_FILE, encoding='utf-8'))
    except: pass
    return []

def save_webhook_pending(leads):
    json.dump(leads, open(WEBHOOK_FILE, 'w', encoding='utf-8'), ensure_ascii=False)

def analyze_website(url):
    result = {'url':url,'hasDomain':True,'hasExternalTicketing':False,'ticketPlatform':'',
              'hasActiveSocial':False,'socialLinks':[],'email':'','title':'','phone':'',
              'autoScore':0,'autoAnswers':{},'error':None}
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
        hl = html.lower()
        m = re.search(r'<title[^>]*>(.*?)</title>',html,re.I|re.S)
        if m: result['title'] = m.group(1).strip()[:80]
        for k,v in TICKET_PLATFORMS.items():
            if k in hl: result['hasExternalTicketing']=True; result['ticketPlatform']=v; break
        for d,n in SOCIAL_PATTERNS.items():
            if d in hl: result['hasActiveSocial']=True; result['socialLinks'].append(n)
        emails = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',html)
        emails = [e for e in emails if not any(x in e.lower() for x in ['example','noreply','no-reply','@w3','schema'])]
        if emails: result['email'] = emails[0]
        phones = re.findall(r'0[2-9][0-9\-\s]{7,10}',html)
        if phones: result['phone'] = phones[0].strip()
        # Auto-score
        score=0; answers={}
        has_nav = bool(re.search(r'<nav|<header|navbar',hl))
        answers['q_domain']='2' if has_nav else '1'; score+=20 if has_nav else 10
        if result['hasExternalTicketing']: answers['q_platform']='2'; score+=15
        else: answers['q_platform']='0'
        ec = len(re.findall(r'event|show|concert|performance|concert',hl))
        if ec>=6: answers['q_freq']='3'; score+=15
        elif ec>=2: answers['q_freq']='2'; score+=10
        elif ec>=1: answers['q_freq']='1'; score+=5
        else: answers['q_freq']='0'
        sizes = re.findall(r'(\d{3,4})\s*(seats|tickets)',hl)
        if sizes:
            n = max(int(s[0]) for s in sizes)
            if n>=500: answers['q_size']='3'; score+=10
            elif n>=100: answers['q_size']='2'; score+=7
            else: answers['q_size']='1'; score+=4
        else: answers['q_size']='1'; score+=4
        if len(result['socialLinks'])>=2: answers['q_social']='2'; score+=10
        elif result['socialLinks']: answers['q_social']='1'; score+=5
        else: answers['q_social']='0'
        if result['email']: answers['q_contact']='2'; score+=10
        else: answers['q_contact']='0'
        urgent = bool(re.search(r'upcoming|soon|\d{1,2}[./]\d{1,2}[./]2[0-9]',hl))
        if urgent: answers['q_urgency']='2'; score+=10
        else: answers['q_urgency']='0'
        if re.search(r'theatre|music|concert|opera',hl): answers['q_segment']='3'; score+=10
        elif re.search(r'comedy|sport|standup',hl): answers['q_segment']='2'; score+=7
        else: answers['q_segment']='1'; score+=4
        result['autoScore']=min(score,100); result['autoAnswers']=answers
    except Exception as e: result['error']=str(e)
    return result

# ── Gmail ──────────────────────────────────────────────────────────────────
def send_gmail(cfg, to_email, subject, body_html, body_text=''):
    u = cfg.get('gmail_user',''); p = cfg.get('gmail_app_password','')
    print(f'  [EMAIL] to={to_email} user={u} pass_set={bool(p)}', flush=True)
    if not u or not p: return {'ok':False,'error':'Gmail not configured. Open Settings in CRM.'}
    msg = MIMEMultipart('alternative')
    msg['Subject']=subject; msg['From']=f"{cfg.get('sender_name','XTIX')} <{u}>"; msg['To']=to_email
    if body_text: msg.attach(MIMEText(body_text,'plain','utf-8'))
    msg.attach(MIMEText(body_html,'html','utf-8'))
    try:
        print('  [EMAIL] Connecting SMTP...', flush=True)
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=25) as s:
            print('  [EMAIL] Login...', flush=True)
            s.login(u,p)
            print('  [EMAIL] Sending...', flush=True)
            s.sendmail(u,to_email,msg.as_string())
        print(f'  [EMAIL] SUCCESS', flush=True)
        return {'ok':True,'message':f'נשלח ל-{to_email}'}
    except smtplib.SMTPAuthenticationError as e:
        print(f'  [EMAIL] AUTH ERROR: {e}', flush=True)
        return {'ok':False,'error':'Gmail auth failed — check App Password in CRM Settings'}
    except Exception as e:
        print(f'  [EMAIL] ERROR: {e}', flush=True)
        return {'ok':False,'error':str(e)}

# ── HubSpot ────────────────────────────────────────────────────────────────
HUBSPOT_API = 'https://api.hubapi.com'
STATUS_MAP  = {'new':'NEW','contacted':'OPEN','followup':'IN_PROGRESS','meeting':'OPEN_DEAL','closed':'CONNECTED'}

def hs_req(method, path, token, data=None):
    url  = HUBSPOT_API+path
    body = json.dumps(data).encode('utf-8') if data else None
    req  = urllib.request.Request(url,data=body,headers={'Authorization':f'Bearer {token}','Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as r:
        return json.loads(r.read().decode('utf-8'))

def sync_lead(lead, token):
    props = {
        'firstname': lead.get('name','').split()[0] if lead.get('name') else '',
        'lastname':  ' '.join(lead.get('name','').split()[1:]),
        'email':     lead.get('email','') or f"noemail_{lead['id']}@xtix-crm.local",
        'website':   lead.get('domain',''),
        'company':   lead.get('name',''),
        'hs_lead_status': STATUS_MAP.get(lead.get('status','new'),'NEW'),
        'description': f"XTIX CRM | Score:{lead.get('score',0)}/100 | {lead.get('platform','')}",
        'phone':     lead.get('phone',''),
    }
    props = {k:v for k,v in props.items() if v}
    existing_id = None
    email = props.get('email','')
    if '@' in email and 'xtix-crm.local' not in email:
        try:
            r = hs_req('POST','/crm/v3/objects/contacts/search',token,{
                'filterGroups':[{'filters':[{'propertyName':'email','operator':'EQ','value':email}]}],
                'properties':['email','hs_object_id']})
            if r.get('total',0)>0: existing_id = r['results'][0]['id']
        except: pass
    if existing_id:
        hs_req('PATCH',f'/crm/v3/objects/contacts/{existing_id}',token,{'properties':props})
        return {'ok':True,'action':'updated','hubspot_id':existing_id}
    else:
        r = hs_req('POST','/crm/v3/objects/contacts',token,{'properties':props})
        return {'ok':True,'action':'created','hubspot_id':r.get('id','')}

def log_email_hs(hid, subject, body, token):
    now_ms = int(datetime.datetime.now().timestamp()*1000)
    data = {'engagement':{'active':True,'type':'EMAIL','timestamp':now_ms},
            'associations':{'contactIds':[int(hid)]},
            'metadata':{'subject':subject,'html':body}}
    try: hs_req('POST','/engagements/v1/engagements',token,data); return {'ok':True}
    except Exception as e: return {'ok':False,'error':str(e)}

# ── CSV ────────────────────────────────────────────────────────────────────
def to_csv(leads):
    out = io.StringIO()
    w = csv.DictWriter(out,fieldnames=['id','name','domain','type','platform','email','phone','score','status','notes'],extrasaction='ignore')
    w.writeheader(); [w.writerow(l) for l in leads]
    return out.getvalue()

# ── HTTP Handler ───────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*a): print(f'[{datetime.datetime.now().strftime("%H:%M:%S")}] {a[0]} {a[1]}')

    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type,Authorization')

    def json_out(self,data,status=200):
        b=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.cors()
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length', 0))
        if n > 512_000:  # 512KB max
            self.json_out({'error': 'בקשה גדולה מדי (מקסימום 512KB)', 'code': 'payload_too_large'}, 413)
            return None
        return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}

    def do_OPTIONS(self):
        self.send_response(200); self.cors(); self.end_headers()

    def get_ip(self):
        xff = self.headers.get('X-Forwarded-For', '')
        if xff:
            return xff.split(',')[0].strip()
        return self.client_address[0]

    def auth_check(self, required_role='sales'):
        """
        Verify Supabase JWT from Authorization header.
        Returns {uid, email, role} on success, None on failure.
        required_role: 'sales' = sales+admin allowed, 'admin' = admin only
        """
        auth_header = self.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            self.json_out({'error': 'חסר Authorization header', 'code': 'missing_token'}, 401)
            return None

        id_token = auth_header[7:].strip()

        # Check cache first (5-min cache to avoid hammering Supabase)
        cached = _get_token_from_cache(id_token)
        if cached:
            uid, email, role = cached['uid'], cached['email'], cached['role']
        else:
            # Verify Supabase JWT by calling /auth/v1/user
            result = _verify_supabase_token(id_token)
            if not result:
                self.json_out({'error': 'Token לא תקף — נסה להתנתק ולהתחבר מחדש', 'code': 'invalid_token'}, 401)
                return None

            uid   = result.get('id', '')
            email = result.get('email', '')

            # Fetch role from public.users table in Supabase
            role = _fetch_user_role_from_supabase(uid)
            if not role:
                # Default to admin if no role found (first user / dev mode)
                role = 'admin'
                print(f'[Auth] No role found for {email} — defaulting to admin', flush=True)

            _set_token_cache(id_token, uid, email, role)

        # Check role
        if required_role == 'admin' and role != 'admin':
            self.json_out({'error': 'נדרשת הרשאת Admin', 'code': 'insufficient_role'}, 403)
            return None
        if required_role == 'sales' and role not in ('admin', 'sales'):
            self.json_out({'error': 'אין הרשאה לפעולה זו', 'code': 'insufficient_role'}, 403)
            return None

        return {'uid': uid, 'email': email, 'role': role}

    def rate_check(self, endpoint):
        ip    = self.get_ip()
        limit = RATE_LIMITS.get(endpoint, RATE_LIMITS['default'])
        allowed, remaining, retry_after = _limiter.check(ip, endpoint, limit)
        if not allowed:
            print(f'  [RATE] {ip} blocked on {endpoint} — retry in {retry_after}s', flush=True)
            self.json_out({
                'error': f'יותר מדי בקשות. נסה שוב בעוד {retry_after} שניות.',
                'retry_after': retry_after
            }, 429)
            return False
        return True

    def do_GET(self):
        p=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(p.query); cfg=load_config()

        # ── Serve CRM HTML file at root ──────────────────────────────
        if p.path == '/' or p.path == '/index.html':
            crm_file = os.path.join(os.path.dirname(__file__), 'index.html')
            if os.path.exists(crm_file):
                with open(crm_file, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_response(404); self.end_headers()
            return

        # ── Serve static JS files ────────────────────────────────────
        static_js = {
            '/supabase-client.js': 'supabase-client.js',
            '/ai-engine.js':       'ai-engine.js',
        }
        if p.path in static_js:
            js_file = os.path.join(os.path.dirname(__file__), static_js[p.path])
            if os.path.exists(js_file):
                with open(js_file, 'rb') as f:
                    js_content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(js_content)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(js_content)
            else:
                self.send_response(404); self.end_headers()
            return

        if p.path=='/ping':
            self.json_out({'status':'ok','version':'2.0','gmail':bool(cfg.get('gmail_user')),'hubspot':bool(cfg.get('hubspot_token'))})
        elif p.path=='/health':
            self.json_out({
                'status': 'ok',
                'claude':  bool(os.environ.get('ANTHROPIC_API_KEY','')),
                'openai':  bool(os.environ.get('OPENAI_API_KEY','')),
                'gemini':  bool(os.environ.get('GEMINI_API_KEY','')),
                'gmail':   bool(cfg.get('gmail_user','')),
                'hubspot': bool(cfg.get('hubspot_token','')),
            })
        elif p.path=='/analyze':
            if not self.auth_check('sales'): return
            if not self.rate_check('/analyze'): return
            url=q.get('url',[''])[0]
            if not url: self.json_out({'error':'Missing url'},400); return
            print(f'  Analyzing: {url}'); self.json_out(analyze_website(url))
        elif p.path=='/export/csv':
            if not self.auth_check('sales'): return
            raw=q.get('data',['[]'])[0]
            try: leads=json.loads(urllib.parse.unquote(raw))
            except: leads=[]
            csv_data=to_csv(leads).encode('utf-8-sig')
            self.send_response(200); self.cors()
            self.send_header('Content-Type','text/csv; charset=utf-8')
            self.send_header('Content-Disposition','attachment; filename="xtix-leads.csv"')
            self.send_header('Content-Length',str(len(csv_data))); self.end_headers(); self.wfile.write(csv_data)
        elif p.path=='/leads':
            if not self.auth_check('sales'): return
            data = load_leads_file()
            self.json_out({'ok': True, 'leads': data, 'exists': data is not None})
        elif p.path=='/reminders':
            if not self.auth_check('sales'): return
            self.json_out(load_reminders())
        elif p.path=='/clay-pending':
            if not self.auth_check('sales'): return
            self.json_out(load_clay_pending())
        elif p.path=='/webhook/pending':
            if not self.auth_check('sales'): return
            self.json_out({'leads': load_webhook_pending()})
        elif p.path=='/config':
            if not self.auth_check('admin'): return
            safe={k:('***' if any(x in k for x in ['password','token']) else v) for k,v in cfg.items()}
            self.json_out(safe)
        elif p.path=='/kb/insights':
            # Return latest insights from memory (populated by /kb/run)
            if not self.auth_check('sales'): return
            self.json_out({'ok': True, 'insights': _kb_last_insights})
        elif p.path=='/kb/poll':
            # Client polls after triggering job — returns result when ready
            if not self.auth_check('sales'): return
            self.json_out({
                'ok': True,
                'running': _kb_job_running,
                'insights': _kb_last_insights
            })
        elif p.path=='/kb/status':
            if not self.auth_check('sales'): return
            self.json_out({
                'ok': True,
                'kb_count': len(_kb_cache['knowledge_base']),
                'kb_ready': len([d for d in _kb_cache['knowledge_base'] if d.get('status')=='ready']),
                'has_insights': bool(_kb_last_insights),
                'insights_generated_at': _kb_last_insights.get('generated_at','') if _kb_last_insights else '',
                'decisions_with_outcome': len([d for d in _kb_cache['ai_decisions'] if d.get('outcome')]),
                'job_running': _kb_job_running,
            })
        elif p.path=='/kb/history':
            # Not supported without SA — return empty
            if not self.auth_check('sales'): return
            self.json_out({'ok': True, 'history': []})
        else:
            self.json_out({'error':'Not found'},404)

    def do_POST(self):
        p=urllib.parse.urlparse(self.path); b=self.body(); cfg=load_config()
        if b is None: return  # payload too large — response already sent

        if p.path=='/clay-import':
            # Receive leads from Clay and save to local leads file
            try:
                new_lead = {
                    'id':      int(datetime.datetime.now().timestamp() * 1000),
                    'name':    b.get('name', ''),
                    'domain':  b.get('website', '').replace('https://','').replace('http://','').split('/')[0],
                    'website': b.get('website', ''),
                    'phone':   b.get('phone', ''),
                    'address': b.get('address', ''),
                    'type':    b.get('type', 'Clay Import'),
                    'segment': b.get('segment', ''),
                    'email':   b.get('email', ''),
                    'platform':b.get('platform', ''),
                    'score':   int(b.get('score', 50)),
                    'status':  'new',
                    'notes':   f"Imported from Clay | {b.get('description','')}",
                    'source':  'clay',
                }
                domain = new_lead['domain']
                pending = load_clay_pending()
                if domain and any(l.get('domain') == domain for l in pending):
                    print(f'  [CLAY] Duplicate skipped: {new_lead["name"]}', flush=True)
                    self.json_out({'ok': True, 'action': 'skipped', 'name': new_lead['name']}); return
                pending.append(new_lead)
                save_clay_pending(pending)
                print(f'  [CLAY] Queued: {new_lead["name"]} ({domain})', flush=True)
                self.json_out({'ok': True, 'action': 'queued', 'id': new_lead['id'], 'name': new_lead['name']})
            except Exception as e:
                print(f'  [CLAY] Error: {e}', flush=True)
                self.json_out({'ok': False, 'error': str(e)}, 500)
            return

        if p.path=='/clay-pending-clear':
            if not self.auth_check('admin'): return
            save_clay_pending([])
            self.json_out({'ok': True})
            return

        if p.path=='/ai':
            if not self.auth_check('sales'): return
            if not self.rate_check('/ai'): return
            # Proxy to Anthropic API
            api_key = os.environ.get('ANTHROPIC_API_KEY','')
            if not api_key:
                self.json_out({'error':'ANTHROPIC_API_KEY not set in Railway Variables'},500); return
            try:
                payload = json.dumps(b).encode('utf-8')
                req = urllib.request.Request(
                    'https://api.anthropic.com/v1/messages',
                    data=payload,
                    headers={
                        'Content-Type': 'application/json',
                        'x-api-key': api_key,
                        'anthropic-version': '2023-06-01'
                    },
                    method='POST'
                )
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=90) as r:
                    result = json.loads(r.read().decode('utf-8'))
                self.json_out(result)
            except urllib.error.HTTPError as e:
                err = e.read().decode('utf-8')
                print(f'  [AI] HTTP Error {e.code}: {err[:300]}', flush=True)
                try:
                    err_json = json.loads(err)
                    msg = err_json.get('error',{}).get('message', err[:200])
                except:
                    msg = err[:200]
                self.json_out({'error': msg, 'status': e.code}, e.code)
            except Exception as e:
                print(f'  [AI] Error: {e}', flush=True)
                self.json_out({'error': str(e)}, 500)
            return
        if p.path=='/gpt':
            if not self.auth_check('sales'): return
            if not self.rate_check('/gpt'): return
            # Proxy to OpenAI API
            api_key = os.environ.get('OPENAI_API_KEY','')
            if not api_key:
                self.json_out({'error':'OPENAI_API_KEY not set in Railway Variables'},500); return
            try:
                payload = json.dumps(b).encode('utf-8')
                req = urllib.request.Request(
                    'https://api.openai.com/v1/chat/completions',
                    data=payload,
                    headers={
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + api_key,
                    },
                    method='POST'
                )
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=60) as r:
                    result = json.loads(r.read().decode('utf-8'))
                self.json_out(result)
            except urllib.error.HTTPError as e:
                err = e.read().decode('utf-8')
                print(f'  [GPT] HTTP Error {e.code}: {err}', flush=True)
                self.json_out({'error': err}, e.code)
            except Exception as e:
                print(f'  [GPT] Error: {e}', flush=True)
                self.json_out({'error': str(e)}, 500)
            return

        if p.path=='/gemini':
            if not self.auth_check('sales'): return
            if not self.rate_check('/gemini'): return
            # Proxy to Google Gemini API
            api_key = os.environ.get('GEMINI_API_KEY','')
            if not api_key:
                self.json_out({'error':'GEMINI_API_KEY not set in Railway Variables'},500); return
            try:
                model   = b.pop('model', 'gemini-2.0-flash')
                url     = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'
                payload = json.dumps(b).encode('utf-8')
                req = urllib.request.Request(url, data=payload,
                    headers={'Content-Type': 'application/json'}, method='POST')
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=30) as r:
                    result = json.loads(r.read().decode('utf-8'))
                self.json_out(result)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8')
                retry_after = e.headers.get('Retry-After', '') if e.headers else ''
                print(f'  [Gemini/{model}] HTTP {e.code}: {err_body[:150]}', flush=True)
                # Pass status code and Retry-After back to client
                extra = {'retry_after': retry_after} if retry_after else {}
                try:
                    err_json = json.loads(err_body)
                    err_json.update(extra)
                    self.json_out(err_json, e.code)
                except:
                    self.json_out({'error': err_body[:200], **extra}, e.code)
            except Exception as e:
                print(f'  [Gemini] Error: {e}', flush=True)
                self.json_out({'error': str(e)}, 500)
            return

        if p.path=='/send-email':
            if not self.auth_check('sales'): return
            if not self.rate_check('/send-email'): return
            r=send_gmail(cfg,b.get('to',''),b.get('subject',''),b.get('html',b.get('body','')),b.get('text',''))
            if r['ok'] and cfg.get('hubspot_token') and b.get('hubspot_id'):
                log_email_hs(b['hubspot_id'],b.get('subject',''),b.get('html',''),cfg['hubspot_token'])
            self.json_out(r)
        elif p.path=='/leads':
            if not self.auth_check('sales'): return
            leads = b.get('leads', [])
            save_leads_file(leads)
            self.json_out({'ok': True, 'saved': len(leads)})
        elif p.path=='/reminders':
            if not self.auth_check('sales'): return
            rs=load_reminders()
            rem={'id':int(datetime.datetime.now().timestamp()),'lead_id':b.get('lead_id'),
                 'lead_name':b.get('lead_name',''),'date':b.get('date',''),'note':b.get('note',''),'done':False}
            rs.append(rem); save_reminders(rs); self.json_out({'ok':True,'reminder':rem})
        elif p.path=='/reminders/done':
            if not self.auth_check('sales'): return
            rs=load_reminders(); rid=b.get('id')
            for r in rs:
                if r['id']==rid: r['done']=True
            save_reminders(rs); self.json_out({'ok':True})
        elif p.path=='/hubspot/sync':
            if not self.auth_check('sales'): return
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No HubSpot token — set in Settings'}); return
            try: self.json_out(sync_lead(b.get('lead',{}),token))
            except Exception as e: self.json_out({'ok':False,'error':str(e)})
        elif p.path=='/hubspot/sync-all':
            if not self.auth_check('sales'): return
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No HubSpot token'}); return
            results=[]
            for lead in b.get('leads',[]):
                try: results.append({'name':lead.get('name'),**sync_lead(lead,token)})
                except Exception as e: results.append({'name':lead.get('name'),'ok':False,'error':str(e)})
            self.json_out({'ok':True,'synced':sum(1 for r in results if r.get('ok')),'total':len(results),'results':results})
        elif p.path=='/hubspot/log-email':
            if not self.auth_check('sales'): return
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No token'}); return
            self.json_out(log_email_hs(b.get('hubspot_id',''),b.get('subject',''),b.get('html',''),token))
        elif p.path=='/clay-pending':
            if not self.auth_check('sales'): return
            self.json_out(load_clay_pending())
        elif p.path=='/webhook/lead':
            # Universal lead intake — accepts from Clay, Zapier, n8n, direct API
            try:
                import datetime as _dt
                new_lead = {
                    'id':       int(_dt.datetime.now().timestamp() * 1000) + __import__('random').randint(0,9999),
                    'name':     b.get('name','') or b.get('company','') or '(ללא שם)',
                    'domain':   (b.get('domain','') or b.get('website','')).replace('https://','').replace('http://','').split('/')[0],
                    'website':  b.get('website',''),
                    'email':    b.get('email',''),
                    'phone':    b.get('phone',''),
                    'address':  b.get('address',''),
                    'type':     b.get('type','') or b.get('segment',''),
                    'platform': b.get('platform',''),
                    'score':    int(b.get('score',0) or 0),
                    'status':   'new',
                    'source':   b.get('source','webhook'),
                    'notes':    b.get('notes','') or b.get('description',''),
                    'created_at': _dt.datetime.utcnow().isoformat() + 'Z',
                    'enrichment': {},
                    'ai_analysis': {'status': 'none'}
                }
                # De-duplicate by domain
                pending = load_webhook_pending()
                domain = new_lead['domain']
                if domain and any(l.get('domain') == domain for l in pending):
                    print(f'  [WEBHOOK] Duplicate: {new_lead["name"]}', flush=True)
                    self.json_out({'ok': True, 'action': 'duplicate', 'name': new_lead['name']}); return
                pending.append(new_lead)
                save_webhook_pending(pending)
                print(f'  [WEBHOOK] Queued: {new_lead["name"]} ({domain})', flush=True)
                self.json_out({'ok': True, 'action': 'queued', 'id': new_lead['id'], 'name': new_lead['name']})
            except Exception as e:
                print(f'  [WEBHOOK] Error: {e}', flush=True)
                self.json_out({'ok': False, 'error': str(e)}, 500)
            return
        elif p.path=='/webhook/clear':
            save_webhook_pending([])
            self.json_out({'ok': True})
            return
        elif p.path=='/config':
            if not self.auth_check('admin'): return
            current=load_config(); current.update(b); save_config(current)
            self.json_out({'ok':True,'message':'Settings saved'})
        elif p.path=='/kb/run':
            # Client sends KB docs + decisions → server synthesizes → returns insights
            # Client writes insights to Firebase (no SA needed)
            if not self.auth_check('sales'): return
            global _kb_last_insights, _kb_job_running
            if _kb_job_running:
                self.json_out({'ok': False, 'error': 'Job already running', 'running': True})
                return
            kb_docs   = b.get('knowledge_base', [])
            decisions = b.get('ai_decisions', [])
            if not kb_docs:
                self.json_out({'ok': False, 'error': 'No KB docs provided'})
                return
            # Update in-memory cache
            _kb_cache['knowledge_base'] = kb_docs
            _kb_cache['ai_decisions']   = decisions
            _kb_cache['last_updated']   = datetime.datetime.now().isoformat()
            print(f'[KB] /kb/run received: {len(kb_docs)} KB docs, {len(decisions)} decisions', flush=True)
            # Run synchronously (client waits) — typical time: 10-30s
            _kb_job_running = True
            try:
                insights = _kb_learning_job()
                if insights:
                    _kb_last_insights = insights
                    self.json_out({'ok': True, 'insights': insights})
                else:
                    self.json_out({'ok': False, 'error': 'No KB docs ready or Claude failed'})
            except Exception as e:
                self.json_out({'ok': False, 'error': str(e)}, 500)
            finally:
                _kb_job_running = False

        elif p.path=='/kb/trigger':
            # Legacy: trigger job with cached data (admin only)
            if not self.auth_check('admin'): return
            if _kb_job_running:
                self.json_out({'ok': False, 'message': 'Job already running'})
                return
            if not _kb_cache['knowledge_base']:
                self.json_out({'ok': False, 'message': 'No KB data in cache — use /kb/run first'})
                return
            def _run():
                global _kb_last_insights, _kb_job_running
                _kb_job_running = True
                try:
                    result = _kb_learning_job()
                    if result: _kb_last_insights = result
                finally:
                    _kb_job_running = False
            self.json_out({'ok': True, 'message': 'KB job started'})
            threading.Thread(target=_run, daemon=True).start()
        else:
            self.json_out({'error':'Not found'},404)

# ── Reminder checker ───────────────────────────────────────────────────────
def reminder_loop():
    while True:
        threading.Event().wait(60)
        try:
            today=datetime.date.today().isoformat()
            due=[r for r in load_reminders() if not r.get('done') and r.get('date','')<=today]
            if due:
                print(f'\n  REMINDERS DUE:')
                for r in due: print(f'  • {r["lead_name"]} — {r["note"]} ({r["date"]})')
        except: pass

# ── Main ───────────────────────────────────────────────────────────────────
if __name__=='__main__':
    cfg=load_config()
    gmail_ok   = '✅' if cfg.get('gmail_user') else '⚠️  Not set'
    hubspot_ok = '✅' if cfg.get('hubspot_token') else '⚠️  Not set'
    is_railway = bool(os.environ.get('RAILWAY_ENVIRONMENT'))
    host_info  = f"Railway PORT={PORT}" if is_railway else f"http://localhost:{PORT}"
    print(f"""
+----------------------------------------------+
|       XTIX CRM - Server v2.0                 |
+----------------------------------------------+
|  >> {host_info:<41}|
|  Gmail:   {gmail_ok:<35}|
|  HubSpot: {hubspot_ok:<35}|
+----------------------------------------------+
|  Ctrl+C לעצירה                               |
+----------------------------------------------+
""")
    threading.Thread(target=reminder_loop,daemon=True).start()
    threading.Thread(target=_kb_scheduler_loop, daemon=True).start()
    print('[KB] Background learning scheduler started (every 6h, first run in 2min)', flush=True)
    server=HTTPServer(('0.0.0.0',PORT),Handler)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nServer stopped.')
