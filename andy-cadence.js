/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANDY Cadence Engine — js/andy-cadence.js                   ║
 * ║  Sprint 3 — Follow-up & Re-engagement                       ║
 * ║  v1.0 — 2026-03-12                                          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  CHANGELOG                                                   ║
 * ║  v1.0 — initial build                                       ║
 * ║    - andyCadenceStart()  : מפעיל cadence אחרי מייל ראשון   ║
 * ║    - andyCadenceTick()   : scheduler — רץ כל שעה           ║
 * ║    - andyCadenceGenerate(): ANDY מייצר מייל המשך            ║
 * ║    - andyGhostedCheck()  : בודק ghosted → re-engagement     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FLOW:
 *  מייל 1 (ידני) → andyCadenceStart()
 *    → +3 ימים  → מייל 2 (אוטומטי)
 *    → +3 ימים  → מייל 3 (אוטומטי)
 *    → +5 ימים  → מייל 4 (אוטומטי, אם ANDY החליט על 4)
 *    → אין תגובה → ghosted → +14 יום → re-engagement
 *
 * DEPENDENCIES: window._sb, window._authFetch, window.SERVER
 */

(function() {
  'use strict';

  // ── Config ────────────────────────────────────────────────────
  var CADENCE_DAYS = [0, 3, 3, 5]; // ימים בין כל מייל (index = sequence_num-1)
  var GHOSTED_DAYS = 14;
  var TICK_INTERVAL = 60 * 60 * 1000; // שעה אחת

  // ── Helpers ───────────────────────────────────────────────────
  function _log(msg) { console.log('[Cadence] ' + msg); }

  function _daysAgo(dateStr) {
    if (!dateStr) return 999;
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  }

  function _addDays(dateStr, days) {
    var d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  function _cadenceId(leadId) {
    return 'cad_' + leadId + '_' + Date.now();
  }

  // ── AI Call ───────────────────────────────────────────────────
  async function _callAI(prompt) {
    var resp = await window._authFetch(window.SERVER + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'אתה מומחה מכירות B2B. החזר JSON נקי בלבד ללא markdown.',
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) throw new Error('AI error: ' + resp.status);
    var data = await resp.json();
    var raw = (data.content ? data.content.map(function(b){ return b.text||''; }).join('') : (data.result||data.text||'')).trim();
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    return JSON.parse(raw);
  }

  // ── Get previous emails in cadence ───────────────────────────
  async function _getPreviousEmails(leadId, cadenceId) {
    try {
      var rows = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&cadence_id=eq.' + cadenceId + '&order=sequence_num.asc'
      );
      return rows || [];
    } catch(e) { return []; }
  }

  // ── Get lead ─────────────────────────────────────────────────
  async function _getLead(leadId) {
    try {
      var rows = await window._sb.get('leads', 'id=eq.' + leadId + '&limit=1');
      return (rows || [])[0] || null;
    } catch(e) { return null; }
  }

  // ══════════════════════════════════════════════════════════════
  // andyCadenceStart — קורא לאחר שליחת מייל ראשון
  // params: leadId, firstEmailRow (שורה מה-outreach_queue)
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceStart = async function(leadId, firstEmailRow) {
    try {
      var lead = await _getLead(leadId);
      if (!lead) { _log('Lead not found: ' + leadId); return; }

      // ANDY מחליט על מספר מיילים (3 או 4) בהתבסס על הליד
      var decisionPrompt = `אתה ANDY. בהתבסס על הליד הבא, האם cadence של 3 או 4 מיילים?
ליד: ${lead.name || '?'} | Score: ${lead.score || 0} | Tier: ${(lead.ai_analysis||{}).tier || '?'} | Segment: ${lead.segment || '?'}
כלל: Tier A (score 80+) = 4 מיילים. Tier B/C = 3 מיילים. אם יש סיבה מיוחדת תסביר.
החזר JSON: {"total_emails": 3, "reasoning": "..."}`;

      var decision = await _callAI(decisionPrompt).catch(function() {
        return { total_emails: 3, reasoning: 'ברירת מחדל' };
      });

      var totalEmails = decision.total_emails === 4 ? 4 : 3;
      var cadId = firstEmailRow && firstEmailRow.cadence_id
        ? firstEmailRow.cadence_id
        : _cadenceId(leadId);

      // עדכן את המייל הראשון עם cadence info
      if (firstEmailRow && firstEmailRow.id) {
        await window._sb.update('outreach_queue', 'id=eq.' + firstEmailRow.id, {
          sequence_num:   1,
          sequence_total: totalEmails,
          cadence_id:     cadId,
          auto_generated: false
        }).catch(function(){});
      }

      // עדכן הליד
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_active:   true,
        cadence_id:       cadId,
        last_outreach_at: new Date().toISOString(),
        outreach_count:   1
      }).catch(function(){});

      _log('Cadence started for ' + leadId + ' — ' + totalEmails + ' emails. ID: ' + cadId);

      // תזמן את המיילים הבאים
      await _scheduleNextEmail(lead, cadId, 1, totalEmails, firstEmailRow);

    } catch(e) {
      _log('andyCadenceStart error: ' + e.message);
    }
  };

  // ── Schedule next email in cadence ───────────────────────────
  async function _scheduleNextEmail(lead, cadenceId, currentSeq, totalEmails, currentEmailRow) {
    if (currentSeq >= totalEmails) {
      _log('Cadence complete for lead ' + lead.id + ' — all ' + totalEmails + ' emails scheduled');
      return;
    }

    var nextSeq = currentSeq + 1;
    var daysToWait = CADENCE_DAYS[nextSeq - 1] || 3;
    var sendAfter = _addDays(new Date().toISOString(), daysToWait);

    // יצור placeholder לבמייל הבא — body יוכן כשמגיע הזמן
    var nextRow = {
      lead_id:        lead.id,
      channel:        'email',
      subject:        '',
      body:           '',
      reasoning:      'ממתין לייצור תוכן — יוכן ' + daysToWait + ' ימים אחרי המייל הקודם',
      status:         'scheduled',
      sequence_num:   nextSeq,
      sequence_total: totalEmails,
      cadence_id:     cadenceId,
      auto_generated: true,
      send_after:     sendAfter,
      scheduled_at:   sendAfter
    };

    await window._sb.insert('outreach_queue', nextRow).catch(function(e) {
      _log('Schedule insert error: ' + e.message);
    });

    _log('Scheduled email ' + nextSeq + '/' + totalEmails + ' for lead ' + lead.id + ' — send after ' + sendAfter);
  }

  // ══════════════════════════════════════════════════════════════
  // andyCadenceGenerate — מייצר תוכן למייל ממתין
  // קורא לו andyCadenceTick כשהגיע הזמן
  // ══════════════════════════════════════════════════════════════
  async function andyCadenceGenerate(pendingRow) {
    var lead = await _getLead(pendingRow.lead_id);
    if (!lead) return;

    var previousEmails = await _getPreviousEmails(pendingRow.lead_id, pendingRow.cadence_id);
    var sentEmails = previousEmails.filter(function(r) {
      return r.status === 'approved' || r.status === 'sent';
    });

    var seqNum   = pendingRow.sequence_num || 2;
    var seqTotal = pendingRow.sequence_total || 3;
    var ai = lead.ai_analysis || {};

    // בנה סיכום מיילים קודמים לקונטקסט
    var prevSummary = sentEmails.map(function(e, i) {
      return 'מייל ' + (i+1) + ':\nנושא: ' + e.subject + '\nתוכן: ' + (e.body || '').substring(0, 300);
    }).join('\n\n');

    // הגדר אסטרטגיה לכל שלב
    var strategies = {
      2: 'מייל המשך — הוסף ערך חדש שלא הוזכר במייל הראשון. הצג case study קצר או data point ספציפי לסגמנט שלהם. אל תחזור על מה שנאמר.',
      3: 'מייל שלישי — הגישה משתנה. יותר ישיר. שאל שאלה פתוחה אחת חדה על הבעיה שלהם. הצע שיחה קצרה של 15 דקות.',
      4: 'מייל רביעי ואחרון — "Breakup email". ישיר, קצר, מכבד. ספר שאתה מסגר את הנושא אלא אם יש עניין. תן להם exit מכובד.'
    };

    var strategy = strategies[seqNum] || strategies[2];

    var prompt = `אתה ANDY — מומחה מכירות B2B של XTIX.
זהו מייל מספר ${seqNum} מתוך ${seqTotal} בסדרה לאותו ליד. אין תגובה עדיין.

=== פרטי הליד ===
שם: ${lead.name || '?'}
דומיין: ${lead.domain || '?'}
סגמנט: ${lead.segment || lead.type || '?'}
פלטפורמה: ${lead.platform || ai.platform_current || '?'}
Score: ${lead.score || 0}/100
Pitch Angle: ${lead.pitch_angle || ai.pitch_angle || '?'}
Pain Points: ${(ai.pain_points || []).join(', ') || '?'}

=== מיילים קודמים שנשלחו ===
${prevSummary || 'אין עדיין — זה המייל הראשון בסדרה'}

=== אסטרטגיה למייל זה ===
${strategy}

=== חוקים ===
- כתוב בעברית, סגנון אנושי וישיר
- 2-4 משפטים בגוף (לא רשימות)
- אל תחזור על מה שנכתב במיילים הקודמים
- המייל חייב להיות בהמשך ישיר לסדרה — אותו thread
- אל תכתוב שורת פתיחה (היי/שלום) — תתווסף אוטומטית
- אל תכתוב חתימה — תתווסף אוטומטית

החזר JSON בלבד: {"subject":"...","body":"...","reasoning":"..."}`;

    var outreach = await _callAI(prompt);

    // עדכן את השורה הקיימת עם התוכן
    await window._sb.update('outreach_queue', 'id=eq.' + pendingRow.id, {
      subject:   outreach.subject || '',
      body:      outreach.body    || '',
      reasoning: outreach.reasoning || '',
      status:    'auto_ready'  // מוכן לשליחה אוטומטית
    });

    _log('Generated email ' + seqNum + '/' + seqTotal + ' for lead ' + pendingRow.lead_id);

    // שלח אוטומטית
    await _autoSend(pendingRow.id, pendingRow.lead_id, outreach, lead);

    // תזמן את הבא אם יש
    if (seqNum < seqTotal) {
      await _scheduleNextEmail(lead, pendingRow.cadence_id, seqNum, seqTotal, pendingRow);
    } else {
      // סוף cadence — עדכן ליד
      await window._sb.update('leads', 'id=eq.' + lead.id, {
        cadence_active: false
      }).catch(function(){});
      _log('Cadence ended for lead ' + lead.id + ' — no response after ' + seqTotal + ' emails');

      // תזמן ghosted check
      await _scheduleGhostedCheck(lead);
    }
  }

  // ── Auto send ─────────────────────────────────────────────────
  async function _autoSend(rowId, leadId, outreach, lead) {
    if (!lead.email) {
      _log('No email for lead ' + leadId + ' — skipping send');
      return;
    }

    try {
      var contactName = lead.contact_name || lead.name || '';
      var bodyLines = (outreach.body || '').split('\n').filter(function(l){ return l.trim(); });
      var htmlBody =
        '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.8;color:#222;max-width:560px">' +
        '<p style="margin:0 0 16px">היי ' + contactName + ',</p>' +
        bodyLines.map(function(l){ return '<p style="margin:0 0 12px">' + l + '</p>'; }).join('') +
        '<p style="margin:16px 0 4px">בברכה,</p>' +
        '<p style="margin:0"><strong>אורן</strong><br><a href="https://xtix.ai" style="color:#6c63ff">xtix.ai</a></p>' +
        '</div>';

      var sendResp = await window._authFetch(window.SERVER + '/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:      lead.email,
          subject: outreach.subject,
          html:    htmlBody,
          text:    'היי ' + contactName + ',\n\n' + outreach.body + '\n\nבברכה,\nאורן\nxtix.ai'
        })
      });

      var sendData = await sendResp.json();
      if (sendData.ok) {
        await window._sb.update('outreach_queue', 'id=eq.' + rowId, {
          status:  'approved',
          sent_at: new Date().toISOString()
        }).catch(function(){});
        await window._sb.update('leads', 'id=eq.' + leadId, {
          last_outreach_at: new Date().toISOString(),
          outreach_count:   (lead.outreach_count || 0) + 1
        }).catch(function(){});
        _log('Auto-sent email to ' + lead.email);
      } else {
        _log('Send failed: ' + (sendData.error || 'unknown'));
        await window._sb.update('outreach_queue', 'id=eq.' + rowId, {
          status: 'send_failed'
        }).catch(function(){});
      }
    } catch(e) {
      _log('_autoSend error: ' + e.message);
    }
  }

  // ── Schedule ghosted check ─────────────────────────────────────
  async function _scheduleGhostedCheck(lead) {
    var ghostedAt = _addDays(new Date().toISOString(), GHOSTED_DAYS);
    await window._sb.update('leads', 'id=eq.' + lead.id, {
      ghosted_at: ghostedAt
    }).catch(function(){});
    _log('Ghosted check scheduled for ' + lead.id + ' at ' + ghostedAt);
  }

  // ══════════════════════════════════════════════════════════════
  // andyGhostedCheck — Re-engagement אחרי 14 יום
  // ══════════════════════════════════════════════════════════════
  async function andyGhostedCheck(lead) {
    _log('Running ghosted re-engagement for lead ' + lead.id);

    var ai = lead.ai_analysis || {};
    var prompt = `אתה ANDY. ליד זה לא הגיב ל-${lead.outreach_count || 3} מיילים. עבר 14 יום.
שם: ${lead.name || '?'} | סגמנט: ${lead.segment || '?'} | Score: ${lead.score || 0}

כתוב מייל re-engagement שונה לחלוטין מהגישה הקודמת:
- גישה חדשה לחלוטין — זווית אחרת
- קצר מאוד (2 משפטים)
- אל תזכיר שניסית קודם
- נסה גישת "חדשות/insight" — שתף משהו רלוונטי לסגמנט שלהם
- סיים בשאלה פשוטה אחת

החזר JSON: {"subject":"...","body":"...","reasoning":"..."}`;

    try {
      var outreach = await _callAI(prompt);

      // הוסף לתור כ-pending_approval (re-engagement = ידני)
      var row = {
        lead_id:        lead.id,
        channel:        'email',
        subject:        outreach.subject || '',
        body:           outreach.body    || '',
        reasoning:      '[Re-engagement] ' + (outreach.reasoning || ''),
        status:         'pending_approval',
        sequence_num:   0,  // re-engagement = לא חלק מה-cadence הרגיל
        auto_generated: true,
        cadence_id:     'reeng_' + lead.id + '_' + Date.now()
      };

      await window._sb.insert('outreach_queue', row);

      // עדכן ליד לsגtatus ghosted
      await window._sb.update('leads', 'id=eq.' + lead.id, {
        status:     'ghosted',
        ghosted_at: null  // נוקה — כדי שלא ירוץ שוב
      }).catch(function(){});

      if (typeof window._outreachLoad === 'function') setTimeout(window._outreachLoad, 500);
      if (typeof window._outreachUpdateBadge === 'function') window._outreachUpdateBadge();

      _log('Re-engagement created for lead ' + lead.id);
    } catch(e) {
      _log('Ghosted re-engagement error: ' + e.message);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // andyCadenceTick — רץ כל שעה, בודק מה צריך לשלוח
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceTick = async function() {
    if (!window._sb || !window.currentUser) return;
    _log('Tick — checking scheduled emails...');

    var now = new Date().toISOString();

    try {
      // 1. בדוק מיילים שהגיע זמנם לייצר ולשלוח
      var scheduled = await window._sb.get('outreach_queue',
        'status=eq.scheduled&send_after=lte.' + now + '&auto_generated=eq.true&limit=10'
      ).catch(function(){ return []; });

      for (var i = 0; i < (scheduled || []).length; i++) {
        var row = scheduled[i];
        _log('Processing scheduled email for lead ' + row.lead_id + ' seq ' + row.sequence_num);
        try {
          await andyCadenceGenerate(row);
        } catch(e) {
          _log('Generate error for ' + row.id + ': ' + e.message);
        }
      }

      // 2. בדוק לידים שצריך re-engagement (ghosted_at עבר)
      var ghostedLeads = await window._sb.get('leads',
        'ghosted_at=lte.' + now + '&cadence_active=eq.false&limit=5'
      ).catch(function(){ return []; });

      for (var j = 0; j < (ghostedLeads || []).length; j++) {
        var lead = ghostedLeads[j];
        try {
          await andyGhostedCheck(lead);
        } catch(e) {
          _log('Ghosted check error for ' + lead.id + ': ' + e.message);
        }
      }

    } catch(e) {
      _log('Tick error: ' + e.message);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // INIT — מפעיל את ה-ticker
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceInit = function() {
    // הפעל מיד + כל שעה
    setTimeout(window.andyCadenceTick, 5000);
    setInterval(window.andyCadenceTick, TICK_INTERVAL);
    _log('Cadence engine initialized — tick every 1h');
  };

  // Auto-init אחרי שה-auth מוכן
  var _initInterval = setInterval(function() {
    if (window.currentUser && window._sb && window.SERVER) {
      clearInterval(_initInterval);
      window.andyCadenceInit();
    }
  }, 2000);

})();
