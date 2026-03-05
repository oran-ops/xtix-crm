#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XTIX CRM — Full Stack Server v2.0
הרצה:  python server.py
פתח:   xtix-crm.html בדפדפן
עצירה: Ctrl+C
"""

import json, re, ssl, os, csv, io, smtplib, datetime, threading, time, collections, base64, hashlib, hmac
import urllib.request, urllib.parse
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

def _fetch_user_role_from_firestore(uid):
    """Fetch user role from Firestore REST API."""
    try:
        fs_url = f'https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/users/{uid}'
        req = urllib.request.Request(fs_url)
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
            fields = data.get('fields', {})
            role = fields.get('role', {}).get('stringValue', '')
            return role
    except Exception as e:
        print(f'[Auth] Role fetch failed for {uid}: {e}', flush=True)
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
        n=int(self.headers.get('Content-Length',0))
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
        Verify Firebase ID Token from Authorization header.
        Returns (uid, email, role) on success.
        Sends 401/403 and returns None on failure.
        required_role: 'sales' = sales+admin allowed, 'admin' = admin only
        """
        auth_header = self.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            self.json_out({'error': 'חסר Authorization header', 'code': 'missing_token'}, 401)
            return None

        id_token = auth_header[7:].strip()

        # Check cache first
        cached = _get_token_from_cache(id_token)
        if cached:
            uid, email, role = cached['uid'], cached['email'], cached['role']
        else:
            # Verify token
            try:
                uid, email, _ = _verify_firebase_token(id_token)
            except ValueError as e:
                print(f'[Auth] Token invalid: {e}', flush=True)
                self.json_out({'error': 'Token לא תקף — נסה להתנתק ולהתחבר מחדש', 'code': 'invalid_token'}, 401)
                return None

            # Fetch role from Firestore
            role = _fetch_user_role_from_firestore(uid)
            if not role:
                self.json_out({'error': 'אין גישה — פנה למנהל', 'code': 'no_role'}, 403)
                return None

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
            crm_file = os.path.join(os.path.dirname(__file__), 'xtix-crm.html')
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
            raw=q.get('data',['[]'])[0]
            try: leads=json.loads(urllib.parse.unquote(raw))
            except: leads=[]
            csv_data=to_csv(leads).encode('utf-8-sig')
            self.send_response(200); self.cors()
            self.send_header('Content-Type','text/csv; charset=utf-8')
            self.send_header('Content-Disposition','attachment; filename="xtix-leads.csv"')
            self.send_header('Content-Length',str(len(csv_data))); self.end_headers(); self.wfile.write(csv_data)
        elif p.path=='/leads':
            data = load_leads_file()
            self.json_out({'ok': True, 'leads': data, 'exists': data is not None})
        elif p.path=='/reminders':
            self.json_out(load_reminders())
        elif p.path=='/clay-pending':
            self.json_out(load_clay_pending())
        elif p.path=='/webhook/pending':
            self.json_out({'leads': load_webhook_pending()})
        elif p.path=='/config':
            safe={k:('***' if any(x in k for x in ['password','token']) else v) for k,v in cfg.items()}
            self.json_out(safe)
        else:
            self.json_out({'error':'Not found'},404)

    def do_POST(self):
        p=urllib.parse.urlparse(self.path); b=self.body(); cfg=load_config()

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
            leads = b.get('leads', [])
            save_leads_file(leads)
            self.json_out({'ok': True, 'saved': len(leads)})
        elif p.path=='/reminders':
            rs=load_reminders()
            rem={'id':int(datetime.datetime.now().timestamp()),'lead_id':b.get('lead_id'),
                 'lead_name':b.get('lead_name',''),'date':b.get('date',''),'note':b.get('note',''),'done':False}
            rs.append(rem); save_reminders(rs); self.json_out({'ok':True,'reminder':rem})
        elif p.path=='/reminders/done':
            rs=load_reminders(); rid=b.get('id')
            for r in rs:
                if r['id']==rid: r['done']=True
            save_reminders(rs); self.json_out({'ok':True})
        elif p.path=='/hubspot/sync':
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No HubSpot token — set in Settings'}); return
            try: self.json_out(sync_lead(b.get('lead',{}),token))
            except Exception as e: self.json_out({'ok':False,'error':str(e)})
        elif p.path=='/hubspot/sync-all':
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No HubSpot token'}); return
            results=[]
            for lead in b.get('leads',[]):
                try: results.append({'name':lead.get('name'),**sync_lead(lead,token)})
                except Exception as e: results.append({'name':lead.get('name'),'ok':False,'error':str(e)})
            self.json_out({'ok':True,'synced':sum(1 for r in results if r.get('ok')),'total':len(results),'results':results})
        elif p.path=='/hubspot/log-email':
            token=cfg.get('hubspot_token','')
            if not token: self.json_out({'ok':False,'error':'No token'}); return
            self.json_out(log_email_hs(b.get('hubspot_id',''),b.get('subject',''),b.get('html',''),token))
        elif p.path=='/clay-pending':
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
            current=load_config(); current.update(b); save_config(current)
            self.json_out({'ok':True,'message':'Settings saved'})
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
    server=HTTPServer(('0.0.0.0',PORT),Handler)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nServer stopped.')
