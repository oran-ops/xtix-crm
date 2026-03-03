#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XTIX CRM — Full Stack Server v2.0
הרצה:  python server.py
פתח:   xtix-crm.html בדפדפן
עצירה: Ctrl+C
"""

import json, re, ssl, os, csv, io, smtplib, datetime, threading
import urllib.request, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

PORT           = int(os.environ.get('PORT', 8765))
CONFIG_FILE    = os.path.join(os.path.dirname(__file__), 'xtix_config.json')
REMINDERS_FILE = os.path.join(os.path.dirname(__file__), 'xtix_reminders.json')
LEADS_FILE     = os.path.join(os.path.dirname(__file__), 'xtix_leads.json')

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
        self.send_header('Access-Control-Allow-Headers','Content-Type')

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
        elif p.path=='/analyze':
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
        elif p.path=='/config':
            safe={k:('***' if any(x in k for x in ['password','token']) else v) for k,v in cfg.items()}
            self.json_out(safe)
        else:
            self.json_out({'error':'Not found'},404)

    def do_POST(self):
        p=urllib.parse.urlparse(self.path); b=self.body(); cfg=load_config()
        if p.path=='/send-email':
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
