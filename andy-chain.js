/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANDY Chain Generator — andy-chain.js                       ║
 * ║  Sprint 3 — Automatic email chain after lead analysis        ║
 * ║  v1.0 — 2026-03-12                                          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  CHANGELOG                                                   ║
 * ║  v1.0 — initial build                                       ║
 * ║    - andyGenerateChain() : called after triggerFullAnalysis   ║
 * ║    - Generates 3-4 personalized emails for the lead         ║
 * ║    - Saves to outreach_queue as chain_draft                 ║
 * ║    - ANDY tab displays chain + approval button              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FLOW:
 *  triggerFullAnalysis() → andyGenerateChain(leadId)
 *    → AI generates 3/4 emails as JSON
 *    → Saved to outreach_queue status chain_draft
 *    → ANDY tab displays chain
 *    → User clicks "Approve & Send Email 1"
 *    → Email 1 → approved and sent
 *    → Emails 2/3/4 → scheduled
 */

(function() {
  'use strict';

  function _log(msg) { console.log('[Chain] ' + msg); }

  var CHAIN_DAYS = { 1: 0, 2: 3, 3: 6, 4: 11 }; //  days from today for each email

  // ── AI Call ───────────────────────────────────────────────────
  async function _callAI(prompt) {
    var resp = await window._authFetch(window.SERVER + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: 'You are a B2B sales expert. Return clean JSON only, no markdown.',
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
        return '- ' + (lp.segment||'') + ' | pitch: ' + (lp.pitch_angle_used||'') + ' | winning subject: ' + (lp.email_subject_won||'');
      }).join('\n');
    } catch(e) { return ''; }
  }

  // ══════════════════════════════════════════════════════════════
  // andyGenerateChain — generates email chain after analysis
  // ══════════════════════════════════════════════════════════════
  window.andyGenerateChain = async function(leadId) {
    var lead = (typeof leads !== 'undefined' ? leads : []).find(function(l){ return l.id===leadId; });
    if (!lead) { _log('Lead not found: ' + leadId); return; }

    var ai = lead.ai_analysis || {};

    // Check if chain already exists for this lead
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

    // Update UI — show loading in ANDY tab
    _showChainLoading(leadId);

    try {
      var kb = await _getKB();
      var patterns = await _getPatterns(lead);

      // Decide on number of emails
      var score = lead.score || 0;
      var tier = ai.tier || (score >= 80 ? 'A' : score >= 60 ? 'B' : 'C');
      var totalEmails = (tier === 'A' || score >= 80) ? 4 : 3;

      var prompt = `You are ANDY — a B2B sales expert at XTIX Events.
Create a chain of ${totalEmails} personalized emails for this lead. Each email must follow from the previous — same thread, same approach but new angle.

=== Lead Details ===
Name: ${lead.name || '?'}
Domain: ${lead.domain || '?'}
Segment: ${lead.segment || lead.type || '?'}
Current Platform: ${lead.platform || ai.platform_current || '?'}
Score: ${score}/100 | Tier: ${tier}
Pitch Angle: ${lead.pitch_angle || ai.pitch_angle || '?'}
Pain Points: ${(ai.pain_points||[]).join(', ')||'?'}
Summary: ${(ai.summary||'').substring(0,400)}
Competitor: ${lead.competitor || ai.competitor || '?'}

=== KB — Methodology ===
${kb.substring(0, 1200)}

=== Winning Patterns ===
${patterns || 'None yet'}

=== Chain Strategy ===
Email 1 (Day 0): First Outreach — specific value + one question
Email 2 (Day 3): Follow-up — new angle, segment-specific data point
Email 3 (Day 6): More direct — ask about their problem, offer 15 minutes
${totalEmails === 4 ? 'Email 4 (Day 11): Breakup email — short, respectful, graceful exit' : ''}

=== Rules ===
- Each email in English, human and direct
- 3-4 sentences in body (no lists)
- Do not write greeting line (Hi/Hello) — will be added automatically
- Do not write signature — will be added automatically
- Each email must be standalone but a direct continuation of the previous
- Subject line: short, specific, different for each email

Return JSON only:
{
  "total": ${totalEmails},
  "cadence_reasoning": "Why ${totalEmails} emails for this lead",
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

      // Save each email to outreach_queue as chain_draft
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

      // Save cadence_id on the lead
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_id: cadenceId
      }).catch(function(){});

      _log('Chain created — ' + chain.emails.length + ' emails for lead ' + leadId);

      // Display chain in ANDY tab
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
      '<div style="font-size:11px;color:var(--t2);margin-top:4px">Generating personalized emails for lead</div>' +
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
  // _renderChainInAndyTab — displays chain in ANDY tab
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

      // Chain title
      html += '<div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.25);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:18px">🔗</span>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;font-size:13px;color:var(--text)">' + total + '-Email Chain</div>' +
          '<div style="font-size:11px;color:var(--t2)">Day 0 → +'+(rows[rows.length-1]?.send_after ? Math.round((new Date(rows[rows.length-1].send_after)-new Date())/(1000*60*60*24)) : '?')+'  days</div>' +
        '</div>' +
        '<button onclick="window._chainRegenerateConfirm(\'' + leadId + '\')" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--t2);cursor:pointer">🔄 Regenerate</button>' +
        '</div>';

      // Each email
      rows.forEach(function(row, i) {
        var dayLabel = i === 0 ? 'Day 0 — Now' : '+' + Math.round((new Date(row.send_after)-new Date())/(1000*60*60*24)) + '  days';
        var bodyId = 'chain-body-' + row.id;

        html += '<div style="border:1px solid rgba(108,99,255,0.2);border-radius:10px;margin-bottom:8px;overflow:hidden">' +

          // Email header
          '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(108,99,255,0.06);cursor:pointer" onclick="var b=document.getElementById(\'' + bodyId + '\');b.style.display=b.style.display===\'none\'?\'block\':\'none\'">' +
            '<span style="background:var(--accent);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">' + row.sequence_num + '</span>' +
            '<div style="flex:1">' +
              '<div style="font-weight:700;font-size:12px;color:var(--text)">' + _escChain(row.subject) + '</div>' +
              '<div style="font-size:10px;color:var(--t2)">' + dayLabel + '</div>' +
            '</div>' +
            '<span style="font-size:11px;color:var(--t2)">▼</span>' +
          '</div>' +

          // Email body
          '<div id="' + bodyId + '" style="display:' + (i===0?'block':'none') + ';padding:10px 12px">' +
            '<div style="font-size:12px;color:var(--text);line-height:1.7;white-space:pre-wrap;margin-bottom:8px">' + _escChain(row.body) + '</div>' +
            '<div style="font-size:11px;color:var(--t2);font-style:italic;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px">🧠 ' + _escChain(row.reasoning) + '</div>' +
          '</div>' +

        '</div>';
      });

      // Approval button
      html += '<div style="margin-top:12px">' +
        '<button onclick="window._chainApproveAndSend(\'' + leadId + '\',\'' + cadenceId + '\')" ' +
          'style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:700;width:100%;cursor:pointer;font-family:Heebo,sans-serif">' +
          '✅ Approve & Send Email 1 — Start Chain' +
        '</button>' +
        '<div style="font-size:11px;color:var(--t2);text-align:center;margin-top:6px">Emails 2-' + total + ' will be sent automatically per schedule</div>' +
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
  // _chainApproveAndSend — approve + send email 1 + schedule 2/3/4
  // ══════════════════════════════════════════════════════════════
  window._chainApproveAndSend = async function(leadId, cadenceId) {
    var lead = (typeof leads !== 'undefined' ? leads : []).find(function(l){ return l.id===leadId; });
    if (!lead) { alert('Lead not found'); return; }
    if (!lead.email) { alert('No email address for lead — add email in profile'); return; }

    var panel = document.getElementById('outreach-panel-' + leadId);
    if (panel) panel.innerHTML = '<div style="padding:14px;text-align:center;color:var(--t2);font-size:13px">Sending email 1...</div>';

    try {
      // Get all chain emails
      var rows = await window._sb.get('outreach_queue',
        'lead_id=eq.' + leadId + '&cadence_id=eq.' + cadenceId + '&status=in.(chain_draft,pending_approval,approved,scheduled,sent)&order=sequence_num.asc'
      );
      if (!rows || !rows.length) throw new Error('No emails found in chain');

      var firstEmail = rows[0];

      // Send email 1
      var contactName = lead.contact_name || lead.name || '';
      var bodyLines = (firstEmail.body||'').split('\n').filter(function(l){ return l.trim(); });
      var htmlBody =
        '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.8;color:#222;max-width:560px">' +
        '<p style="margin:0 0 16px">Hi ' + contactName + ',</p>' +
        bodyLines.map(function(l){ return '<p style="margin:0 0 12px">' + l + '</p>'; }).join('') +
        '<p style="margin:16px 0 4px">Best regards,</p>' +
        '<p style="margin:0"><strong>Oren</strong><br><a href="https://xtix.ai" style="color:#6c63ff">xtix.ai</a></p>' +
        '</div>';

      var sendResp = await window._authFetch(window.SERVER + '/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:      lead.email,
          subject: firstEmail.subject,
          html:    htmlBody,
          text:    'Hi ' + contactName + ',\n\n' + firstEmail.body + '\n\nBest regards,\nOren\nxtix.ai'
        })
      });
      var sendData = await sendResp.json();
      if (!sendData.ok) throw new Error(sendData.error || 'Send error');

      // Update email 1 → approved
      await window._sb.update('outreach_queue', 'id=eq.' + firstEmail.id, {
        status:  'approved',
        sent_at: new Date().toISOString()
      });

      // Update emails 2+ → scheduled
      for (var i = 1; i < rows.length; i++) {
        await window._sb.update('outreach_queue', 'id=eq.' + rows[i].id, {
          status: 'scheduled',
          auto_generated: true
        }).catch(function(){});
      }

      // Update lead
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_active:   true,
        last_outreach_at: new Date().toISOString(),
        outreach_count:   1,
        status:           'contacted'
      }).catch(function(){});

      if (panel) panel.innerHTML =
        '<div style="padding:14px;color:#10b981;font-size:13px;text-align:center">' +
        '✅ Email 1 sent! Chain of ' + rows.length + ' emails active.<br>' +
        '<span style="font-size:11px;color:var(--t2)">Go to Emails tab to view statuses</span>' +
        '</div>';

      // Refresh badge
      if (typeof window._outreachUpdateBadge === 'function') window._outreachUpdateBadge();
      if (typeof logActivity === 'function') {
        logActivity('outreach_sent', { lead_id: leadId, lead_name: lead.name||'', description: firstEmail.subject, channel: 'email' });
      }

    } catch(e) {
      if (panel) panel.innerHTML = '<div style="padding:14px;color:#ef4444;font-size:13px">❌ Error: ' + e.message + '</div>';
    }
  };

  // ── Regenerate confirmation ────────────────────────────────────
  window._chainRegenerateConfirm = async function(leadId) {
    if (!confirm('Create new chain? The existing chain will be deleted.')) return;
    try {
      // Delete existing chain
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
