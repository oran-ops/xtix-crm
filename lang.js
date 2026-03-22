/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANDY.AI Brain — lang.js                                     ║
 * ║  i18n Translation Engine                                     ║
 * ║  v1.0 — Phase 1: Infrastructure                             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Usage:                                                      ║
 * ║    t('nav.leads')           → 'Leads' / 'לידים'            ║
 * ║    setLang('he')            → switch to Hebrew              ║
 * ║    getCurrentLang()         → 'en' / 'he'                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

(function() {
  'use strict';

  // ── Translation Dictionaries ──────────────────────────────────

  var _translations = {

    en: {
      // Navigation
      'nav.leads':          'Leads',
      'nav.leadfinder':     'Lead Finder',
      'nav.market':         'Market Analysis',
      'nav.methodology':    'Methodology',
      'nav.hubspot':        'HubSpot',
      'nav.aibrain':        'AI Brain',
      'nav.tasks':          'Tasks',
      'nav.outreach':       'Outreach Queue',
      'nav.users':          'Users',
      'nav.kb':             'Knowledge Base',
      'nav.aichat':         'AI Chat',

      // Sidebar bottom
      'sidebar.import_csv':  'Import CSV',
      'sidebar.export_excel':'Export Excel',
      'sidebar.sync_db':     'Sync DB',
      'sidebar.sign_out':    'Sign Out',
      'sidebar.loading':     'Loading...',

      // Top bar
      'topbar.add_lead':     '+ Add Lead',
      'topbar.search':       'Search name, domain, email, XTIX-ID, platform...',
      'topbar.select_all':   'Select All',

      // Filters
      'filter.all_statuses': 'All Statuses',
      'filter.all_sources':  'All Sources',
      'filter.all_segments': 'All Segments',
      'filter.sort':         'Sort',
      'filter.results':      'results',

      // Status labels
      'status.new':               'New',
      'status.contacted':         'Emailed',
      'status.followup':          'Follow-up',
      'status.meeting':           'Meeting',
      'status.negotiation':       'Negotiation',
      'status.won':               'Won',
      'status.lost':              'Lost',
      'status.ghosted':           'Ghosted',
      'status.future_potential':  'Future',
      'status.referred_us':       'Referred Us',
      'status.not_relevant':      'Not Relevant',

      // Lead card quick actions
      'lead.delete':         'Delete',
      'lead.ai_touched':     'AI Touched',
      'lead.contacted':      'Contact',
      'lead.followup':       'Follow-up',
      'lead.email_sent':     'Email Sent',
      'lead.new':            'New Lead',

      // Lead tabs
      'tab.profile':         'Profile',
      'tab.metajudge':       'Meta-Judge',
      'tab.emails':          'Emails',
      'tab.andy':            'ANDY',
      'tab.review':          'Review',

      // Profile tab
      'profile.edit':        'Edit Details',
      'profile.save':        'Save',
      'profile.cancel':      'Cancel',
      'profile.export_excel':'Export Excel',
      'profile.name':        'Name',
      'profile.company':     'Company',
      'profile.email':       'Email',
      'profile.phone':       'Phone',
      'profile.domain':      'Domain',
      'profile.platform':    'Platform',
      'profile.segment':     'Segment',
      'profile.notes':       'Notes',
      'profile.address':     'Address',

      // Meta-Judge tab
      'mj.reanalyze':        'Re-analyze',
      'mj.deal_closed':      '🎉 Deal Closed',
      'mj.deal_lost':        '❌ Deal Lost',
      'mj.no_analysis':      'No AI analysis yet for this lead',
      'mj.analyzing':        'Analyzing...',
      'mj.engine_badge':     'Meta-Judge · Triple Engine',
      'mj.claude_badge':     'Claude AI',
      'mj.next_action':      'Next Action',
      'mj.intel':            'Intel',
      'mj.pitch_angle':      'Angle',
      'mj.contact':          'Contact',
      'mj.area':             'Area',
      'mj.summary_rep':      'Summary for Rep',
      'mj.save_summary':     '💾 Save',
      'mj.updated':          'Updated',

      // Review tab
      'review.engine_comparison': '⚖️ Engine Comparison',
      'review.manual_review':     '⚠️ Manual Review Required',
      'review.no_flags':          'All engines agreed — no manual review needed',
      'review.reasoning':         'Meta-Judge Reasoning',
      'review.triple_only':       'Review tab available after Triple Engine analysis only',
      'review.use_meta':          'Use Meta-Judge engine for analysis',
      'review.disagreement':      'Engine Disagreement',
      'review.high_std':          'High deviation between engines',

      // Emails tab
      'emails.no_outreach':  'No outreach sent yet',
      'emails.go_to_andy':   'Go to ANDY tab to write the first outreach',
      'emails.sent':         '✅ Sent',
      'emails.pending':      '⏳ Pending',
      'emails.scheduled':    '📅 Scheduled',

      // ANDY tab
      'andy.write_outreach': '✍️ Write Outreach with ANDY (Email)',
      'andy.whatsapp':       '📱 WhatsApp — Add phone number to enable',
      'andy.chain_title':    'Email Chain',
      'andy.approve_send':   'Approve & Send Email 1',
      'andy.emails_auto':    'Emails 2-4 will be sent automatically per schedule',
      'andy.regenerate':     '🔄 Regenerate',
      'andy.pitch_angle':    'Pitch Angle',
      'andy.platform':       'Platform',
      'andy.score':          'Score',

      // Deal close modal
      'deal.closed_title':   'Deal Closed! 🎉',
      'deal.lost_title':     'Deal Not Closed',
      'deal.closed_q':       'Are you sure the deal with {name} is closed?',
      'deal.lost_q':         'Mark this deal as lost?',
      'deal.confirm_closed': '✅ Yes, Closed',
      'deal.confirm_lost':   '❌ Yes, Lost',
      'deal.cancel':         'Cancel',
      'deal.reason_closed':  'What was the deciding factor? (optional)',
      'deal.reason_lost':    'What was the reason? (price/timing/competitor/not relevant)',

      // Analysis choice modal
      'analysis.title':      'Choose Analysis Engine',
      'analysis.prev_engine':'Previous engine',
      'analysis.meta_title': '⚡ Meta-Judge — Triple Engine',
      'analysis.meta_desc':  'Claude + GPT-4o + Gemini in parallel + Meta-Judge consensus',
      'analysis.claude_title':'🧠 Claude Only',
      'analysis.claude_desc': 'Fast analysis, single engine',

      // AI Brain
      'brain.title':         '🧠 AI Brain — Central Brain',
      'brain.subtitle':      'Claude · GPT-4o · Gemini engines working in parallel. Meta-Judge synthesizes.',
      'brain.tab.performance': '📈 Performance',
      'brain.tab.decisions':   '📋 Decision History',
      'brain.tab.api':         '⚙️ API Settings',
      'brain.kpi.accuracy':    'Overall Accuracy',
      'brain.kpi.ai_accuracy': 'AI Score Accuracy',
      'brain.kpi.days':        'Avg Days to Close',
      'brain.kpi.win_rate':    'Win Rate',
      'brain.segments':        '🏆 Top Segments',
      'brain.pitches':         '🎯 Winning Pitch Angles',
      'brain.competitors':     '🏁 Competitor Steal Rates',
      'brain.subjects':        '✉️ Winning Subject Lines',
      'brain.no_data':         'No data yet — close your first deal to start learning',
      'brain.updated':         'Updated',
      'brain.engine_mode':     'Engine Mode',
      'brain.mode_triple':     'Triple Engine (Recommended)',
      'brain.mode_claude':     'Claude Only (Fast)',

      // Outreach Queue
      'queue.title':           'Outreach Queue',
      'queue.pending':         'Pending Approval',
      'queue.approved':        'Approved',
      'queue.rejected':        'Rejected',
      'queue.scheduled':       'Scheduled',
      'queue.sent':            'Sent',
      'queue.approve':         '✅ Approve & Send',
      'queue.reject':          '❌ Reject',
      'queue.empty':           'Queue is empty',

      // Lead Finder
      'finder.title':          'Lead Finder',
      'finder.search':         'Search for leads...',
      'finder.hunt':           '🎯 Hunt',
      'finder.results':        'Results',

      // Signals / Toast messages
      'toast.deal_closed':     '🎉 Deal closed — ANDY is updating learning',
      'toast.deal_lost':       '📊 Deal lost — ANDY will learn from this',
      'toast.saved':           '✅ Saved',
      'toast.error':           '❌ Error',
      'toast.analyzing':       'Analyzing...',
      'toast.sending':         'Sending...',
      'toast.sent':            '✓ Sent!',
      'toast.copied':          '✅ Copied!',

      // WhatsApp
      'wa.generating':         'ANDY is writing WhatsApp message...',
      'wa.sent':               '📱 WhatsApp opened with AI message for ',
      'wa.twilio_sent':        '✓ WhatsApp AI sent to ',
      'wa.error':              '✗ Error: ',
      'wa.no_phone':           'No phone number for this lead',

      // General
      'general.loading':       'Loading...',
      'general.save':          'Save',
      'general.cancel':        'Cancel',
      'general.delete':        'Delete',
      'general.edit':          'Edit',
      'general.close':         'Close',
      'general.send':          'Send',
      'general.copy':          'Copy',
      'general.refresh':       'Refresh',
      'general.yes':           'Yes',
      'general.no':            'No',
      'general.error':         'Error',
      'general.success':       'Success',
      'general.days':          'days',
      'general.leads':         'leads',
      'general.analyses':      'analyses',
      'general.updated':       'Updated',
      'general.analyzing':     'Analyzing...',
      'general.step1':         'Step 1/3: Profile → 2/3: Strategy → 3/3: Emails',
    },

    he: {
      // Navigation
      'nav.leads':          'לידים',
      'nav.leadfinder':     'Lead Finder',
      'nav.market':         'ניתוח שוק',
      'nav.methodology':    'מתודולוגיה',
      'nav.hubspot':        'HubSpot',
      'nav.aibrain':        'AI Brain',
      'nav.tasks':          'משימות',
      'nav.outreach':       'תור פניות',
      'nav.users':          'משתמשים',
      'nav.kb':             'Knowledge Base',
      'nav.aichat':         'AI Chat',

      // Sidebar bottom
      'sidebar.import_csv':  'ייבוא CSV',
      'sidebar.export_excel':'ייצוא Excel',
      'sidebar.sync_db':     'סנכרון DB',
      'sidebar.sign_out':    'התנתק',
      'sidebar.loading':     'טוען...',

      // Top bar
      'topbar.add_lead':     '+ הוסף ליד',
      'topbar.search':       'חפש שם, דומיין, מייל, XTIX-ID, פלטפורמה...',
      'topbar.select_all':   'בחר הכל',

      // Filters
      'filter.all_statuses': 'כל הסטטוסים',
      'filter.all_sources':  'כל המקורות',
      'filter.all_segments': 'כל הסגמנטים',
      'filter.sort':         'מיון',
      'filter.results':      'תוצאות',

      // Status labels
      'status.new':               'חדש',
      'status.contacted':         'נשלח מייל',
      'status.followup':          'Follow-up',
      'status.meeting':           'פגישה',
      'status.negotiation':       'משא ומתן',
      'status.won':               'נסגר',
      'status.lost':              'לא נסגר',
      'status.ghosted':           'לא מגיב',
      'status.future_potential':  'עתידי',
      'status.referred_us':       'הפנה אותנו',
      'status.not_relevant':      'לא רלוונטי',

      // Lead card quick actions
      'lead.delete':         'מחק',
      'lead.ai_touched':     'AI נגע',
      'lead.contacted':      'פנייה',
      'lead.followup':       'Follow-up',
      'lead.email_sent':     'נשלח מייל',
      'lead.new':            'ליד חדש',

      // Lead tabs
      'tab.profile':         'פרופיל',
      'tab.metajudge':       'Meta-Judge',
      'tab.emails':          'מיילים',
      'tab.andy':            'ANDY',
      'tab.review':          'Review',

      // Profile tab
      'profile.edit':        'ערוך פרטים',
      'profile.save':        'שמור',
      'profile.cancel':      'ביטול',
      'profile.export_excel':'ייצוא Excel',
      'profile.name':        'שם',
      'profile.company':     'חברה',
      'profile.email':       'מייל',
      'profile.phone':       'טלפון',
      'profile.domain':      'דומיין',
      'profile.platform':    'פלטפורמה',
      'profile.segment':     'סגמנט',
      'profile.notes':       'הערות',
      'profile.address':     'כתובת',

      // Meta-Judge tab
      'mj.reanalyze':        'ניתוח מחדש',
      'mj.deal_closed':      '🎉 עסקה נסגרה',
      'mj.deal_lost':        '❌ לא נסגר',
      'mj.no_analysis':      'אין ניתוח AI עדיין לליד זה',
      'mj.analyzing':        'מנתח...',
      'mj.engine_badge':     'Meta-Judge · Triple Engine',
      'mj.claude_badge':     'Claude AI',
      'mj.next_action':      'הצעד הבא',
      'mj.intel':            'Intel',
      'mj.pitch_angle':      'זווית',
      'mj.contact':          'פנה אל',
      'mj.area':             'אזור',
      'mj.summary_rep':      'סיכום לנציג',
      'mj.save_summary':     '💾 שמור',
      'mj.updated':          'עודכן',

      // Review tab
      'review.engine_comparison': '⚖️ השוואת מנועים',
      'review.manual_review':     '⚠️ שדות לבדיקה ידנית',
      'review.no_flags':          'כל המנועים הסכימו — אין שדות לבדיקה ידנית',
      'review.reasoning':         'נימוק Meta-Judge',
      'review.triple_only':       'טאב Review זמין רק אחרי ניתוח Triple Engine',
      'review.use_meta':          'השתמש במנוע Meta-Judge לניתוח',
      'review.disagreement':      'חוסר הסכמה בין המנועים',
      'review.high_std':          'סטיית תקן גבוהה בין המנועים',

      // Emails tab
      'emails.no_outreach':  'טרם נשלחו פניות לליד זה',
      'emails.go_to_andy':   'עבור לטאב ANDY כדי לכתוב פנייה ראשונה',
      'emails.sent':         '✅ נשלחו',
      'emails.pending':      '⏳ ממתינים',
      'emails.scheduled':    '📅 מתוכננים',

      // ANDY tab
      'andy.write_outreach': '✍️ כתוב פניה עם ANDY (מייל)',
      'andy.whatsapp':       '📱 WhatsApp — הוסף מספר טלפון לפרופיל להפעלה',
      'andy.chain_title':    'שרשרת מיילים',
      'andy.approve_send':   'אשר ושלח מייל 1',
      'andy.emails_auto':    'מיילים 2-4 ישלחו אוטומטית לפי לוח הזמנים',
      'andy.regenerate':     '🔄 צור מחדש',
      'andy.pitch_angle':    'Pitch Angle',
      'andy.platform':       'פלטפורמה',
      'andy.score':          'Score',

      // Deal close modal
      'deal.closed_title':   'עסקה נסגרה! 🎉',
      'deal.lost_title':     'עסקה לא נסגרה',
      'deal.closed_q':       'האם אתה בטוח שהעסקה עם {name} נסגרה?',
      'deal.lost_q':         'לסמן עסקה זו כאבודה?',
      'deal.confirm_closed': '✅ כן, סגרנו',
      'deal.confirm_lost':   '❌ כן, לא נסגר',
      'deal.cancel':         'ביטול',
      'deal.reason_closed':  'מה היה הגורם המכריע? (לא חובה)',
      'deal.reason_lost':    'מה הסיבה? (מחיר/תזמון/מתחרה/לא רלוונטי)',

      // Analysis choice modal
      'analysis.title':      'בחר מנוע ניתוח',
      'analysis.prev_engine':'מנוע קודם',
      'analysis.meta_title': '⚡ Meta-Judge — Triple Engine',
      'analysis.meta_desc':  'Claude + GPT-4o + Gemini במקביל + Consensus של Meta-Judge',
      'analysis.claude_title':'🧠 Claude בלבד',
      'analysis.claude_desc': 'ניתוח מהיר, מנוע בודד',

      // AI Brain
      'brain.title':         '🧠 AI Brain — מוח מרכזי',
      'brain.subtitle':      'מנועים Claude · GPT-4o · Gemini עובדים במקביל. Meta-Judge מחליט.',
      'brain.tab.performance': '📈 ביצועים',
      'brain.tab.decisions':   '📋 היסטוריית החלטות',
      'brain.tab.api':         '⚙️ הגדרות API',
      'brain.kpi.accuracy':    'דיוק כולל',
      'brain.kpi.ai_accuracy': 'דיוק ניתוח AI',
      'brain.kpi.days':        'ממוצע ימים לסגירה',
      'brain.kpi.win_rate':    'Win Rate',
      'brain.segments':        '🏆 Segments מנצחים',
      'brain.pitches':         '🎯 Pitch Angles שעבדו',
      'brain.competitors':     '🏁 מתחרים — שיעור גניבה',
      'brain.subjects':        '✉️ Subject Lines שעבדו',
      'brain.no_data':         'אין עדיין נתונים — סגור עסקה ראשונה כדי להתחיל ללמוד',
      'brain.updated':         'עודכן',
      'brain.engine_mode':     'מנוע ניתוח',
      'brain.mode_triple':     'Triple Engine (מומלץ)',
      'brain.mode_claude':     'Claude בלבד (מהיר)',

      // Outreach Queue
      'queue.title':           'תור פניות',
      'queue.pending':         'ממתין לאישור',
      'queue.approved':        'אושר',
      'queue.rejected':        'נדחה',
      'queue.scheduled':       'מתוכנן',
      'queue.sent':            'נשלח',
      'queue.approve':         '✅ אשר ושלח',
      'queue.reject':          '❌ דחה',
      'queue.empty':           'התור ריק',

      // Lead Finder
      'finder.title':          'מחפש לידים',
      'finder.search':         'חפש לידים...',
      'finder.hunt':           '🎯 Hunt',
      'finder.results':        'תוצאות',

      // Signals / Toast messages
      'toast.deal_closed':     '🎉 עסקה נסגרה — ANDY מעדכן את הלמידה',
      'toast.deal_lost':       '📊 עסקה לא נסגרה — ANDY ילמד מהטעות',
      'toast.saved':           '✅ נשמר',
      'toast.error':           '❌ שגיאה',
      'toast.analyzing':       'מנתח...',
      'toast.sending':         'שולח...',
      'toast.sent':            '✓ נשלח!',
      'toast.copied':          '✅ הועתק!',

      // WhatsApp
      'wa.generating':         'ANDY כותב הודעת WhatsApp...',
      'wa.sent':               '📱 WhatsApp נפתח עם הודעת AI ל-',
      'wa.twilio_sent':        '✓ WhatsApp AI נשלח ל-',
      'wa.error':              '✗ שגיאה: ',
      'wa.no_phone':           'אין מספר טלפון לליד זה',

      // General
      'general.loading':       'טוען...',
      'general.save':          'שמור',
      'general.cancel':        'ביטול',
      'general.delete':        'מחק',
      'general.edit':          'ערוך',
      'general.close':         'סגור',
      'general.send':          'שלח',
      'general.copy':          'העתק',
      'general.refresh':       'רענן',
      'general.yes':           'כן',
      'general.no':            'לא',
      'general.error':         'שגיאה',
      'general.success':       'הצלחה',
      'general.days':          'ימים',
      'general.leads':         'לידים',
      'general.analyses':      'ניתוחים',
      'general.updated':       'עודכן',
      'general.analyzing':     'מנתח...',
      'general.step1':         'שלב 1/3: פרופיל → 2/3: אסטרטגיה → 3/3: מיילים',
    }
  };

  // ── Core Functions ────────────────────────────────────────────

  var _currentLang = (function() {
    try { return localStorage.getItem('xtix_lang') || 'en'; } catch(e) { return 'en'; }
  })();

  // t(key) — translate a key
  window.t = function(key, fallback) {
    var dict = _translations[_currentLang];
    if (dict && dict[key] !== undefined) return dict[key];
    // fallback to English
    if (_currentLang !== 'en' && _translations.en && _translations.en[key] !== undefined)
      return _translations.en[key];
    return fallback || key;
  };

  // setLang(lang) — switch language and reload
  window.setLang = function(lang) {
    if (lang !== 'en' && lang !== 'he') return;
    try { localStorage.setItem('xtix_lang', lang); } catch(e) {}
    location.reload();
  };

  // getCurrentLang() — get current language code
  window.getCurrentLang = function() { return _currentLang; };

  // isHebrew() — helper
  window.isHebrew = function() { return _currentLang === 'he'; };

  // expose translations for debugging
  window._LANG_DATA = _translations;

  console.log('[i18n] ✅ Language engine loaded — lang:', _currentLang,
    '| keys:', Object.keys(_translations[_currentLang] || {}).length);

})();
