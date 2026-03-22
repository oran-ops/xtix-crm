/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ANDY Cadence Engine — js/andy-cadence.js                   ║
 * ║  Sprint 3 — Follow-up & Re-engagement                       ║
 * ║  v1.0 — 2026-03-12                                          ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  CHANGELOG                                                   ║
 * ║  v1.0 — initial build                                       ║
 * ║    - andyCadenceStart()  : starts cadence after first email   ║
 * ║    - andyCadenceTick()   : scheduler — runs every hour      ║
 * ║    - andyCadenceGenerate(): ANDY generates follow-up email   ║
 * ║    - andyGhostedCheck()  : checks ghosted → re-engagement   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FLOW:
 *  Email 1 (manual) → andyCadenceStart()
 *    → +3 days  → Email 2 (automatic)
 *    → +3 days  → Email 3 (automatic)
 *    → +5 days  → Email 4 (automatic, if ANDY decided on 4)
 *    → No response → ghosted → +14 days → re-engagement
 *
 * DEPENDENCIES: window._sb, window._authFetch, window.SERVER
 */

(function() {
  'use strict';

  // ── Config ────────────────────────────────────────────────────
  var CADENCE_DAYS = [0, 3, 3, 5]; // days between each email (index = sequence_num-1)
  var GHOSTED_DAYS = 14;
  var TICK_INTERVAL = 60 * 60 * 1000; // one hour

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
        system: 'You are a B2B sales expert. Return clean JSON only, no markdown.',
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
  // andyCadenceStart — called after sending first email
  // params: leadId, firstEmailRow (row from outreach_queue)
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceStart = async function(leadId, firstEmailRow) {
    try {
      var lead = await _getLead(leadId);
      if (!lead) { _log('Lead not found: ' + leadId); return; }

      // ANDY decides on number of emails (3 or 4) based on lead
      var decisionPrompt = `You are ANDY. Based on the following lead, should the cadence be 3 or 4 emails?
Lead: ${lead.name || '?'} | Score: ${lead.score || 0} | Tier: ${(lead.ai_analysis||{}).tier || '?'} | Segment: ${lead.segment || '?'}
Rule: Tier A (score 80+) = 4 emails. Tier B/C = 3 emails. If there's a special reason, explain.
Return JSON: {"total_emails": 3, "reasoning": "..."}`;

      var decision = await _callAI(decisionPrompt).catch(function() {
        return { total_emails: 3, reasoning: 'Default' };
      });

      var totalEmails = decision.total_emails === 4 ? 4 : 3;
      var cadId = firstEmailRow && firstEmailRow.cadence_id
        ? firstEmailRow.cadence_id
        : _cadenceId(leadId);

      // Update first email with cadence info
      if (firstEmailRow && firstEmailRow.id) {
        await window._sb.update('outreach_queue', 'id=eq.' + firstEmailRow.id, {
          sequence_num:   1,
          sequence_total: totalEmails,
          cadence_id:     cadId,
          auto_generated: false
        }).catch(function(){});
      }

      // Update lead
      await window._sb.update('leads', 'id=eq.' + leadId, {
        cadence_active:   true,
        cadence_id:       cadId,
        last_outreach_at: new Date().toISOString(),
        outreach_count:   1
      }).catch(function(){});

      _log('Cadence started for ' + leadId + ' — ' + totalEmails + ' emails. ID: ' + cadId);

      // Schedule next emails
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

    // Create placeholder for next email — body will be generated when time comes
    var nextRow = {
      lead_id:        lead.id,
      channel:        'email',
      subject:        '',
      body:           '',
      reasoning:      'Waiting for content generation — will be ready ' + daysToWait + ' days after previous email',
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
  // andyCadenceGenerate — generates content for pending email
  // Called by andyCadenceTick when time comes
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

    // Build summary of previous emails for context
    var prevSummary = sentEmails.map(function(e, i) {
      return 'Email ' + (i+1) + ':\nSubject: ' + e.subject + '\nContent: ' + (e.body || '').substring(0, 300);
    }).join('\n\n');

    // Define strategy for each stage
    var strategies = {
      2: 'Follow-up email — add new value not mentioned in first email. Show a short case study or segment-specific data point. Do not repeat what was said.',
      3: 'Third email — approach changes. More direct. Ask one sharp open question about their problem. Offer a short 15-minute call.',
      4: 'Fourth and final email — "Breakup email". Direct, short, respectful. Say you\'re closing the topic unless there\'s interest. Give them a graceful exit.'
    };

    var strategy = strategies[seqNum] || strategies[2];

    var prompt = `You are ANDY — a B2B sales expert at XTIX.
This is email number ${seqNum} out of ${seqTotal} in the series for the same lead. No response yet.

=== Lead Details ===
Name: ${lead.name || '?'}
Domain: ${lead.domain || '?'}
Segment: ${lead.segment || lead.type || '?'}
Platform: ${lead.platform || ai.platform_current || '?'}
Score: ${lead.score || 0}/100
Pitch Angle: ${lead.pitch_angle || ai.pitch_angle || '?'}
Pain Points: ${(ai.pain_points || []).join(', ') || '?'}

=== Previously Sent Emails ===
${prevSummary || 'None yet — this is the first email in the series'}

=== Strategy for This Email ===
${strategy}

=== Rules ===
- Write in English, human and direct style
- 2-4 sentences in body (no lists)
- Do not repeat what was written in previous emails
- Email must be a direct continuation of the series — same thread
- Do not write greeting line (Hi/Hello) — will be added automatically
- Do not write signature — will be added automatically

Return JSON only: {"subject":"...","body":"...","reasoning":"..."}`;

    var outreach = await _callAI(prompt);

    // Update existing row with content
    await window._sb.update('outreach_queue', 'id=eq.' + pendingRow.id, {
      subject:   outreach.subject || '',
      body:      outreach.body    || '',
      reasoning: outreach.reasoning || '',
      status:    'auto_ready'  // ready for auto-send
    });

    _log('Generated email ' + seqNum + '/' + seqTotal + ' for lead ' + pendingRow.lead_id);

    // Auto-send
    await _autoSend(pendingRow.id, pendingRow.lead_id, outreach, lead);

    // Schedule next if any
    if (seqNum < seqTotal) {
      await _scheduleNextEmail(lead, pendingRow.cadence_id, seqNum, seqTotal, pendingRow);
    } else {
      // End of cadence — update lead
      await window._sb.update('leads', 'id=eq.' + lead.id, {
        cadence_active: false
      }).catch(function(){});
      _log('Cadence ended for lead ' + lead.id + ' — no response after ' + seqTotal + ' emails');

      // Schedule ghosted check
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
          subject: outreach.subject,
          html:    htmlBody,
          text:    'Hi ' + contactName + ',\n\n' + outreach.body + '\n\nBest regards,\nOren\nxtix.ai'
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
  // andyGhostedCheck — Re-engagement after 14 days
  // ══════════════════════════════════════════════════════════════
  async function andyGhostedCheck(lead) {
    _log('Running ghosted re-engagement for lead ' + lead.id);

    var ai = lead.ai_analysis || {};
    var prompt = `You are ANDY. This lead hasn't responded to ${lead.outreach_count || 3} emails. 14 days have passed.
Name: ${lead.name || '?'} | Segment: ${lead.segment || '?'} | Score: ${lead.score || 0}

Write a re-engagement email completely different from the previous approach:
- Entirely new approach — different angle
- Very short (2 sentences)
- Don't mention you tried before
- Try a "news/insight" approach — share something relevant to their segment
- End with one simple question

Return JSON: {"subject":"...","body":"...","reasoning":"..."}`;

    try {
      var outreach = await _callAI(prompt);

      // Add to queue as pending_approval (re-engagement = manual)
      var row = {
        lead_id:        lead.id,
        channel:        'email',
        subject:        outreach.subject || '',
        body:           outreach.body    || '',
        reasoning:      '[Re-engagement] ' + (outreach.reasoning || ''),
        status:         'pending_approval',
        sequence_num:   0,  // re-engagement = not part of regular cadence
        auto_generated: true,
        cadence_id:     'reeng_' + lead.id + '_' + Date.now()
      };

      await window._sb.insert('outreach_queue', row);

      // Update lead to ghosted status
      await window._sb.update('leads', 'id=eq.' + lead.id, {
        status:     'ghosted',
        ghosted_at: null  // cleared — so it doesn't run again
      }).catch(function(){});

      if (typeof window._outreachLoad === 'function') setTimeout(window._outreachLoad, 500);
      if (typeof window._outreachUpdateBadge === 'function') window._outreachUpdateBadge();

      _log('Re-engagement created for lead ' + lead.id);
    } catch(e) {
      _log('Ghosted re-engagement error: ' + e.message);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // andyCadenceTick — runs every hour, checks what needs to be sent
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceTick = async function() {
    if (!window._sb || !window.currentUser) return;
    _log('Tick — checking scheduled emails...');

    var now = new Date().toISOString();

    try {
      // 1. Check emails that are due for generation and sending
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

      // 2. Check leads that need re-engagement (ghosted_at passed)
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
  // INIT — starts the ticker
  // ══════════════════════════════════════════════════════════════
  window.andyCadenceInit = function() {
    // Run immediately + every hour
    setTimeout(window.andyCadenceTick, 5000);
    setInterval(window.andyCadenceTick, TICK_INTERVAL);
    _log('Cadence engine initialized — tick every 1h');
  };

  // Auto-init after auth is ready
  var _initInterval = setInterval(function() {
    if (window.currentUser && window._sb && window.SERVER) {
      clearInterval(_initInterval);
      window.andyCadenceInit();
    }
  }, 2000);

})();
