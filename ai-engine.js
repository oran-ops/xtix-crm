// ================================================================
//  XTIX AI ENGINE v2.0
//  Triple Engine: Claude + GPT + Gemini + Meta-Judge
//  Deep Pipeline: Multi-phase lead analysis
// ================================================================
// Dependencies (from index.html):
//   window.SERVER, window._authFetch, window.db (Firestore)
//   window.competitorData, window.ensureMethodologyInFirebase
//   window.renderSimpleLead, window._pbUpdate, window._aq
// ================================================================

(function() {
'use strict';

  // ════════════════════════════════════════════════════════════════
  //  TRIPLE ENGINE — Parallel Claude + GPT + Gemini + Meta-Judge
  //  שלב 2: מנועים מקבילים + שיפוט סופי + שמירת זיכרון
  // ════════════════════════════════════════════════════════════════

  // ── Call GPT-4o directly ────────────────────────────────────────
  async function _callGPT(systemPrompt, userPrompt, maxTokens) {
    // Route through Railway proxy — stable latency, key stays server-side
    var res = await window._authFetch(SERVER + '/gpt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens || 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt }
        ]
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
      var err = await res.json().catch(function(){return {};});
      throw new Error('GPT: ' + ((err.error && err.error.message) || 'HTTP ' + res.status));
    }
    var d = await res.json();
    var raw = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
    var si = raw.indexOf('{'), ei = raw.lastIndexOf('}');
    if (si !== -1 && ei !== -1) raw = raw.substring(si, ei+1);
    // Fix common GPT JSON issues: single quotes, unquoted keys
    try {
      return JSON.parse(raw);
    } catch(e1) {
      try {
        // Try fixing single quotes → double quotes
        var fixed = raw
          .replace(/'/g, '"')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']')
          .replace(/([{,]\s*)([a-zA-Z_\u0590-\u05FF][a-zA-Z0-9_\u0590-\u05FF]*)\s*:/g, '$1"$2":');
        return JSON.parse(fixed);
      } catch(e2) {
        console.warn('[GPT] JSON parse failed, returning raw text as summary');
        return { score: 60, tier: 'B', executive_summary: raw.substring(0, 500), summary: raw.substring(0, 200), status: 'done' };
      }
    }
  }

  // ── Call Gemini — smart fallback chain across models ─────────────
  // Order: gemini-2.0-flash → gemini-1.5-flash → gemini-1.5-flash-8b
  // On quota/rate error → tries next model automatically
  async function _callGemini(systemPrompt, userPrompt, maxTokens) {
    // Route through Railway proxy — key stays server-side
    // Free tier model fallback chain (best quota → least quota)
    var MODELS = [
      'gemini-2.0-flash',           // 15 RPM, 1500 RPD free
      'gemini-2.0-flash-lite',      // 30 RPM, 1500 RPD free — higher RPM budget
      'gemini-1.5-flash-latest',    // 'latest' alias avoids version 404s
      'gemini-1.5-flash-8b-latest'  // lightest model, last resort
    ];
    var lastError = null;
    var quotaCount = 0;  // track how many quota errors we've seen

    for (var mi = 0; mi < MODELS.length; mi++) {
      var model = MODELS[mi];
      try {
        var res = await window._authFetch(SERVER + '/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: maxTokens || 1500, temperature: 0.7 }
          }),
          signal: AbortSignal.timeout(35000)
        });

        if (res.status === 429) {
          var errBody = await res.json().catch(function(){return {};});
          var errMsg = (errBody.error && errBody.error.message) || 'quota exceeded';
          quotaCount++;
          console.warn('[Gemini] ' + model + ' → 429: ' + errMsg.substring(0, 80));
          lastError = new Error('Gemini/' + model + ': 429');
          continue;
        }

        if (res.status === 404) {
          console.warn('[Gemini] ' + model + ' → 404 not found — trying next model');
          lastError = new Error('Gemini/' + model + ': model not found');
          continue;
        }

        if (res.status === 503 || res.status === 403) {
          console.warn('[Gemini] ' + model + ' → ' + res.status + ' — trying next model');
          lastError = new Error('Gemini/' + model + ': HTTP ' + res.status);
          continue;
        }

        if (!res.ok) {
          throw new Error('Gemini/' + model + ': HTTP ' + res.status);
        }

        var d = await res.json();
        var raw = (d.candidates && d.candidates[0] &&
                   d.candidates[0].content && d.candidates[0].content.parts &&
                   d.candidates[0].content.parts[0] && d.candidates[0].content.parts[0].text) || '';
        if (!raw) {
          // Blocked or empty response
          lastError = new Error('Gemini/' + model + ': empty response');
          continue;
        }
        raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
        var si = raw.indexOf('{'), ei = raw.lastIndexOf('}');
        if (si !== -1 && ei !== -1) raw = raw.substring(si, ei+1);
        var parsed = JSON.parse(raw);
        parsed._geminiModel = model;
        return parsed;

      } catch(e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          console.warn('[Gemini] ' + model + ' → timeout — trying next');
          lastError = e;
          continue;
        }
        lastError = e;
        if (mi === MODELS.length - 1) throw lastError;
      }
    }

    // All models failed
    if (quotaCount === MODELS.length) {
      throw new Error('Gemini: קוטה יומית הוצתה — Gemini לא יהיה זמין עד מחר (חינמי tier)');
    }
    throw lastError || new Error('Gemini: all models failed');
  }

  // ── Build analysis prompt for a lead ───────────────────────────
  function _buildAnalysisPrompt(lead, METH, compInfo, proxyCtx) {
    var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;

    var XTIX_CONTEXT = [
      '=== XTIX — מידע עסקי מדויק ===',
      '',
      'מה זה XTIX:',
      'פלטפורמת כרטוס All-in-One ישראלית עם AI. מיועדת למפיקי אירועים — פסטיבלים, קונצרטים, תיאטרון, ספורט, סטנד-אפ, חוגים ועוד.',
      '',
      'יתרונות מרכזיים (אמיתיים):',
      '• Widget מוטמע באתר המפיק — הקהל לא עוזב את האתר, הכרטיסים נמכרים ישירות',
      '• 100% הנתונים שייכים למפיק — database קהל בבעלות מלאה',
      '• תשלום מיידי אחרי האירוע — לא מחכים שבועות',
      '• ניהול קהל + WhatsApp blast (בקרוב)',
      '• AI Co-pilot — תמחור דינמי, Early Bird אוטומטי, ניתוח מכירות',
      '• כרטיסים בחינם ללא עלות (רלוונטי לחוגים, שיעורים, קהילות)',
      '• ממשק פשוט ומודרני',
      '• Role-based access, Scanner App, APIs',
      '',
      'עמלות XTIX (מדויק):',
      '• 5-10% תלוי בהיקף פעילות הלקוח',
      '• נקבע אישית בשיחה/פגישה לפי נפח, תדירות וצרכים',
      '• אין דמי הקמה, אין דמי חודשיים, אין עמלות נסתרות',
      '• כרטיסים חינם = ללא עמלה כלל',
      '',
      'עסקאות שנסגרו — דוגמאות אמיתיות:',
      '1. שומרי המלכה — להקת טריביוט. כאב: עבדו עם SmarTicket, מפנה לאתר חיצוני, קהל לא שלהם. נסגר.',
      '2. לטינו פוינט — שיעורי ריקוד לטיני + מסיבות עונתיות, כרטיסים 80-100 שח. כאב: מכירה ידנית. נסגר ב-6%. בונוס: כרטיסים חינם לשיעורים לבניית database קהילה.',
      '',
      'מתחרים:',
      (compInfo || '• SmarTicket, Leaan, Eventbrite — כולם גובים 5-8%, קהל לא שייך למפיק')
    ].join('\n');

    var PAIN_DICTIONARY = [
      '=== מילון כאבים — XTIX ===',
      'להלן רשימת הכאבים שיש לזהות בליד. אם אתה רואה סימן לכאב — הוסף אותו ל-pain_points עם הסבר ספציפי.',
      '',
      '1. אי-הטמעה של Widget/iFrame באתר',
      '   סימן: לחיצה על "קנה כרטיס" מפנה לדומיין חיצוני (smarticket.co.il / leaan.co.il / eventbrite.com וכו\')',
      '   כאב: הקהל עוזב את האתר, המפיק מאבד שליטה על חווית הקנייה',
      '',
      '2. הפניה לאתר חיצוני למכירת כרטיסים',
      '   סימן: כפתור רכישה מוביל לדומיין אחר לחלוטין',
      '   כאב: איבוד מידע על הקונים, קהל שייך לפלטפורמה ולא למפיק',
      '',
      '3. חוסר שליטה במידע / איבוד DATA',
      '   סימן: פלטפורמה חיצונית מנהלת את הקונים, אין למפיק גישה לרשימות',
      '   כאב: לא ניתן לשלוח תפוצה, לבנות קהילה, לעשות Early Bird לקהל קיים',
      '',
      '4. מכירות ידניות / ללא מערכת',
      '   סימן: "לרכישה שלחו הודעה בוואטסאפ / ביט / העברה בנקאית"',
      '   כאב: אין ניהול, אין סטטיסטיקות, מבזבז זמן, טעויות',
      '',
      '5. חוסר באמצעי תשלום מתקדמים',
      '   סימן: אין Google Pay / Apple Pay / תשלום מובייל חלק',
      '   כאב: נטישת עגלה גבוהה, פחות המרות במובייל',
      '',
      '6. ממשק ויזואלי ישן / לא מודרני',
      '   סימן: עיצוב מיושן, UX מסורבל, חווית קנייה לא חלקה',
      '   כאב: פגיעה בתדמית המפיק, פחות המרות',
      '',
      '7. חוסר בפיצ\'רים מתקדמים',
      '   סימן: אין תבניות מותאמות, אין עמוד אירועים מאוחד, אין Early Bird אוטומטי',
      '   כאב: עבודה ידנית מיותרת, פספוס הכנסות',
      '',
      '8. משיכת כספים מאוחרת',
      '   סימן: פלטפורמה מעבירה כסף שבועות אחרי האירוע',
      '   כאב: בעיות תזרים מזומנים, צורך לממן הוצאות מראש',
      '',
      '9. חוסר שקיפות בעמלות',
      '   סימן: עמלות נסתרות, דמי שירות שמתגלים רק בקופה',
      '   כאב: אמון נמוך, הפתעות לא נעימות',
      '',
      '10. אירועים מורכבים ללא ניהול סוגי כרטיסים',
      '    סימן: אין תמיכה ב-VIP / Early Bird / מחיר לפי איזור',
      '    כאב: פספוס הכנסות ממגוון מחירים',
      '',
      '11. אין Apple Wallet / Google Wallet',
      '    סימן: כרטיס נשלח רק כ-PDF או מייל',
      '    כאב: חווית כניסה לא חלקה, תלונות בכניסה',
      '',
      '12. תהליך רכישה ארוך / מחייב הרשמה',
      '    סימן: חובה ליצור חשבון לפני קנייה',
      '    כאב: נטישה גבוהה, פחות המרות',
      '',
      '13. חוסר בכלי שיווק',
      '    סימן: אין UTM links, אין pixel integration, אין דוחות ערוצי מכירה',
      '    כאב: לא יודעים מאיפה מגיע הקהל, לא ניתן לאופטימייז',
      '',
      '14. אין תקשורת ישירה עם הקהל',
      '    סימן: אין WhatsApp blast, אין SMS לכרטיסנים, אין ניוזלטר אוטומטי',
      '    כאב: קהל לא חוזר, פספוס מכירות לאירוע הבא',
      '',
      '15. ניהול צוות ללא הרשאות',
      '    סימן: כולם נכנסים עם אותו משתמש, אין role-based access',
      '    כאב: סיכוני אבטחה, אין אחריות ברורה לכל תפקיד',
    ].join('\n');

    var SCORING_GUIDE = [
      '=== מדריך ציון 0-100 (חובה לפי הכללים הבאים) ===',
      '',
      'כללי ציון:',
      '• +30 נקודות בסיס: אם הליד כבר מוכר כרטיסים (יש פלטפורמה כלשהי)',
      '• +25 נקודות: הפניה לאתר חיצוני לרכישת כרטיסים (iframe/redirect = קהל לא שייך למפיק)',
      '• +15 נקודות: מכירה ידנית (ביט/העברה/טלפון)',
      '• +10 נקודות: פעילות קבועה וחוזרת (3+ אירועים בשנה)',
      '• +10 נקודות: גודל משמעותי (100+ כרטיסים לאירוע)',
      '• +5 נקודות: מחיר כרטיס 50+ שח',
      '• -20 נקודות: לא מוכר כרטיסים כלל',
      '• -10 נקודות: פעילות חד-פעמית או לא ברורה',
      '',
      'חשוב מאוד — הפניה לאתר חיצוני:',
      'אם האתר מפנה לפלטפורמה חיצונית (SmartTicket/Leaan/Eventbrite/כל domain אחר) לרכישת כרטיסים — זה כאב מרכזי שמוסיף +25 לציון ו-חייב להופיע ב-pain_points.',
      '',
      'חוקי חובה:',
      '• pain_points חייב להכיל לפחות 2 כאבים ספציפיים — לא יכול להיות ריק',
      '• platform_current = הפלטפורמה שהליד עובד איתה עכשיו (SmartTicket / Leaan / ידני / לא ידוע)',
      '• competitors_used = רשימת מתחרי XTIX הקיימים בשוק (SmartTicket, Leaan, Eventbrite וכו\')',
      '• אלה שני שדות שונים — platform_current זה מה שהליד משתמש בו, competitors_used זה מי קיים בשוק',
      '• אם ראית SmartTicket ב-URL של הליד — platform_current = "SmartTicket", וגם competitors_used = ["SmartTicket"]',
      '• אל תכתוב "לא ידוע" ב-platform_current אם ראית ראיה לפלטפורמה כלשהי',
      '',
      'טווחי ציון:',
      'A (70-100): מוכר כרטיסים + כאב ברור + פעילות קבועה',
      'B (40-69): פוטנציאל אבל חסר מידע או פעילות קטנה',
      'C (0-39): לא מוכר כרטיסים / לא רלוונטי'
    ].join('\n');

    return {
      system: [
        'אתה מנהל מכירות בכיר ב-XTIX. תפקידך לנתח לידים ולתת ציון מדויק.',
        'החזר JSON נקי בלבד — ללא markdown, ללא backticks.',
        '',
        XTIX_CONTEXT,
        '',
        SCORING_GUIDE,
        '',
        'מילון כאבים לזיהוי:',
        PAIN_DICTIONARY,
        '',
        'מתודולוגיית מכירות:',
        (METH||'')
      ].join('\n'),

      user: [
        'נתח את הליד הבא. היה ספציפי — לא כללי.',
        'שם: ' + (lead.name||''),
        'דומיין: ' + domain,
        'פלטפורמה נוכחית: ' + (lead.platform||'לא ידוע'),
        (proxyCtx ? proxyCtx : ''),
        'סגמנט: ' + (lead.segment||lead.type||''),
        'טלפון: ' + (lead.phone||''),
        'מייל: ' + (lead.email||''),
        'כתובת: ' + (lead.address||''),
        '',
        'החזר JSON: {score, tier (A=70+/B=40-69/C=0-39), summary, executive_summary, segment, platform_current, platform_weakness, pain_points[], sales_attack, meeting_prep, pricing_intel, estimated_annual_fees, estimated_xtix_savings, next_action, recommended_cadence (hot/warm/cool), pitch, discovery_questions[], score_confidence, reasoning}'
      ].join('\n')
    };
  }


  // ── Consensus Engine — works with any combination of available scores ──
  function _calcConsensus(claudeScore, gptScore, geminiScore) {
    // Build list of available scores with weights
    var pairs = [
      { score: claudeScore,  weight: 0.5 },
      { score: gptScore,     weight: 0.3 },
      { score: geminiScore,  weight: 0.2 }
    ].filter(function(p) { return p.score !== null && p.score !== undefined; });

    if (!pairs.length) return { weightedScore: 50, spread: 0, confidence: 'low', hadConflict: false };

    // Re-normalize weights across available engines only
    var wTotal = pairs.reduce(function(a, p) { return a + p.weight; }, 0);
    pairs.forEach(function(p) { p.weight = p.weight / wTotal; });

    var weighted = Math.round(pairs.reduce(function(sum, p) { return sum + p.score * p.weight; }, 0));
    var scores   = pairs.map(function(p) { return p.score; });
    var spread   = scores.length > 1 ? Math.max.apply(null, scores) - Math.min.apply(null, scores) : 0;

    var confidence  = spread <= 10 ? 'high' : spread <= 25 ? 'mid' : 'low';
    var hadConflict = spread > (window._brainConfig && window._brainConfig.conflictThreshold || 20);

    return { weightedScore: weighted, spread: spread, confidence: confidence, hadConflict: hadConflict };
  }

  // ── Meta-Judge — Claude judges all results + knows which engines failed ──
  async function _metaJudge(lead, baseResult, gptResult, geminiResult, history, engineContext) {
    var ctx = engineContext || {};
    var t0 = Date.now();

    var historyStr = '';
    if (history && history.length) {
      historyStr = '\n\nהיסטוריית החלטות קודמות בסגמנט זה:\n' +
        history.slice(0,5).map(function(h) {
          return '• ' + (h.lead_name||'') + ': ציון ' + (h.meta_score||'?') +
                 ' → ' + (h.outcome==='closed'?'✅ נסגר':h.outcome==='lost'?'❌ אבד':'⏳ פתוח') +
                 (h.was_correct===false ? ' [Meta-Judge טעה — למד מזה]' : '');
        }).join('\n');
    }

    var availableCount = ctx.successCount || 1;
    var totalCount     = ctx.configuredCount || 1;
    var partialNote    = availableCount < totalCount
      ? '\n⚠️ שים לב: ' + (totalCount - availableCount) + ' מנוע(ים) נכשלו (' +
        [ctx.claudeStatus !== 'ok' ? 'Claude:'+ctx.claudeStatus : '',
         ctx.gptStatus    !== 'ok' && ctx.gptStatus !== 'skipped' ? 'GPT:'+ctx.gptStatus : '',
         ctx.geminiStatus !== 'ok' && ctx.geminiStatus !== 'skipped' ? 'Gemini:'+ctx.geminiStatus : '']
        .filter(Boolean).join(', ') +
        '). בסס את ההחלטה על המנועים הזמינים בלבד.'
      : '';

    var system = 'אתה Meta-Judge של מערכת XTIX CRM. קיבלת ניתוחים מ-' + totalCount + ' מנועי AI על אותו ליד.' +
                 ' תפקידך: לשפוט ולהחליט את הציון והמלצת הפעולה הסופית.' +
                 ' אתה לא ממצע — אתה מחליט. אם יש מחלוקת, נמק למה אתה בוחר צד.' +
                 ' אם חלק מהמנועים נכשלו, בסס את ההחלטה על הזמינים.' +
                 ' החזר JSON נקי בלבד.';

    var user = 'ליד: ' + (lead.name||'') + ' | פלטפורמה: ' + (lead.platform||'') +
               ' | סגמנט: ' + (lead.segment||lead.type||'') +
               '\n\nתוצאות המנועים:' + (ctx.engineSummary || '') +
               partialNote + historyStr +
               '\n\nמדריך ציון Meta-Judge:' +
               '\n• +30: מוכר כרטיסים כבר' +
               '\n• +25: הפניה לאתר חיצוני (קהל לא שייך למפיק)' +
               '\n• +15: מכירה ידנית' +
               '\n• +10: פעילות קבועה 3+ אירועים/שנה' +
               '\n• +10: 100+ כרטיסים לאירוע' +
               '\n• -20: לא מוכר כרטיסים כלל' +
               '\n\nהחלט:' +
               '\n1. מה הציון הסופי (0-100)? חשב לפי המדריך — פרט כמה נקודות על כל פרמטר.' +
               '\n2. מה המלצת הפעולה הספציפית?' +
               '\n3. על מה המנועים חלקו ולמה אתה בוחר צד?' +
               '\n4. מה רמת הביטחון שלך ולמה?' +
               '\n\nהחזר JSON: { "meta_score": N, "meta_reasoning": "נימוק מפורט", "meta_action": "פעולה ספציפית", ' +
               '"score_breakdown": {"sells_tickets": N, "external_platform": N, "manual_sales": N, "recurring_events": N, "event_size": N}, ' +
               '"disagreements": ["מנוע X נתן Y כי..."], "confidence": "high/mid/low", ' +
               '"final_summary": "סיכום מה מצאנו ולמה הציון הזה", "final_tier": "A/B/C" }';

    try {
      // Use AbortController so we can truly cancel the fetch inside _callAI
      var judgeAbort  = new AbortController();
      var judgeTimer  = setTimeout(function() {
        judgeAbort.abort();
        console.warn('[Brain] Meta-Judge hard-cancelled after 50s');
      }, 50000);

      var verdict = await _callAI(system, user, 1000, 45000, judgeAbort.signal);
      clearTimeout(judgeTimer);

      if (!verdict) throw new Error('Meta-Judge empty response');
      verdict._judgeMs = Date.now() - t0;
      return verdict;
    } catch(e) {
      console.warn('[Brain] Meta-Judge failed:', e.message);
      return {
        meta_score:     baseResult.score || 50,
        meta_reasoning: 'Meta-Judge לא זמין — משתמש בתוצאה הטובה ביותר הזמינה',
        meta_action:    baseResult.next_action || '',
        disagreements:  [],
        confidence:     'low',
        final_summary:  baseResult.summary || '',
        final_tier:     baseResult.tier || 'B',
        _judgeMs:       Date.now() - t0
      };
    }
  }

  // ── Claude Quick Analysis — single-call version for Triple Engine ──
  // Full _deepAIPipeline takes 4 serial calls (~100s). For Triple Engine we
  // only need Phase 1 data + score in one call (~20s), so all 3 engines finish
  // at roughly the same time and Meta-Judge isn't blocked waiting for emails.
  async function _claudeQuickAnalysis(lead, METH, compInfo) {
    var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;

    // Fetch proxy context (non-blocking, best-effort)
    var pCtx = 'לא נמצא מידע מהאתר';
    try {
      var pr = await window._authFetch(SERVER+'/analyze?url='+encodeURIComponent('https://'+domain),
        { signal: AbortSignal.timeout(7000) });
      if (pr.ok) {
        var px = await pr.json();
        pCtx = 'פלטפורמה='+(px.ticketPlatform||'?')+', מייל='+(px.email||'?')+', טלפון='+(px.phone||'?');
      }
    } catch(e) {}

    var result = await _callAI(
      [
        'אתה מנהל מכירות בכיר ב-XTIX.AI וחוקר B2B. נתח את הליד ותן ניתוח מכירות מלא. החזר JSON נקי בלבד. ענה בעברית.',
        '',
        'כלל קריטי — זיהוי פלטפורמה חיצונית:',
        'אם מידע מהאתר מראה פלטפורמה חיצונית (smarticket/leaan/eventbrite/קישור לdomain אחר לרכישת כרטיסים) — זה כאב מרכזי.',
        'במקרה כזה: platform_current = שם הפלטפורמה, pain_points חייב לכלול "הפניה לאתר חיצוני — קהל לא שייך למפיק", ציון +25.',
        '',
        'מילון כאבים: זהה כאבים מהרשימה הבאה לפי מה שאתה רואה באתר/ברשתות:',
        'Widget חיצוני, מכירה ידנית, איבוד DATA, ממשק ישן, אין Apple Pay, משיכה מאוחרת, אין WhatsApp blast, אין role-based access, תהליך רכישה ארוך, אין Apple Wallet.',
        'חוק pain_points: אם זיהית כאב מהרשימה — הוסף אותו. אם לא זיהית כלום — pain_points יכול להיות ריק.',
        'חוק platform_current: חייב להתאים למה שזיהית — אל תכתוב "לא ידוע" אם ראית פלטפורמה.'
      ].join('\n'),
      `נתח את הליד לצורך מכירת XTIX.AI:
שם: ${lead.name} | דומיין: ${domain}
סוג: ${lead.type||'?'} | פלטפורמה: ${lead.platform||'?'}
טלפון: ${lead.phone||'?'} | מייל: ${lead.email||'?'} | כתובת: ${lead.address||'?'}
מידע מאתר: ${pCtx}
מתחרים בשוק: ${compInfo||''}
מתודולוגיה: ${(METH||'').substring(0,400)}

החזר JSON עם כל השדות הבאים:
{
  "score": 75,
  "tier": "A",
  "summary": "2-3 משפטים על הליד",
  "executive_summary": "למה הליד מעניין XTIX עכשיו",
  "segment": "קטגוריה",
  "platform_current": "שם פלטפורמה",
  "platform_weakness": "החולשה של הפלטפורמה",
  "competitors_used": ["מתחרה1"],
  "target_audience": "תיאור קהל",
  "events_per_year": "כמות",
  "venue_size": "גודל",
  "ticket_price_range": "טווח מחיר",
  "estimated_annual_fees": "עמלות בשקלים",
  "estimated_xtix_savings": "חיסכון בשקלים",
  "pain_points": ["כאב1","כאב2","כאב3"],
  "social_intel": "תיאור רשתות",
  "pricing_intel": "מידע תמחור",
  "sales_attack": "אסטרטגיית תקיפה",
  "pitch": "פיץ מכירה קצר",
  "meeting_prep": "הכנה לשיחה",
  "discovery_questions": ["שאלה1","שאלה2","שאלה3"],
  "next_action": "הצעד הבא הספציפי",
  "recommended_cadence": "warm",
  "score_confidence": 0.85,
  "reasoning": "נימוק הציון"
}`,
      2000, 80000
    );

    result.status      = 'done';
    result.enriched_at = new Date().toISOString();
    return result;
  }

  // ── Triple Engine Pipeline wrapper ─────────────────────────────
  // Wraps _claudeQuickAnalysis (fast) — calls all 3 engines in parallel then Meta-Judge
  window._tripleEnginePipeline = async function(lead) {
    var METH = await ensureMethodologyInFirebase();
    var compInfo = '';
    try { compInfo = Object.values(competitorData||{}).map(function(c){return c.name+': '+c.weakness;}).join('\n'); } catch(e){}

    // ── Fetch proxy data to share across ALL engines ────────────────
    var sharedProxyCtx = '';
    try {
      var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0];
      var proxyRes = await window._authFetch(SERVER+'/analyze?url='+encodeURIComponent('https://'+domain),
        { signal: AbortSignal.timeout(7000) });
      if (proxyRes.ok) {
        var proxyData = await proxyRes.json();
        sharedProxyCtx = [
          'מידע שנמצא באתר:',
          '• פלטפורמת כרטיסים שזוהתה: ' + (proxyData.ticketPlatform || 'לא זוהתה'),
          '• מייל: ' + (proxyData.email || 'לא נמצא'),
          '• טלפון: ' + (proxyData.phone || 'לא נמצא'),
          proxyData.externalTicketUrl ? '• קישור כרטיסים חיצוני: ' + proxyData.externalTicketUrl : '',
          proxyData.socialLinks && proxyData.socialLinks.length ? '• רשתות חברתיות: ' + proxyData.socialLinks.join(', ') : ''
        ].filter(Boolean).join('\n');
      }
    } catch(e) { console.warn('[Triple] Proxy fetch failed:', e.message); }

    var prompt = _buildAnalysisPrompt(lead, METH, compInfo, sharedProxyCtx);
    var activeEngines = 1 + (_brainKeys&&_brainKeys.gpt?1:0) + (_brainKeys&&_brainKeys.gemini?1:0);

    // Progress update helper — updates both lead bar AND global bottom bar
    function setP(pct, msg) {
      var bar = document.getElementById('analysis-bar-'+lead.id);
      var txt = document.getElementById('analysis-progress-'+lead.id);
      if(bar) bar.style.width = pct + '%';
      if(txt) txt.textContent = msg;
      // Also update global progress bar
      var gPct = Math.round(((_aq&&_aq.done||0)/(_aq&&_aq.total||1))*100);
      if (typeof _pbUpdate === 'function')
        _pbUpdate(Math.round(gPct*0.7 + pct*0.3), msg.substring(0,40), lead);
    }

    setP(5, activeEngines === 3 ? '🚀 Triple Engine — Claude + GPT + Gemini רצים במקביל...' :
                activeEngines === 2 ? '🚀 Dual Engine — Claude + ' + (_brainKeys.gpt ? 'GPT-4o' : 'Gemini') + ' רצים במקביל...' :
                '🧠 Claude מנתח...');

    // ── Live Debug Panel ──────────────────────────────────────
    function showDebugPanel() {
      var existing = document.getElementById('_triple_debug_panel');
      if (existing) existing.remove();
      var panel = document.createElement('div');
      panel.id = '_triple_debug_panel';
      panel.style.cssText = 'position:fixed;bottom:60px;left:20px;z-index:9998;background:#0d0d14;border:1px solid rgba(124,58,237,0.4);border-radius:14px;padding:16px 20px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-family:Heebo,sans-serif;direction:rtl';
      panel.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<div style="font-size:13px;font-weight:800;color:#a78bfa">🔬 Triple Engine — Live Debug</div>' +
          '<button onclick="document.getElementById(\'_triple_debug_panel\').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;padding:2px 8px;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px">✕</button>' +
        '</div>' +
        '<div id="_dbg_claude" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:18px">🟣</span>' +
          '<div style="flex:1">' +
            '<div style="font-size:11px;font-weight:700;color:#a78bfa">Claude (Anthropic)</div>' +
            '<div id="_dbg_claude_status" style="font-size:11px;color:rgba(255,255,255,0.4)">⏳ ממתין...</div>' +
          '</div>' +
          '<div id="_dbg_claude_score" style="font-size:16px;font-weight:800;color:#a78bfa;min-width:32px;text-align:center">—</div>' +
        '</div>' +
        '<div id="_dbg_gpt_row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:18px">🟢</span>' +
          '<div style="flex:1">' +
            '<div style="font-size:11px;font-weight:700;color:#10b981">GPT-4o (OpenAI)</div>' +
            '<div id="_dbg_gpt_status" style="font-size:11px;color:rgba(255,255,255,0.4)">' + (_brainKeys && _brainKeys.gpt ? '⏳ ממתין...' : '○ לא מוגדר — דלג') + '</div>' +
          '</div>' +
          '<div id="_dbg_gpt_score" style="font-size:16px;font-weight:800;color:#10b981;min-width:32px;text-align:center">—</div>' +
        '</div>' +
        '<div id="_dbg_gemini_row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;margin-bottom:6px">' +
          '<span style="font-size:18px">🔵</span>' +
          '<div style="flex:1">' +
            '<div style="font-size:11px;font-weight:700;color:#3b82f6">Gemini (Google)</div>' +
            '<div id="_dbg_gemini_status" style="font-size:11px;color:rgba(255,255,255,0.4)">' + (_brainKeys && _brainKeys.gemini ? '⏳ ממתין...' : '○ לא מוגדר — דלג') + '</div>' +
          '</div>' +
          '<div id="_dbg_gemini_score" style="font-size:16px;font-weight:800;color:#3b82f6;min-width:32px;text-align:center">—</div>' +
        '</div>' +
        '<div id="_dbg_judge_row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:8px;margin-bottom:12px">' +
          '<span style="font-size:18px">⚖️</span>' +
          '<div style="flex:1">' +
            '<div style="font-size:11px;font-weight:700;color:#F59E0B">Meta-Judge (Claude)</div>' +
            '<div id="_dbg_judge_status" style="font-size:11px;color:rgba(255,255,255,0.4)">⏳ מחכה לתוצאות...</div>' +
          '</div>' +
          '<div id="_dbg_judge_score" style="font-size:20px;font-weight:800;color:#F59E0B;min-width:32px;text-align:center">—</div>' +
        '</div>' +
        '<div id="_dbg_timing" style="font-size:10px;color:rgba(255,255,255,0.25);text-align:center">⏱ זמן ריצה: <span id="_dbg_elapsed">0</span>s</div>';
      document.body.appendChild(panel);

      // Elapsed timer
      var _dbgStart = Date.now();
      var _dbgTimer = setInterval(function() {
        var el = document.getElementById('_dbg_elapsed');
        if (el) el.textContent = ((Date.now() - _dbgStart)/1000).toFixed(1);
        else clearInterval(_dbgTimer);
      }, 200);
      panel._dbgTimer = _dbgTimer;
    }

    function dbgUpdate(engine, status, score, isError) {
      var statusEl = document.getElementById('_dbg_' + engine + '_status');
      var scoreEl  = document.getElementById('_dbg_' + engine + '_score');
      if (statusEl) {
        statusEl.textContent = status;
        statusEl.style.color = isError ? '#ef4444' : score ? '#10b981' : 'rgba(255,255,255,0.6)';
      }
      if (scoreEl && score !== null && score !== undefined) {
        scoreEl.textContent = score;
        scoreEl.style.color = score >= 80 ? '#10b981' : score >= 60 ? '#F59E0B' : '#3b82f6';
      }
    }

    // ════════════════════════════════════════════════════════════════
    //  RESILIENT ENGINE RUNNER
    //  כל מנוע רץ בנפרד עם tracking מלא — timeout, error, duration
    //  אם 1 או 2 נכשלו → ממשיכים. רק אם כולם נכשלו → throw.
    // ════════════════════════════════════════════════════════════════

    // ── Engine result envelope ──────────────────────────────────────
    // { id, result, status: 'ok'|'error'|'timeout'|'skipped', error, durationMs }
    // Recursively replace undefined→null before any Firebase write (global scope)
  window._cleanForFirebase = function _cleanForFirebase(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(window._cleanForFirebase);
    var out = {};
    Object.keys(obj).forEach(function(k) { out[k] = window._cleanForFirebase(obj[k]); });
    return out;
  };

  function _engineEnvelope(id, result, status, error, startMs) {
      return {
        id:         id,
        result:     result  || null,
        status:     status,
        error:      error   || null,
        durationMs: Date.now() - startMs
      };
    }

    // ── Hard timeout wrapper ─────────────────────────────────────────
    function _withTimeout(promise, ms, label) {
      var timerId;
      var timeout = new Promise(function(resolve) {
        timerId = setTimeout(function() {
          console.warn('[Brain] ' + label + ' hard timeout after ' + (ms/1000) + 's');
          resolve('__TIMEOUT__');
        }, ms);
      });
      return Promise.race([promise, timeout]).then(function(result) {
        clearTimeout(timerId);
        return result;
      });
    }

    // ── Run a single engine safely — always resolves, never rejects ──
    async function _runEngine(id, promiseFn, timeoutMs) {
      var t0 = Date.now();
      dbgUpdate(id === 'judge' ? 'judge' : id, '🔄 רץ...', null, false);
      try {
        var raw = await _withTimeout(promiseFn(), timeoutMs, id);
        if (raw === '__TIMEOUT__') {
          dbgUpdate(id, '⏱ Timeout (' + (timeoutMs/1000) + 's)', null, true);
          return _engineEnvelope(id, null, 'timeout', 'timeout after ' + timeoutMs + 'ms', t0);
        }
        if (!raw) {
          dbgUpdate(id, '⚠️ תגובה ריקה', null, true);
          return _engineEnvelope(id, null, 'error', 'empty response', t0);
        }
        var score = raw.score || null;
        var modelNote = (id === 'gemini' && raw._geminiModel && raw._geminiModel !== 'gemini-2.0-flash')
          ? ' (' + raw._geminiModel + ')' : '';
        dbgUpdate(id, '✅ ' + ((Date.now()-t0)/1000).toFixed(1) + 's' + modelNote + (score ? ' — ציון: ' + score : ''), score, false);
        return _engineEnvelope(id, raw, 'ok', null, t0);
      } catch(e) {
        var isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError' || (e.message||'').includes('timeout');
        var status = isTimeout ? 'timeout' : 'error';
        dbgUpdate(id, (isTimeout ? '⏱ Timeout' : '❌ שגיאה') + ': ' + (e.message||'').substring(0,40), null, true);
        return _engineEnvelope(id, null, status, e.message, t0);
      }
    }

    // ── Debug: update panel header with live engine count ───────────
    function _dbgSetHeader(okCount, totalCount) {
      var el = document.querySelector('#_triple_debug_panel div[style*="font-size:13px"]');
      if (el) el.textContent = '🔬 Triple Engine — ' + okCount + '/' + totalCount + ' מנועים פעילים';
    }

    showDebugPanel();

    // ── Mark skipped engines immediately ────────────────────────────
    if (!(_brainKeys && _brainKeys.gpt))    dbgUpdate('gpt',    '○ לא מוגדר', null, false);
    if (!(_brainKeys && _brainKeys.gemini)) dbgUpdate('gemini', '○ לא מוגדר', null, false);

    // ── Run all 3 engines in parallel ───────────────────────────────
    var enginePromises = [
      _runEngine('claude', function() { return _claudeQuickAnalysis(lead, METH, compInfo); }, 90000)
    ];
    if (_brainKeys && _brainKeys.gpt) {
      enginePromises.push(_runEngine('gpt', function() {
        return _callGPT(prompt.system, prompt.user, 1500);
      }, 50000));
    } else {
      enginePromises.push(Promise.resolve(_engineEnvelope('gpt', null, 'skipped', 'key not configured', Date.now())));
    }
    if (_brainKeys && _brainKeys.gemini) {
      enginePromises.push(_runEngine('gemini', function() {
        return _callGemini(prompt.system, prompt.user, 1500);
      }, 20000));
    } else {
      enginePromises.push(Promise.resolve(_engineEnvelope('gemini', null, 'skipped', 'key not configured', Date.now())));
    }

    var engineResults = await Promise.all(enginePromises);
    var claudeEnv  = engineResults[0];
    var gptEnv     = engineResults[1];
    var geminiEnv  = engineResults[2];

    var claudeResult  = claudeEnv.result;
    var gptResult     = gptEnv.result;
    var geminiResult  = geminiEnv.result;

    // ── Count successful engines ─────────────────────────────────────
    var successCount = [claudeEnv, gptEnv, geminiEnv].filter(function(e) { return e.status === 'ok'; }).length;
    var configuredCount = 1 + (_brainKeys&&_brainKeys.gpt?1:0) + (_brainKeys&&_brainKeys.gemini?1:0);
    _dbgSetHeader(successCount, configuredCount);

    // ── If ALL configured engines failed → fallback, never abort ───────
    var allFailed = [claudeEnv, gptEnv, geminiEnv]
      .filter(function(e) { return e.status !== 'skipped'; })
      .every(function(e)  { return e.status !== 'ok'; });

    if (allFailed) {
      dbgUpdate('judge', '⚠️ כל המנועים נכשלו — ממשיך עם fallback', null, true);
      var fallbackResult = {
        score: 50, tier: 'B',
        summary: 'ניתוח לא זמין — כל מנועי ה-AI נכשלו',
        executive_summary: 'נסה שנית מאוחר יותר',
        next_action: 'בדוק חיבור ל-AI',
        status: 'done', triple_engine: true,
        engines_ok: 0, engines_total: configuredCount,
        engine_statuses: { claude: claudeEnv.status, gpt: gptEnv.status, gemini: geminiEnv.status }
      };
      lead.ai_analysis = Object.assign({}, fallbackResult);
      if (typeof db !== 'undefined' && db)
        db.collection('leads').doc(String(lead.id))
          .set(window._cleanForFirebase(lead)).catch(function(){});
      renderSimpleLead(lead);
      setP(100, '⚠️ 0/' + configuredCount + ' מנועים — נסה שנית');
      return fallbackResult;
    }

    // ── Pick best available result as Claude baseline ─────────────────
    // Fallback chain: Claude → GPT → Gemini
    var baseResult = claudeResult || gptResult || geminiResult;

    setP(80, '⚖️ Meta-Judge — מנתח ' + successCount + '/' + configuredCount + ' תוצאות...');

    // ── Consensus (only from successful engines) ──────────────────────
    var consensus = _calcConsensus(
      claudeResult  ? (claudeResult.score  || 50) : null,
      gptResult     ? (gptResult.score     || 50) : null,
      geminiResult  ? (geminiResult.score  || 50) : null
    );

    // ── Load history for calibration ──────────────────────────────────
    var history = [];
    try { history = await window.getBrainHistory(lead.segment || lead.type, 8); } catch(e){}

    // ── Meta-Judge — gets full picture including failures ─────────────
    setP(88, '⚖️ Meta-Judge מחליט...');
    dbgUpdate('judge', '🔄 מנתח תוצאות...', null, false);

    var engineSummary =
      '\nClaude (' + claudeEnv.status + '): ' +
        (claudeResult ? 'ציון ' + (claudeResult.score||50) + ' | ' + (claudeResult.summary||'').substring(0,80) : claudeEnv.error || 'נכשל') +
      '\nGPT-4o (' + gptEnv.status + '): ' +
        (gptResult ? 'ציון ' + (gptResult.score||50) + ' | ' + (gptResult.summary||'').substring(0,80) : gptEnv.status === 'skipped' ? 'לא מוגדר' : gptEnv.error || 'נכשל') +
      '\nGemini (' + geminiEnv.status + '): ' +
        (geminiResult ? 'ציון ' + (geminiResult.score||50) + ' | ' + (geminiResult.summary||'').substring(0,80) : geminiEnv.status === 'skipped' ? 'לא מוגדר' : geminiEnv.error || 'נכשל');

    var verdict = await _metaJudge(lead, baseResult, gptResult, geminiResult, history, {
      engineSummary: engineSummary,
      successCount:  successCount,
      configuredCount: configuredCount,
      claudeStatus:  claudeEnv.status,
      gptStatus:     gptEnv.status,
      geminiStatus:  geminiEnv.status,
      consensus:     consensus
    });

    dbgUpdate('judge', '✅ ' + ((verdict._judgeMs||0)/1000).toFixed(1) + 's — ציון: ' + (verdict.meta_score||'?'), verdict.meta_score, false);

    // ── Merge final result — baseResult has all _deepAIPipeline fields ──
    var finalResult = Object.assign({}, baseResult, {
      // Core status — MUST be 'done' for triggerFullAnalysis to render correctly
      status:            'done',
      enriched_at:       new Date().toISOString(),
      triple_engine:     true,
      engines_ok:        successCount,
      engines_total:     configuredCount,
      engine_statuses:   { claude: claudeEnv.status, gpt: gptEnv.status, gemini: geminiEnv.status },
      // Meta-Judge overrides — score/tier/summary from verdict
      score:             verdict.meta_score     || baseResult.score  || 50,
      tier:              verdict.final_tier     || baseResult.tier   || 'B',
      summary:           verdict.final_summary  || baseResult.summary || '',
      executive_summary: verdict.meta_reasoning || baseResult.executive_summary || '',
      next_action:       verdict.meta_action    || baseResult.next_action || '',
      // Meta-Judge metadata
      meta_score:        verdict.meta_score        != null ? verdict.meta_score        : null,
      meta_reasoning:    verdict.meta_reasoning    != null ? verdict.meta_reasoning    : null,
      meta_action:       verdict.meta_action       != null ? verdict.meta_action       : null,
      disagreements:     verdict.disagreements  || [],
      confidence:        consensus.confidence,
      had_conflict:      consensus.hadConflict,
      // Per-engine scores for Brain Panel
      claude_score:      claudeResult  ? claudeResult.score  : null,
      gpt_score:         gptResult     ? gptResult.score     : null,
      gemini_score:      geminiResult  ? geminiResult.score  : null
    });

    setP(95, '💾 שומר החלטה ל-AI Brain Memory...');

    // ── Save to Brain Memory ──────────────────────────────────────────
    try {
      await window.saveBrainDecision({
        lead_id:          lead.id,
        lead_name:        lead.name,
        lead_segment:     lead.segment || lead.type || '',
        claude_score:     claudeResult  ? (claudeResult.score  || 50) : null,
        claude_summary:   claudeResult  ? (claudeResult.summary || '') : null,
        gpt_score:        gptResult     ? (gptResult.score     || 50) : null,
        gpt_summary:      gptResult     ? (gptResult.summary   || '') : null,
        gemini_score:     geminiResult  ? (geminiResult.score  || 50) : null,
        gemini_summary:   geminiResult  ? (geminiResult.summary|| '') : null,
        meta_score:       verdict.meta_score     != null ? verdict.meta_score     : null,
        meta_reasoning:   verdict.meta_reasoning != null ? verdict.meta_reasoning : null,
        meta_action:      verdict.meta_action    != null ? verdict.meta_action    : null,
        confidence:       consensus.confidence,
        had_conflict:     consensus.hadConflict,
        disagreements:    verdict.disagreements || [],
        engine_statuses:  { claude: claudeEnv.status, gpt: gptEnv.status, gemini: geminiEnv.status },
        engines_ok:       successCount
      });
    } catch(e) { console.warn('[Brain] saveBrainDecision failed:', e.message); }

    setP(100, successCount === configuredCount
      ? '✅ ' + configuredCount + '/' + configuredCount + ' מנועים — Meta-Judge החליט'
      : '⚠️ ' + successCount + '/' + configuredCount + ' מנועים — Meta-Judge החליט בכל זאת');

    // ── Kick off deep enrichment (phases 2-4) async — don't block the result ──
    // The user sees score+analysis immediately. Strategy/emails enrich in background.
    (function _deepEnrichAsync() {
      setTimeout(async function() {
        try {
          setP(100, '🔬 מעשיר בעומק — אסטרטגיה + מיילים...');
          var deepResult = await window._deepAIPipeline(lead);
          // Merge deep fields into finalResult WITHOUT overriding Meta-Judge score/tier
          var enriched = Object.assign({}, deepResult, {
            score:             finalResult.score,
            tier:              finalResult.tier,
            summary:           finalResult.summary,
            executive_summary: finalResult.executive_summary,
            next_action:       finalResult.next_action,
            status:            'done',
            triple_engine:     true,
            meta_score:        finalResult.meta_score,
            meta_reasoning:    finalResult.meta_reasoning,
            engines_ok:        finalResult.engines_ok,
            engines_total:     finalResult.engines_total,
            engine_statuses:   finalResult.engine_statuses
          });
          lead.ai_analysis = enriched;
          var idx = leads.findIndex(function(l){return l.id===lead.id;});
          if (idx!==-1) leads[idx] = lead;
          if (typeof db!=='undefined'&&db)
            db.collection('leads').doc(String(lead.id)).set(window._cleanForFirebase(lead)).catch(function(){});
          renderSimpleLead(lead);
          // Re-open tab if card is expanded
          var bdy = document.getElementById('body-'+lead.id);
          if (bdy && bdy.classList.contains('open')) {
            var tabs = document.querySelectorAll('#lead-'+lead.id+' .lead-tab');
            if (tabs[1]) switchLeadTab(lead.id, 'analysis', tabs[1]);
          }
          setP(100, '✅ ניתוח מלא הושלם — אסטרטגיה + מיילים מוכנים');
        } catch(e) {
          console.warn('[Brain] Deep enrich failed (non-critical):', e.message);
        }
      }, 200);
    })();

    // ── Auto-close Debug Panel with summary after 6s ──────────────────
    (function() {
      var panel = document.getElementById('_triple_debug_panel');
      if (!panel) return;
      if (panel._dbgTimer) clearInterval(panel._dbgTimer);

      var elEl = document.getElementById('_dbg_elapsed');
      var timingEl = document.getElementById('_dbg_timing');
      if (timingEl && elEl) {
        timingEl.innerHTML = (successCount < configuredCount
          ? '<span style="color:#F59E0B">⚠️ ' + successCount + '/' + configuredCount + ' מנועים</span> — '
          : '✅ ') +
          'הושלם ב-<strong style="color:#a78bfa">' + elEl.textContent + 's</strong>';
      }

      var summary = document.createElement('div');
      summary.style.cssText = 'margin-top:8px;padding:8px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;text-align:center';
      var finalScore = finalResult.score || '?';
      var scoreColor = finalScore >= 80 ? '#10b981' : finalScore >= 60 ? '#F59E0B' : '#ef4444';
      summary.innerHTML =
        '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">ציון סופי (Meta-Judge)</div>' +
        '<div style="font-size:26px;font-weight:900;color:' + scoreColor + '">' + finalScore + '</div>' +
        (finalResult.tier ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px">' + finalResult.tier + '</div>' : '') +
        (successCount < configuredCount ? '<div style="font-size:10px;color:#F59E0B;margin-top:4px">⚠️ ' + (configuredCount - successCount) + ' מנוע(ים) נכשל — תוצאה חלקית</div>' : '');
      panel.appendChild(summary);

      setTimeout(function() {
        panel.style.transition = 'opacity 0.8s ease';
        panel.style.opacity = '0';
        setTimeout(function() { if (panel.parentNode) panel.remove(); }, 800);
      }, 6000);
    })();

    return finalResult;
  };

    // ── Deep pipeline: 3 phases ───────────────────────────────────
  window._deepAIPipeline = async function(lead) {
    var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;
    var compInfo = '';
    try { compInfo = Object.values(competitorData||{}).map(function(c){return c.name+': '+c.weakness;}).join('\n'); } catch(e){}

    var METH = await ensureMethodologyInFirebase();

    function setP(pct, msg) {
      var bar=document.getElementById('analysis-bar-'+lead.id);
      var txt=document.getElementById('analysis-progress-'+lead.id);
      if(bar) bar.style.width=pct+'%';
      if(txt) txt.textContent=msg;
      var gPct = Math.round(((_aq.done||0)/(_aq.total||1))*100);
      _pbUpdate(Math.round(gPct*0.7+pct*0.3), msg.substring(0,35), lead);
    }

    // ── PHASE A: Research + Strategy (merged 1+2) ──────────────────
    setP(5, '🧠 Claude — שלב 1/2: מחקר + אסטרטגיה...');
    var proxy = null;
    try {
      var pr = await window._authFetch(SERVER+'/analyze?url='+encodeURIComponent('https://'+domain),
        {signal: AbortSignal.timeout(5000)});
      if (pr.ok) proxy = await pr.json();
    } catch(e) {}
    var pCtx = proxy
      ? 'פלטפורמה='+(proxy.ticketPlatform||'?')+
        ', מייל='+(proxy.email||'?')+
        ', רשתות='+(((proxy.socialLinks||[]).join(','))||'?')+
        ', טלפון='+(proxy.phone||'?')
      : 'לא נמצא מידע מהאתר';

    setP(15, '🧠 Claude — שלב 1/2: ניתוח + אסטרטגיה...');
    var pA = await _callAI(
      'אתה חוקר B2B ומנהל מכירות בכיר ב-XTIX.AI. החזר JSON נקי בלבד. ענה בעברית.',
      `נתח את הליד הבא לצורך מכירת XTIX.AI וגם בנה אסטרטגיית מכירה:
שם: ${lead.name} | דומיין: ${domain}
סוג: ${lead.type||'?'} | פלטפורמה: ${lead.platform||'?'}
טלפון: ${lead.phone||'?'} | מייל: ${lead.email||'?'} | כתובת: ${lead.address||'?'}
מידע מאתר: ${pCtx}
מתחרים בשוק: ${compInfo}

החזר JSON עם כל השדות האלה:
{
  "summary": "2-3 משפטים על הליד",
  "executive_summary": "למה הליד מעניין XTIX עכשיו",
  "segment": "קטגוריה",
  "platform_current": "שם פלטפורמה",
  "platform_weakness": "החולשה הספציפית",
  "competitors_used": ["מתחרה"],
  "target_audience": "תיאור קהל",
  "events_per_year": "כמות",
  "venue_size": "גודל מקום",
  "ticket_price_range": "טווח מחיר",
  "estimated_annual_tickets": "כמות שנתית",
  "estimated_annual_revenue": "הכנסה שנתית",
  "estimated_annual_fees": "עמלות נוכחיות ₪",
  "estimated_xtix_savings": "חיסכון עם XTIX ₪",
  "pain_points": ["כאב1","כאב2","כאב3"],
  "social_intel": "עוקבים, תדירות, engagement",
  "pricing_intel": "מידע תמחור",
  "address": "כתובת",
  "raw_research": "מידע גולמי שנמצא",
  "sales_attack": "איך תוקפים — ספציפי",
  "pitch_angle": "ROI|Data|Brand|AI",
  "pitch": "פתיחה ספציפית — שורה ראשונה",
  "meeting_prep": "הכנה לשיחה",
  "discovery_questions": ["שאלה1","שאלה2","שאלה3","שאלה4","שאלה5"],
  "next_action": "פעולה ספציפית אחת למחר",
  "objection_handlers": {
    "מרוצים": "תשובה ספציפית",
    "אין זמן": "תשובה",
    "יקר": "תשובה",
    "לא מכיר": "תשובה"
  }
}`,
      2500, 80000);

    // ── PHASE B: Methodology + Emails (merged 3+4) ─────────────────
    setP(55, '🧠 Claude — שלב 2/2: ניתוח מתודולוגיה...');
    var cadenceDays = {'hot':[1,3,7,14],'cool':[1,7,21,45],'warm':[1,5,12,25]};

    // ── Phase B1: Methodology (scoring + BPs + strategy) ─────────────
    var pB1 = await _callAI(
      'אתה יועץ מכירות בכיר. החזר JSON נקי בלבד. ענה בעברית.',
      `נתח את הליד ${lead.name} מול המתודולוגיה:

מתודולוגיה (עיקרים):
${(METH||'').substring(0,800)}

נתוני הליד:
פלטפורמה: ${pA.platform_current||'?'} | חולשה: ${pA.platform_weakness||'?'}
קהל: ${pA.target_audience||'?'} | אירועים/שנה: ${pA.events_per_year||'?'}
עמלות: ${pA.estimated_annual_fees||'?'} | חיסכון XTIX: ${pA.estimated_xtix_savings||'?'}
כאבים: ${(pA.pain_points||[]).join(', ')}
Social: ${pA.social_intel||'?'}
זווית: ${pA.pitch_angle||'ROI'} | אסטרטגיה: ${pA.sales_attack||'?'}

החזר JSON:
{
  "score": 75, "tier": "A", "recommended_cadence": "hot",
  "scoring_breakdown": {
    "platform": {"score": 28, "reason": "..."},
    "audience_size": {"score": 22, "reason": "..."},
    "digital_presence": {"score": 17, "reason": "..."},
    "economic_pain": {"score": 14, "reason": "..."},
    "contact_access": {"score": 9, "reason": "..."}
  },
  "four_fs": {"f1_current": "...", "f2_working": "...", "f3_pain": "...", "f4_future": "..."},
  "salesforce_bps": {
    "bp2_persona_fit": "high|medium|low", "bp6_priority": "high|medium|low",
    "bp7_prep_notes": "...", "bp8_decision_maker": "...",
    "bp11_social_proof": "...", "bp17_value_angle": "ROI|Data|Brand"
  },
  "attack_angle": "...", "best_opening": "...",
  "risk_factors": ["..."], "summary_for_rep": "..."
}`,
      1200, 65000);

    // ── Phase B2: Emails ──────────────────────────────────────────
    setP(80, '🧠 Claude — שלב 2/2: כותב מיילים...');
    var cadence = pB1.recommended_cadence || 'warm';
    var days = cadenceDays[cadence] || cadenceDays['warm'];
    var pB2 = { email_sequence: [] };
    try {
      pB2 = await window._callAIFast(
        'מומחה מכירות XTIX. כתוב 4 מיילים ספציפיים המבוססים על המחקר. JSON בלבד. עברית.',
        `4 מיילים ל-${lead.name} (${pA.platform_current||'?'})
ימים: ${days.join(' → ')} | Cadence: ${cadence} | זווית: ${pA.pitch_angle||'ROI'}
עמלות נוכחיות: ${pA.estimated_annual_fees||'?'} | חיסכון עם XTIX: ${pA.estimated_xtix_savings||'?'}
כאבים: ${(pA.pain_points||[]).join(', ')}
מחקר על הליד: ${(pA.raw_research||'').substring(0,300)}
פתיחה מומלצת: ${pA.pitch||'?'}

{"email_sequence":[
{"email_num":1,"day":${days[0]},"type":"curiosity","subject":"","body":"","cta":""},
{"email_num":2,"day":${days[1]},"type":"roi","subject":"","body":"","cta":""},
{"email_num":3,"day":${days[2]},"type":"social_proof","subject":"","body":"","cta":""},
{"email_num":4,"day":${days[3]},"type":"breakup","subject":"","body":"","cta":""}
]}`,
        1400, 40000);
    } catch(e) {
      console.warn('[Brain] Email generation failed (non-critical):', e.message);
    }

    setP(97, '💾 שומר תוצאות...');
    var sc = parseInt(pB1.score)||55;
    return {
      status: 'done',
      enriched_at: new Date().toISOString(),
      summary:                  pA.summary||'',
      executive_summary:        pA.executive_summary||'',
      segment:                  pA.segment||lead.type||'',
      platform_current:         pA.platform_current||lead.platform||'',
      platform_weakness:        pA.platform_weakness||'',
      competitors_used:         pA.competitors_used||[],
      target_audience:          pA.target_audience||'',
      events_per_year:          pA.events_per_year||'',
      venue_size:               pA.venue_size||'',
      ticket_price_range:       pA.ticket_price_range||'',
      estimated_annual_tickets: pA.estimated_annual_tickets||'',
      estimated_annual_revenue: pA.estimated_annual_revenue||'',
      estimated_annual_fees:    pA.estimated_annual_fees||'',
      estimated_xtix_savings:   pA.estimated_xtix_savings||'',
      pain_points:              pA.pain_points||[],
      social_intel:             pA.social_intel||'',
      pricing_intel:            pA.pricing_intel||'',
      address:                  pA.address||lead.address||'',
      raw_research:             pA.raw_research||'',
      sales_attack:             pA.sales_attack||'',
      pitch_angle:              pA.pitch_angle||'ROI',
      pitch:                    pA.pitch||'',
      meeting_prep:             pA.meeting_prep||'',
      discovery_questions:      pA.discovery_questions||[],
      next_action:              pA.next_action||'',
      objection_handlers:       pA.objection_handlers||{},
      score:                    sc,
      tier:                     pB1.tier||(sc>=80?'A':sc>=60?'B':'C'),
      recommended_cadence:      pB1.recommended_cadence||'warm',
      scoring_breakdown:        pB1.scoring_breakdown||{},
      four_fs:                  pB1.four_fs||{},
      salesforce_bps:           pB1.salesforce_bps||{},
      attack_angle:             pB1.attack_angle||'',
      best_opening:             pB1.best_opening||'',
      risk_factors:             pB1.risk_factors||[],
      summary_for_rep:          pB1.summary_for_rep||'',
      email_sequence:           pB2.email_sequence||[],
      internal_summary: (pB1.summary_for_rep||pA.executive_summary||'')+(pA.next_action?'\n\nהצעד הבא: '+pA.next_action:'')
    };
  };

})();
