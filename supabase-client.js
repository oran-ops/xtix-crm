/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║     XTIX CRM — Supabase Client v1.0                     ║
 * ║     מחליף את כל Firebase ב-index.html                   ║
 * ║     Auth + DB + Realtime                                 ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * שימוש: טען לפני כל קוד אחר ב-index.html
 * <script src="supabase-client.js"></script>
 */

(function() {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // CONFIG
  // ══════════════════════════════════════════════════════════
  const SUPABASE_URL  = 'https://ugluksyfpfgzbpmayodg.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnbHVrc3lmcGZnemJwbWF5b2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzYwMTUsImV4cCI6MjA4ODQ1MjAxNX0.p4xVp74f5LaB8cRIm7Zl9BlKmwE7xFPUBcTAmt1Ef-g';
  const BRAIN_URL     = 'https://renewed-playfulness-andy-brain.up.railway.app';
  const SERVER_URL    = 'https://xtix-crm-test.up.railway.app';

  // ══════════════════════════════════════════════════════════
  // SUPABASE REST HELPERS
  // ══════════════════════════════════════════════════════════

  let _authToken = null; // set after login

  async function sbFetch(method, path, body, useService) {
    const headers = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + (_authToken || SUPABASE_ANON),
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=representation',
    };
    const url = SUPABASE_URL + '/rest/v1/' + path;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase ${method} ${path}: ${err}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  }

  // Simple query builder
  window._sb = {
    // GET all rows (with optional filters as query string)
    async get(table, filters) {
      let qs = filters || '';
      if (qs && !qs.startsWith('?')) qs = '?' + qs;
      return sbFetch('GET', table + qs);
    },
    // GET single row by id
    async getById(table, id) {
      const rows = await sbFetch('GET', table + '?id=eq.' + id);
      return rows[0] || null;
    },
    // INSERT
    async insert(table, data) {
      const rows = await sbFetch('POST', table, Array.isArray(data) ? data : [data]);
      return Array.isArray(data) ? rows : rows[0];
    },
    // UPDATE by filter
    async update(table, filter, data) {
      return sbFetch('PATCH', table + '?' + filter, data);
    },
    // DELETE by filter
    async delete(table, filter) {
      return sbFetch('DELETE', table + '?' + filter);
    },
    // RPC (stored function)
    async rpc(fn, params) {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + (_authToken || SUPABASE_ANON),
        },
        body: JSON.stringify(params),
      });
      return res.json();
    },
  };

  // ══════════════════════════════════════════════════════════
  // SUPABASE AUTH
  // ══════════════════════════════════════════════════════════

  window.SupaAuth = {

    // Sign in with Google — redirect flow
    async signInWithGoogle() {
      const redirectTo = encodeURIComponent(window.location.origin + window.location.pathname);
      const authUrl = SUPABASE_URL + '/auth/v1/authorize' +
        '?provider=google' +
        '&redirect_to=' + redirectTo;
      window.location.href = authUrl;
    },

    // Sign out
    async signOut() {
      try {
        await fetch(SUPABASE_URL + '/auth/v1/logout', {
          method: 'POST',
          headers: {
            'apikey':        SUPABASE_ANON,
            'Authorization': 'Bearer ' + _authToken,
          }
        });
      } catch(e) { console.warn('Signout error:', e); }
      _authToken = null;
      window.currentUser = null;
      localStorage.removeItem('sb_session');
      window.location.reload();
    },

    // Get current session from localStorage / URL hash
    async getSession() {
      // Check URL hash (#access_token=... after OAuth redirect)
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        const params = new URLSearchParams(hash.replace('#', ''));
        const token = params.get('access_token');
        const refresh = params.get('refresh_token');
        if (token) {
          _authToken = token;
          localStorage.setItem('sb_session', JSON.stringify({ access_token: token, refresh_token: refresh }));
          window.history.replaceState({}, '', window.location.pathname);
          return { access_token: token };
        }
      }
      // Check query params (?access_token=... alternative format)
      const search = window.location.search;
      if (search && search.includes('access_token')) {
        const params = new URLSearchParams(search);
        const token = params.get('access_token');
        const refresh = params.get('refresh_token');
        if (token) {
          _authToken = token;
          localStorage.setItem('sb_session', JSON.stringify({ access_token: token, refresh_token: refresh }));
          window.history.replaceState({}, '', window.location.pathname);
          return { access_token: token };
        }
      }
      // Check localStorage
      try {
        const stored = localStorage.getItem('sb_session');
        if (stored) {
          const session = JSON.parse(stored);
          if (session.access_token) return session;
        }
      } catch(e) {}
      return null;
    },

    // Get user info from token
    async getUser(token) {
      try {
        const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
          headers: {
            'apikey':        SUPABASE_ANON,
            'Authorization': 'Bearer ' + token,
          }
        });
        if (!res.ok) return null;
        return res.json();
      } catch(e) { return null; }
    },

    // Refresh token
    async refreshToken(refresh_token) {
      try {
        const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token })
        });
        const data = await res.json();
        if (data.access_token) {
          localStorage.setItem('sb_session', JSON.stringify(data));
          return data;
        }
      } catch(e) {}
      return null;
    },

    // Initialize auth state
    async init(onUser, onNoUser) {
      let session = await this.getSession();

      if (!session) { onNoUser && onNoUser(); return; }

      // Set token globally — MUST be before any API calls
      _authToken = session.access_token;

      // Get user info
      let authUser = await this.getUser(_authToken);
      if (!authUser) {
        // Try refresh
        if (session.refresh_token) {
          const refreshed = await this.refreshToken(session.refresh_token);
          if (refreshed) {
            _authToken = refreshed.access_token;
            authUser   = await this.getUser(_authToken);
          }
        }
        if (!authUser) { onNoUser && onNoUser(); return; }
      }

      // Get role from public.users table
      try {
        const rows = await window._sb.get('users', 'id=eq.' + authUser.id + '&select=role,status,name');
        const profile = rows[0];

        if (!profile || profile.status === 'pending') {
          // New user — show pending screen
          onNoUser && onNoUser('pending', authUser.email);
          return;
        }
        if (profile.status === 'disabled') {
          onNoUser && onNoUser('disabled', authUser.email);
          return;
        }

        window.currentUser = {
          uid:   authUser.id,
          email: authUser.email,
          name:  profile.name || authUser.user_metadata?.full_name || authUser.email,
          photo: authUser.user_metadata?.avatar_url || '',
          role:  profile.role || 'viewer',
        };

        // Update last_seen
        window._sb.update('users', 'id=eq.' + authUser.id, { last_seen: new Date().toISOString() }).catch(()=>{});

        onUser && onUser(window.currentUser);

      } catch(e) {
        console.error('[Auth] Role fetch failed:', e);
        onNoUser && onNoUser();
      }
    }
  };

  // ══════════════════════════════════════════════════════════
  // FIREBASE COMPATIBILITY LAYER
  // כל קריאות Firebase מנותבות ל-Supabase
  // ══════════════════════════════════════════════════════════

  // Collection name mapper: Firebase → Supabase table
  const TABLE_MAP = {
    'leads':             'leads',
    'knowledge_base':    'knowledge_base',
    'ai_decisions':      'ai_decisions',
    'brain_insights':    'brain_insights',
    'settings':          'app_settings',
    'reminders':         'reminders',
    'emails_sent':       'emails_sent',
    'activities':        'activities',
    'competitors':       'competitors',
    'methodology':       'methodology',
    'email_cadences':    'email_cadences',
    'email_templates':   'email_templates',
    'config':            'app_settings',
    'pending_users':     'users',
    'webhook_queue':     'leads',
  };

  // Shim: window.db.collection(name) → returns object with Firebase-like API
  window.db = {
    collection(name) {
      const table = TABLE_MAP[name] || name;
      return new CollectionRef(table, name);
    }
  };

  class CollectionRef {
    constructor(table, originalName) {
      this._table = table;
      this._name  = originalName;
      this._filters = [];
      this._orderField = null;
      this._orderDir  = 'asc';
      this._limitN    = 1000;
    }

    doc(id) { return new DocRef(this._table, id); }

    where(field, op, value) {
      const clone = this._clone();
      if (op === '=='  ) clone._filters.push(`${field}=eq.${value}`);
      if (op === '!='  ) clone._filters.push(`${field}=neq.${value}`);
      if (op === '>'   ) clone._filters.push(`${field}=gt.${value}`);
      if (op === '>='  ) clone._filters.push(`${field}=gte.${value}`);
      if (op === '<'   ) clone._filters.push(`${field}=lt.${value}`);
      if (op === '<='  ) clone._filters.push(`${field}=lte.${value}`);
      return clone;
    }

    orderBy(field, dir) {
      const clone = this._clone();
      clone._orderField = field;
      clone._orderDir   = dir === 'desc' ? 'desc' : 'asc';
      return clone;
    }

    limit(n) {
      const clone = this._clone();
      clone._limitN = n;
      return clone;
    }

    async get() {
      let qs = '';
      if (this._filters.length) qs += this._filters.join('&');
      if (this._orderField) {
        qs += (qs ? '&' : '') + `order=${this._orderField}.${this._orderDir}`;
      }
      qs += (qs ? '&' : '') + `limit=${this._limitN}`;
      const rows = await window._sb.get(this._table, qs);
      return new QuerySnapshot(rows);
    }

    async add(data) {
      // Sanitize
      const clean = _sanitize(data);
      if (!clean.created_at) clean.created_at = new Date().toISOString();
      const row = await window._sb.insert(this._table, clean);
      return new DocRef(this._table, row.id, row);
    }

    // Realtime-ish: onSnapshot polls every 30s
    onSnapshot(callback) {
      const run = async () => {
        try {
          const snap = await this.get();
          callback(snap);
        } catch(e) { console.warn('[onSnapshot]', e); }
      };
      run();
      const interval = setInterval(run, 30000);
      return () => clearInterval(interval); // unsubscribe
    }

    _clone() {
      const c = new CollectionRef(this._table, this._name);
      c._filters    = [...this._filters];
      c._orderField = this._orderField;
      c._orderDir   = this._orderDir;
      c._limitN     = this._limitN;
      return c;
    }
  }

  class DocRef {
    constructor(table, id, cachedData) {
      this._table = table;
      this._id    = id;
      this._data  = cachedData || null;
    }

    async get() {
      if (this._data) return new DocSnapshot(this._id, this._data);
      const rows = await window._sb.get(this._table, `id=eq.${this._id}`);
      return new DocSnapshot(this._id, rows[0] || null);
    }

    async set(data, opts) {
      const clean = _sanitize(data);
      if (opts && opts.merge) {
        // Upsert
        const exists = await this.get();
        if (exists.exists) {
          await window._sb.update(this._table, `id=eq.${this._id}`, clean);
        } else {
          clean.id = this._id;
          await window._sb.insert(this._table, clean);
        }
      } else {
        // Replace — upsert with id
        clean.id = this._id;
        await sbFetch('POST', this._table, [clean]);
      }
      return this;
    }

    async update(data) {
      const clean = _sanitize(data);
      clean.updated_at = new Date().toISOString();
      await window._sb.update(this._table, `id=eq.${this._id}`, clean);
      return this;
    }

    async delete() {
      await window._sb.delete(this._table, `id=eq.${this._id}`);
    }

    collection(name) {
      return window.db.collection(name);
    }
  }

  class QuerySnapshot {
    constructor(rows) {
      this.docs  = (rows || []).map(r => new DocSnapshot(r.id, r));
      this.empty = this.docs.length === 0;
      this.size  = this.docs.length;
    }
    forEach(fn) { this.docs.forEach(fn); }
  }

  class DocSnapshot {
    constructor(id, data) {
      this.id     = id;
      this._data  = data;
      this.exists = !!data;
    }
    data()          { return this._data; }
    get(field)      { return this._data ? this._data[field] : undefined; }
  }

  // Batch writer shim
  window.db.batch = function() {
    const ops = [];
    return {
      set(ref, data, opts) {
        ops.push({ type: 'set', ref, data, opts });
        return this;
      },
      update(ref, data) {
        ops.push({ type: 'update', ref, data });
        return this;
      },
      delete(ref) {
        ops.push({ type: 'delete', ref });
        return this;
      },
      async commit() {
        for (const op of ops) {
          try {
            if (op.type === 'set')    await op.ref.set(op.data, op.opts);
            if (op.type === 'update') await op.ref.update(op.data);
            if (op.type === 'delete') await op.ref.delete();
          } catch(e) { console.warn('[batch]', e); }
        }
      }
    };
  };

  // ══════════════════════════════════════════════════════════
  // AUTH SHIM — מחליף את firebase.auth()
  // ══════════════════════════════════════════════════════════

  window.auth = {
    currentUser: null,

    async signInWithPopup(provider) {
      return window.SupaAuth.signInWithGoogle();
    },

    async signOut() {
      return window.SupaAuth.signOut();
    },

    onAuthStateChanged(callback) {
      // Run immediately — handles both page load and post-OAuth redirect
      window.SupaAuth.init(
        (user) => {
          window.auth.currentUser = { uid: user.uid, email: user.email, getIdToken: async () => _authToken };
          callback(window.auth.currentUser);
        },
        (reason, email) => {
          window.auth.currentUser = null;
          callback(null);
          if (reason === 'pending') {
            console.log('[Auth] User pending approval:', email);
          }
          // Show login screen if no user
          const loginScreen = document.getElementById('login-screen');
          if (loginScreen) loginScreen.style.display = 'flex';
        }
      );
    }
  };

  // ══════════════════════════════════════════════════════════
  // _authFetch — מחליף את window._authFetch
  // שולח Authorization header עם Supabase token
  // ══════════════════════════════════════════════════════════

  window._authFetch = async function(url, options = {}) {
    options.headers = options.headers || {};
    if (_authToken) {
      options.headers['Authorization'] = 'Bearer ' + _authToken;
    }
    return fetch(url, options);
  };

  // ══════════════════════════════════════════════════════════
  // BRAIN API — חיבור ל-ANDY Brain
  // ══════════════════════════════════════════════════════════

  window.BrainAPI = {

    async status() {
      const res = await fetch(BRAIN_URL + '/brain/status');
      return res.json();
    },

    // שלח ליד למוח לניתוח
    async analyzeLead(leadId) {
      const res = await fetch(BRAIN_URL + '/brain/analyze/' + leadId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return res.json();
    },

    // שמור ליד ב-Supabase + שלח לניתוח
    async saveLead(lead) {
      const res = await fetch(BRAIN_URL + '/brain/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      });
      const data = await res.json();
      // אם נשמר — שלח לניתוח ברקע
      if (data.ok && data.lead?.id) {
        fetch(BRAIN_URL + '/brain/analyze/' + data.lead.id, { method: 'POST' }).catch(()=>{});
      }
      return data;
    },

    // רשום תוצאת עסקה
    async recordOutcome(leadId, outcome, aiScore) {
      const res = await fetch(BRAIN_URL + '/brain/learn/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, outcome, ai_score: aiScore || 0 })
      });
      return res.json();
    },

    // קבל insights
    async getInsights() {
      const res = await fetch(BRAIN_URL + '/brain/insights');
      return res.json();
    },

    // הפעל KB learning
    async runKBLearning(kbDocs, aiDecisions) {
      const res = await fetch(BRAIN_URL + '/brain/kb/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledge_base: kbDocs, ai_decisions: aiDecisions || [] })
      });
      return res.json();
    },

    // Hunt leads
    async hunt(source, query) {
      const res = await fetch(BRAIN_URL + '/brain/hunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source || 'google', query: query || 'מפיקי אירועים ישראל' })
      });
      return res.json();
    }
  };

  // ══════════════════════════════════════════════════════════
  // GLOBALS שהיו קיימים עם Firebase
  // ══════════════════════════════════════════════════════════

  window.SERVER     = SERVER_URL;
  window.BRAIN_URL  = BRAIN_URL;

  // Firebase FieldValue shim
  window.firebase = window.firebase || {};
  window.firebase.firestore = window.firebase.firestore || {};
  window.firebase.firestore.FieldValue = {
    serverTimestamp: () => new Date().toISOString(),
    arrayUnion:      (...items) => items,
    arrayRemove:     (...items) => items,
    increment:       (n) => n,
  };

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  function _sanitize(data) {
    // Remove Firebase-specific fields
    const clean = Object.assign({}, data);
    delete clean._nextId;
    // Convert any Firestore Timestamp to ISO string
    for (const [k, v] of Object.entries(clean)) {
      if (v && typeof v === 'object' && v.toDate) {
        clean[k] = v.toDate().toISOString();
      }
      if (v && typeof v === 'object' && v.seconds) {
        clean[k] = new Date(v.seconds * 1000).toISOString();
      }
    }
    return clean;
  }

  // ══════════════════════════════════════════════════════════
  // INIT MESSAGE
  // ══════════════════════════════════════════════════════════
  console.log('%c🧠 XTIX CRM — Supabase Client v1.0 loaded', 'color:#6366f1;font-weight:bold');
  console.log('%c  DB: Supabase · Auth: Supabase · Brain: ANDY v2.0', 'color:#8b5cf6');

  // ── Auto-init on page load ──────────────────────────────────────────
  // Runs after DOM is ready — handles both fresh login and returning session
  function _autoInit() {
    window.SupaAuth.init(
      function(user) {
        // Authenticated — set globals and fire Firebase-compat callback
        window.currentUser = user;
        if (window.auth) {
          window.auth.currentUser = {
            uid:        user.uid,
            email:      user.email,
            getIdToken: async function() { return _authToken; }
          };
        }
        // Hide login screen, show app
        var ls = document.getElementById('login-screen');
        if (ls) ls.style.display = 'none';
        var app = document.getElementById('app') || document.getElementById('main-app');
        if (app) app.style.display = '';
        // Fire any waiting onAuthStateChanged callbacks
        if (window._onAuthCallbacks) {
          window._onAuthCallbacks.forEach(function(cb) { cb(window.auth.currentUser); });
        }
        console.log('[Auth] ✅ Signed in as', user.email, '(' + user.role + ')');
      },
      function(reason, email) {
        // Not authenticated — show login screen
        window.currentUser = null;
        var ls = document.getElementById('login-screen');
        if (ls) ls.style.display = 'flex';
        if (reason === 'pending') {
          console.warn('[Auth] User pending approval:', email);
          var msg = document.getElementById('login-message');
          if (msg) msg.textContent = 'הבקשה שלך ממתינה לאישור מנהל';
        }
        if (window._onAuthCallbacks) {
          window._onAuthCallbacks.forEach(function(cb) { cb(null); });
        }
      }
    );
  }

  // Override onAuthStateChanged to store callbacks + run init
  var _origOnAuth = window.auth.onAuthStateChanged.bind(window.auth);
  window._onAuthCallbacks = [];
  window.auth.onAuthStateChanged = function(callback) {
    window._onAuthCallbacks.push(callback);
  };

  // Run auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    setTimeout(_autoInit, 100);
  }

})();
