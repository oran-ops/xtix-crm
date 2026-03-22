/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANDY Chain Generator — andy-chain.js                       ║
 * ║  Sprint 3 — שרשרת מיילים אוטומטית אחרי ניתוח ליד          ║
 * ║  v1.0 — 2026-03-12                                          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  CHANGELOG                                                   ║
 * ║  v1.0 — initial build                                       ║
 * ║    - andyGenerateChain() : נקרא אחרי triggerFullAnalysis    ║
 * ║    - מייצר 3-4 מיילים מותאמים לליד                         ║
 * ║    - שומר ב-outreach_queue כ-chain_draft                    ║
 * ║    - טאב ANDY מציג שרשרת + כפתור אישור                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FLOW:
 *  triggerFullAnalysis() → andyGenerateChain(leadId)
 *    → AI מייצר 3/4 מיילים כJSON
 *    → נשמרים ב-outreach_queue סטטוס chain_draft
 *    → טאב ANDY מציג שרשרת
 *    → משתמש לוחץ "אשר ושלח מייל 1"
 *    → מייל 1 → approved ונשלח
 *    → מיילים 2/3/4 → scheduled
 */

(function() {
  'use strict';

  function _log(msg) { console.log('[Chain] ' + msg); }

  var CHAIN_DAYS = { 1: 0, 2: 3, 3: 6, 4: 11 }; //  days מהיום לכל מייל

  // ── AI Call ───────────────────────────────────────────────────
  async function _callAI(prompt) {
    var resp = await window._authFetch(window.SERVER + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: 'אתה מומחה מכירות B2B. החזר JSON נקי בלבד ללא markdown.',
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(90000)
    });
    if (!resp.ok) throw new Error('AI error: ' + resp.status);
    var data = await resp.json();
    var raw = (data.content ? data.content.map(function(b){ return b.text||''; }).join('') : (data.result||data.text||'')).trim();
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    return JSON.parse(raw);
  }

  // ── Get KB methodology ────────────────────────────────────────
  async function _getKB() {
    try {
      if (typeof ensureMethodologyInSupabase === 'function') {
        return await ensureMethodologyInSupabase();
      }
      var rows = await window._sb.get('knowledge_base', 'status=eq.ready&limit=3');
      return (rows||[]).map(function(r){ return r.content||''; }).join('\n').substring(0, 1500);
    } catch(e) { return ''; }
  }

  // ── Get learning patterns ─────────────────────────────────────
  async function _getPatterns(lead) {
    try {
      var rows = await window._sb.get('learning_patterns', 'order=created_at.desc&limit=30');
      var seg = lead.segment || lead.type || '';
      return (rows||[]).filter(function(lp) {
        return (lp.outcome==='closed'||lp.outcome==='won') &&
               (!seg || (lp.segment||'').indexOf(seg)>=0 || seg.indexOf(lp.segment||'')>=0);
      }).slice(0,5).map(function(lp) {
        return '- ' + (lp.segment||'') + ' | pitch: ' + (lp.pitch_angle_used||'') + ' | subject שעבד: ' + (lp.email_subject_won||'');
      }).join('\n');
    } catch(e) { return ''; }
  }

  // ══════════════════════════════════════════════════════════════
  // andyGenerateChain — מייצר שרשרת מיילים אחרי ניתוח
  // ══════════════════════════════════════════════════════════════
  window.andyGenerateChain = async function(leadId) {
    var lead = (typeof leads !== 'undefined' ? leads : []).find(function(l){ return l.id===leadId; });
    if (!lead) { _log('Lead not found: ' + leadId); return; }

    var ai = lead.ai_analysis || {};

    // בדוק אם כבר קיימת שרשרת לליד זה
    try {
      var existing = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&status=eq.chain_draft&limit=1'
      );
      if (existing && existing.length) {
        _log('Chain already exists for lead ' + leadId + ' — skipping');
        _renderChainInAndyTab(leadId);
        return;
      }
    } catch(e) {}

    _log('Generating chain for lead ' + leadId);

    // עדכן UI — מציג טוען בטאב ANDY
    _showChainLoading(leadId);

    try {
      var kb = await _getKB();
      var patterns = await _getPatterns(lead);

      // החלט על מספר מיילים
      var score = lead.score || 0;
      var tier = ai.tier || (score >= 80 ? 'A' : score >= 60 ? 'B' : 'C');
      var totalEmails = (tier === 'A' || score >= 80) ? 4 : 3;

      var prompt = `אתה ANDY — מומחה מכירות B2B של XTIX Events.
Create a chain of ${totalEmails} personalized emails for this lead. Each email must follow from the previous — same thread, same approach but new angle.

=== פרטי הליד ===
שם: ${lead.name || '?'}
דומיין: ${lead.domain || '?'}
סגמנט: ${lead.segment || lead.type || '?'}
פלטפורמה נוכחית: ${lead.platform || ai.platform_current || '?'}
Score: ${score}/100 | Tier: ${tier}
Pitch Angle: ${lead.pitch_angle || ai.pitch_angle || '?'}
Pain Points: ${(ai.pain_points||[]).join(', ')||'?'}
Summary: ${(ai.summary||'').substring(0,400)}
מתחרה: ${lead.competitor || ai.competitor || '?'}

=== KB — מתודולוגיה ===
${kb.substring(0, 1200)}

=== Patterns שעבדו ===
${patterns || 'אין עדיין'}

=== Chain Strategy ===
Email 1 (Day 0): First Outreach — specific value + one question
Email 2 (Day 3): Follow-up — new angle, segment-specific data point
Email 3 (Day 6): More direct — ask about their problem, offer 15 minutes
${totalEmails === 4 ? 'Email 4 (Day 11): Breakup email — short, respectful, graceful exit' : ''}

=== חוקים ===
- כל מייל בעברית, אנושי וישיר
- 3-4 משפטים בגוף (לא רשימות)
- אל תכתוב שורת פתיחה (היי/שלום) — תתווסף אוטומטית
- אל תכתוב חתימה — תתווסף אוטומטית
- כל מייל חייב להיות עצמאי אבל בהמשך ישיר לקודם
- Subject line: קצר, ספציפי, שונה בכל מייל

החזר JSON בלבד:
{
  "total": ${totalEmails},
  "cadence_reasoning": "למה ${totalEmails} מיילים לליד זה",
  "emails": [
    {"seq": 1, "subject": "...", "body": "...", "reasoning": "...", "day": 0},
    {"seq": 2, "subject": "...", "body": "...", "reasoning": "...", "day": 3},
    {"seq": 3, "subject": "...", "body": "...", "reasoning": "...", "day": 6}
    ${totalEmails === 4 ? ',{"seq": 4, "subject": "...", "body": "...", "reasoning": "...", "day": 11}' : ''}
  ]
}`;

      var chain = await _callAI(prompt);
      if (!chain.emails || !chain.emails.length) throw new Error('No emails in response');

      var cadenceId = 'cad_' + leadId + '_' + Date.now();
      var now = new Date();

      // שמור כל מייל ב-outreach_queue כ-chain_draft
      for (var i = 0; i < chain.emails.length; i++) {
        var em = chain.emails[i];
        var sendAfter = new Date(now.getTime() + (em.day || 0) * 24 * 60 * 60 * 1000).toISOString();
        await window._sb.insert('outreach_queue', {
          lead_id:        leadId,
          channel:        'email',
          subject:        em.subject || '',
          body:           em.body    || '',
          reasoning:      em.reasoning || '',
          status:         'chain_draft',
          sequence_num:   em.seq || (i + 1),
          sequence_total: chain.total || chain.emails.length,
          cadence_id:     cadenceId,
          auto_generated: false,
          send_after:     sendAfter,
          scheduled_at:   sendAfter
        }).catch(function(e) { _log('Insert error: ' + e.message); });
      }

      // שמור cadence_id על הליד
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_id: cadenceId
      }).catch(function(){});

      _log('Chain created — ' + chain.emails.length + ' emails for lead ' + leadId);

      // הצג שרשרת בטאב ANDY
      _renderChainInAndyTab(leadId);

    } catch(e) {
      _log('Chain generation error: ' + e.message);
      _showChainError(leadId, e.message);
    }
  };

  // ── Show loading in ANDY tab ──────────────────────────────────
  function _showChainLoading(leadId) {
    var panel = document.getElementById('outreach-panel-' + leadId);
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML =
      '<div style="padding:20px;text-align:center">' +
      '<div style="width:32px;height:32px;border:3px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px"></div>' +
      '<div style="font-size:13px;color:var(--text);font-weight:700">ANDY is writing email chain...</div>' +
      '<div style="font-size:11px;color:var(--t2);margin-top:4px">מייצר ' + '' + ' מיילים מותאמים לליד</div>' +
      '</div>';
  }

  // ── Show error ────────────────────────────────────────────────
  function _showChainError(leadId, msg) {
    var panel = document.getElementById('outreach-panel-' + leadId);
    if (!panel) return;
    panel.innerHTML =
      '<div style="padding:14px;color:#ef4444;font-size:13px">❌ Chain generation error: ' + (msg||'') + '</div>';
  }

  // ══════════════════════════════════════════════════════════════
  // _renderChainInAndyTab — מציג שרשרת בטאב ANDY
  // ══════════════════════════════════════════════════════════════
  window._renderChainInAndyTab = async function(leadId) {
    _renderChainInAndyTab(leadId);
  };

  async function _renderChainInAndyTab(leadId) {
    var panel = document.getElementById('outreach-panel-' + leadId);
    if (!panel) return;

    panel.style.display = 'block';
    panel.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t2);font-size:12px">Loading chain...</div>';

    try {
      var rows = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&status=in.(chain_draft,pending_approval,approved,scheduled,sent)&order=sequence_num.asc'
      );

      if (!rows || !rows.length) {
        panel.innerHTML = '<div style="padding:14px;color:var(--t2);font-size:12px;text-align:center">No chain — click Write Outreach to create</div>';
        return;
      }

      var total = rows[0].sequence_total || rows.length;
      var lead = (typeof leads !== 'undefined' ? leads : []).find(function(l){ return l.id===leadId; });
      var cadenceId = rows[0].cadence_id;

      var html = '<div style="padding:4px">';

      // כותרת שרשרת
      html += '<div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.25);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:18px">🔗</span>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;font-size:13px;color:var(--text)">' + total + '-Email Chain</div>' +
          '<div style="font-size:11px;color:var(--t2)">Day 0 → +'+(rows[rows.length-1]?.send_after ? Math.round((new Date(rows[rows.length-1].send_after)-new Date())/(1000*60*60*24)) : '?')+'  days</div>' +
        '</div>' +
        '<button onclick="window._chainRegenerateConfirm(\'' + leadId + '\')" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--t2);cursor:pointer">🔄 Regenerate</button>' +
        '</div>';

      // כל מייל
      rows.forEach(function(row, i) {
        var dayLabel = i === 0 ? 'יום 0 — עכשיו' : '+' + Math.round((new Date(row.send_after)-new Date())/(1000*60*60*24)) + '  days';
        var bodyId = 'chain-body-' + row.id;

        html += '<div style="border:1px solid rgba(108,99,255,0.2);border-radius:10px;margin-bottom:8px;overflow:hidden">' +

          // כותרת מייל
          '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(108,99,255,0.06);cursor:pointer" onclick="var b=document.getElementById(\'' + bodyId + '\');b.style.display=b.style.display===\'none\'?\'block\':\'none\'">' +
            '<span style="background:var(--accent);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">' + row.sequence_num + '</span>' +
            '<div style="flex:1">' +
              '<div style="font-weight:700;font-size:12px;color:var(--text)">' + _escChain(row.subject) + '</div>' +
              '<div style="font-size:10px;color:var(--t2)">' + dayLabel + '</div>' +
            '</div>' +
            '<span style="font-size:11px;color:var(--t2)">▼</span>' +
          '</div>' +

          // גוף מייל
          '<div id="' + bodyId + '" style="display:' + (i===0?'block':'none') + ';padding:10px 12px">' +
            '<div style="font-size:12px;color:var(--text);line-height:1.7;white-space:pre-wrap;margin-bottom:8px">' + _escChain(row.body) + '</div>' +
            '<div style="font-size:11px;color:var(--t2);font-style:italic;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px">🧠 ' + _escChain(row.reasoning) + '</div>' +
          '</div>' +

        '</div>';
      });

      // כפתור אישור
      html += '<div style="margin-top:12px">' +
        '<button onclick="window._chainApproveAndSend(\'' + leadId + '\',\'' + cadenceId + '\')" ' +
          'style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:700;width:100%;cursor:pointer;font-family:Heebo,sans-serif">' +
          '✅ Approve & Send Email 1 — Start Chain' +
        '</button>' +
        '<div style="font-size:11px;color:var(--t2);text-align:center;margin-top:6px">מיילים 2-' + total + ' יישלחו אוטומטית לפי לוח הזמנים</div>' +
      '</div>';

      html += '</div>';
      panel.innerHTML = html;

    } catch(e) {
      panel.innerHTML = '<div style="padding:14px;color:#ef4444;font-size:12px">Error loading chain: ' + e.message + '</div>';
    }
  }

  // ── Escape helper ─────────────────────────────────────────────
  function _escChain(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ══════════════════════════════════════════════════════════════
  // _chainApproveAndSend — אישור + שליחת מייל 1 + תזמון 2/3/4
  // ══════════════════════════════════════════════════════════════
  window._chainApproveAndSend = async function(leadId, cadenceId) {
    var lead = (typeof leads !== 'undefined' ? leads : []).find(function(l){ return l.id===leadId; });
    if (!lead) { alert('ליד לא נמצא'); return; }
    if (!lead.email) { alert('אין כתובת מייל לליד — הוסף מייל בפרופיל'); return; }

    var panel = document.getElementById('outreach-panel-' + leadId);
    if (panel) panel.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t2);font-size:13px">שולח מייל 1...</div>';

    try {
      // קבל את כל מיילי השרשרת
      var rows = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&cadence_id=eq.' + cadenceId + '&status=in.(chain_draft,pending_approval,approved,scheduled,sent)&order=sequence_num.asc'
      );
      if (!rows || !rows.length) throw new Error('לא נמצאו מיילים בשרשרת');

      var firstEmail = rows[0];

      // שלח מייל 1
      var contactName = lead.contact_name || lead.name || '';
      var bodyLines = (firstEmail.body||'').split('\n').filter(function(l){ return l.trim(); });
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
          subject: firstEmail.subject,
          html:    htmlBody,
          text:    'היי ' + contactName + ',\n\n' + firstEmail.body + '\n\nבברכה,\nאורן\nxtix.ai'
        })
      });
      var sendData = await sendResp.json();
      if (!sendData.ok) throw new Error(sendData.error || 'שגיאת שליחה');

      // עדכן מייל 1 → approved
      await window._sb.update('outreach_queue', 'id=eq.' + firstEmail.id, {
        status:  'approved',
        sent_at: new Date().toISOString()
      });

      // עדכן מיילים 2+ → scheduled
      for (var i = 1; i < rows.length; i++) {
        await window._sb.update('outreach_queue', 'id=eq.' + rows[i].id, {
          status: 'scheduled',
          auto_generated: true
        }).catch(function(){});
      }

      // עדכן ליד
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_active:   true,
        last_outreach_at: new Date().toISOString(),
        outreach_count:   1,
        status:           'contacted'
      }).catch(function(){});

      if (panel) panel.innerHTML =
        '<div style="padding:14px;color:#10b981;font-size:13px;text-align:center">' +
        '✅ מייל 1 נשלח! שרשרת ' + rows.length + ' מיילים פעילה.<br>' +
        '<span style="font-size:11px;color:var(--t2)">עבור לטאב מיילים לצפייה בסטטוסים</span>' +
        '</div>';

      // רענן badge
      if (typeof window._outreachUpdateBadge === 'function') window._outreachUpdateBadge();
      if (typeof logActivity === 'function') {
        logActivity('outreach_sent', { lead_id: leadId, lead_name: lead.name||'', description: firstEmail.subject, channel: 'email' });
      }

    } catch(e) {
      if (panel) panel.innerHTML = '<div style="padding:14px;color:#ef4444;font-size:13px">❌ שגיאה: ' + e.message + '</div>';
    }
  };

  // ── Regenerate confirmation ────────────────────────────────────
  window._chainRegenerateConfirm = async function(leadId) {
    if (!confirm('צור שרשרת חדשה? השרשרת הקיימת תימחק.')) return;
    try {
      // מחק שרשרת קיימת
      var rows = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&status=in.(chain_draft,pending_approval,approved,scheduled,sent)'
      );
      for (var i = 0; i < (rows||[]).length; i++) {
        await window._sb.delete('outreach_queue', 'id=eq.' + rows[i].id).catch(function(){});
      }
    } catch(e) {}
    window.andyGenerateChain(leadId);
  };

  _log('Chain engine loaded ✅');

})();
