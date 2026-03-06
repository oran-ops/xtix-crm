// ================================================================
//  XTIX AI ENGINE v3.0
//  Triple Engine: Claude (כאבים) + GPT (כסף) + Gemini (מודיעין)
//  Meta-Judge: לומד מ-Firebase, מחליט, מסביר
//  Human Loop: outcome מעודכן ע"י איש מכירות → מוח לומד
// ================================================================
// Dependencies (from index.html):
//   window.SERVER, window._authFetch, window.db (Firestore)
//   window.competitorData, window.ensureMethodologyInFirebase
//   window.renderSimpleLead, window._pbUpdate, window._aq
//   window.saveBrainDecision, window.getBrainHistory
// ================================================================

(function() {
'use strict';

// ════════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════════

var ANALYSIS_LOG_COL  = 'analysis_log';
var AI_DECISIONS_COL  = 'ai_decisions';

var TIMEOUT_CLAUDE     = 120000;
var TIMEOUT_GPT        = 90000;
var TIMEOUT_GEMINI     = 60000;
var TIMEOUT_META_JUDGE = 90000;
var TIMEOUT_DEEP       = 150000;

// ════════════════════════════════════════════════════════════════
//  SHARED SCORING GUIDE
// ════════════════════════════════════════════════════════════════

var SHARED_SCORING_GUIDE = [
  '=== מדריך ציון 0-100 ===',
  '• +30: מוכר כרטיסים (כולל ידנית)',
  '• +25: הפנייה לדומיין חיצוני לרכישה',
  '• +15: מכירה ידנית בלבד (ביט/העברה/וואטסאפ)',
  '• +10: פעילות קבועה (3+ אירועים/שנה)',
  '• +10: גודל משמעותי (100+ כרטיסים/אירוע)',
  '• +5:  מחיר כרטיס 50+ ₪',
  '• -20: לא מוכר כרטיסים כלל',
  '• -10: פעילות חד-פעמית / לא ברורה',
  'Tier: A=70-100 | B=40-69 | C=0-39',
  'כאבים: ראיות בלבד — אסור להמציא'
].join('\n');

// ════════════════════════════════════════════════════════════════
//  HTTP HELPERS
// ════════════════════════════════════════════════════════════════

async function _callGPT(systemPrompt, userPrompt, maxTokens) {
  var res = await window._authFetch(SERVER + '/gpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens || 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(TIMEOUT_GPT)
  });
  if (!res.ok) {
    var err = await res.json().catch(function(){return {};});
    throw new Error('GPT: ' + ((err.error && err.error.message) || 'HTTP ' + res.status));
  }
  var d = await res.json();
  var raw = (d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content) || '';
  return _parseJSON(raw, 'GPT');
}

async function _callGemini(systemPrompt, userPrompt, maxTokens) {
  var MODELS = ['gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-flash-latest','gemini-1.5-flash-8b-latest'];
  var lastError = null;
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
          generationConfig: { maxOutputTokens: maxTokens || 2000, temperature: 0.4 }
        }),
        signal: AbortSignal.timeout(TIMEOUT_GEMINI)
      });
      if (res.status===429||res.status===404||res.status===503||res.status===403) {
        lastError = new Error('Gemini/'+model+': HTTP '+res.status); continue;
      }
      if (!res.ok) throw new Error('Gemini/'+model+': HTTP '+res.status);
      var d = await res.json();
      var raw = (d.candidates&&d.candidates[0]&&d.candidates[0].content&&
                 d.candidates[0].content.parts&&d.candidates[0].content.parts[0]&&
                 d.candidates[0].content.parts[0].text) || '';
      if (!raw) { lastError = new Error('Gemini/'+model+': empty'); continue; }
      var parsed = _parseJSON(raw, 'Gemini');
      parsed._geminiModel = model;
      return parsed;
    } catch(e) {
      lastError = e;
      if (e.name==='TimeoutError'||e.name==='AbortError') { continue; }
      if (mi===MODELS.length-1) throw lastError;
    }
  }
  throw lastError || new Error('Gemini: all models failed');
}

function _parseJSON(raw, label) {
  raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
  var si = raw.indexOf('{'), ei = raw.lastIndexOf('}');
  if (si!==-1&&ei!==-1) raw = raw.substring(si,ei+1);
  try { return JSON.parse(raw); } catch(e1) {
    try {
      var fixed = raw.replace(/'/g,'"').replace(/,\s*}/g,'}').replace(/,\s*]/g,']')
        .replace(/([{,]\s*)([a-zA-Z_\u0590-\u05FF][a-zA-Z0-9_\u0590-\u05FF]*)\s*:/g,'$1"$2":');
      return JSON.parse(fixed);
    } catch(e2) {
      console.warn('['+label+'] JSON parse failed');
      return { score:50, tier:'B', summary:raw.substring(0,300), status:'parse_error' };
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  FIREBASE — ANALYSIS LOG
// ════════════════════════════════════════════════════════════════

window.saveAnalysisLog = async function(leadId, leadName, engines, verdict, proxyData) {
  var docId = 'log_' + leadId + '_' + Date.now();
  var doc = {
    lead_id: leadId, lead_name: leadName,
    timestamp: new Date().toISOString(),
    engines_raw: {
      claude: engines.claude || null,
      gpt:    engines.gpt    || null,
      gemini: engines.gemini || null
    },
    engine_scores: {
      claude: engines.claude ? (engines.claude.score||null) : null,
      gpt:    engines.gpt    ? (engines.gpt.score||null)    : null,
      gemini: engines.gemini ? (engines.gemini.score||null) : null
    },
    meta_verdict: {
      score:             verdict.meta_score       || null,
      tier:              verdict.final_tier        || null,
      reasoning:         verdict.meta_reasoning   || null,
      action:            verdict.meta_action       || null,
      score_breakdown:   verdict.score_breakdown  || null,
      platform_verdict:  verdict.platform_verdict || null,
      pain_verdict:      verdict.pain_verdict      || null,
      confidence:        verdict.confidence        || null,
      confidence_reason: verdict.confidence_reason || null,
      disagreements:     verdict.disagreements     || []
    },
    proxy_snapshot: proxyData || null,
    outcome: null, outcome_date: null, outcome_notes: null,
    quality_flags: { engines_agreed:false, pain_evidence:false, platform_verified:false, high_confidence:false }
  };
  try {
    if (typeof db!=='undefined'&&db)
      await db.collection(ANALYSIS_LOG_COL).doc(docId).set(window._cleanForFirebase(doc));
  } catch(e) { console.warn('[Brain] saveAnalysisLog failed:', e.message); }
  return docId;
};

window.updateAnalysisOutcome = async function(logDocId, outcome, notes) {
  try {
    if (typeof db!=='undefined'&&db)
      await db.collection(ANALYSIS_LOG_COL).doc(logDocId).update({
        outcome: outcome, outcome_date: new Date().toISOString(), outcome_notes: notes||null
      });
  } catch(e) { console.warn('[Brain] updateAnalysisOutcome failed:', e.message); }
};

// ════════════════════════════════════════════════════════════════
//  FIREBASE MEMORY — 25 שאלות
// ════════════════════════════════════════════════════════════════

window.getBrainMemory = async function(lead) {
  var segment  = lead.segment || lead.type || '';
  var platform = lead.platform || '';
  var memory   = { segment_stats:null, platform_stats:null, score_correlations:null, mistake_patterns:null, timing_patterns:null, recent_wins:null, recent_losses:null, raw_decisions:[] };

  try {
    if (typeof db==='undefined'||!db) return memory;

    var snap = await db.collection(AI_DECISIONS_COL).orderBy('timestamp','desc').limit(100).get();
    var all = [];
    snap.forEach(function(doc){ all.push(Object.assign({_id:doc.id},doc.data())); });
    memory.raw_decisions = all;

    var segmentDecisions = all.filter(function(d){ return d.lead_segment===segment&&d.outcome!==null; });
    var segClosed  = segmentDecisions.filter(function(d){ return d.outcome==='נסגר'; });
    var segLost    = segmentDecisions.filter(function(d){ return d.outcome==='לא נסגר'; });

    memory.segment_stats = {
      total: segmentDecisions.length, closed: segClosed.length, lost: segLost.length,
      no_reply: segmentDecisions.filter(function(d){ return d.outcome==='אין מענה'; }).length,
      close_rate: segmentDecisions.length ? Math.round(segClosed.length/segmentDecisions.length*100) : null,
      avg_score_closed: segClosed.length ? Math.round(segClosed.reduce(function(s,d){return s+(d.final_score||d.meta_score||0);},0)/segClosed.length) : null,
      avg_score_lost:   segLost.length   ? Math.round(segLost.reduce(function(s,d){return s+(d.final_score||d.meta_score||0);},0)/segLost.length)   : null,
      top_pain_closed:  _extractTopPain(segClosed),
      top_pain_lost:    _extractTopPain(segLost),
      best_cadence:     _extractBestCadence(segClosed)
    };

    var platDecisions = all.filter(function(d){ return d.platform&&platform&&d.platform.toLowerCase().includes(platform.toLowerCase())&&d.outcome!==null; });
    var platClosed = platDecisions.filter(function(d){ return d.outcome==='נסגר'; });

    memory.platform_stats = {
      total: platDecisions.length, closed: platClosed.length,
      close_rate: platDecisions.length ? Math.round(platClosed.length/platDecisions.length*100) : null,
      best_pain:  _extractTopPain(platClosed),
      best_pitch: platClosed.length&&platClosed[0].meta_action ? platClosed[0].meta_action : null,
      avg_close_days: _calcAvgCloseDays(platClosed)
    };

    var withOutcome = all.filter(function(d){ return d.outcome!==null&&(d.final_score||d.meta_score); });
    var currentScore = lead.ai_analysis ? (lead.ai_analysis.score||50) : 50;

    memory.score_correlations = {
      similar_score_close_rate: _calcSimilarScoreCloseRate(withOutcome, currentScore),
      min_closing_score:   _calcMinClosingScore(withOutcome),
      sure_closing_score:  _calcSureClosingScore(withOutcome),
      avg_score_deviation: _calcScoreDeviation(withOutcome)
    };

    memory.mistake_patterns = {
      false_positives: all.filter(function(d){ return (d.final_score||d.meta_score||0)>=70&&d.outcome==='לא נסגר'; }).slice(0,3)
        .map(function(d){ return { lead:d.lead_name, score:d.final_score||d.meta_score, notes:d.outcome_notes||'' }; }),
      false_negatives: all.filter(function(d){ return (d.final_score||d.meta_score||0)<50&&d.outcome==='נסגר'; }).slice(0,3)
        .map(function(d){ return { lead:d.lead_name, score:d.final_score||d.meta_score, notes:d.outcome_notes||'' }; }),
      least_accurate_engine: _findLeastAccurateEngine(segmentDecisions)
    };

    memory.timing_patterns = { avg_response_days: _calcAvgCloseDays(segClosed) };
    memory.recent_wins   = segClosed.slice(0,5).map(function(d){ return { name:d.lead_name, score:d.final_score||d.meta_score, action:d.meta_action, notes:d.outcome_notes }; });
    memory.recent_losses = segLost.slice(0,5).map(function(d){ return { name:d.lead_name, score:d.final_score||d.meta_score, notes:d.outcome_notes }; });

  } catch(e) { console.warn('[Brain] getBrainMemory failed:', e.message); }
  return memory;
};

function _extractTopPain(decisions) {
  var c={};
  decisions.forEach(function(d){ var p=d.pain_verdict||[]; if(!Array.isArray(p))return; p.forEach(function(x){ var k=typeof x==='string'?x.substring(0,50):''; if(k) c[k]=(c[k]||0)+1; }); });
  var t=Object.entries(c).sort(function(a,b){return b[1]-a[1];}); return t.length?t[0][0]:null;
}
function _extractBestCadence(decisions) {
  var c={}; decisions.forEach(function(d){ var x=d.recommended_cadence||d.cadence; if(x) c[x]=(c[x]||0)+1; });
  var t=Object.entries(c).sort(function(a,b){return b[1]-a[1];}); return t.length?t[0][0]:null;
}
function _calcAvgCloseDays(decisions) {
  var days=decisions.filter(function(d){return d.timestamp&&d.outcome_date;}).map(function(d){return Math.round((new Date(d.outcome_date)-new Date(d.timestamp))/(1000*60*60*24));}).filter(function(n){return n>=0&&n<365;});
  return days.length?Math.round(days.reduce(function(a,b){return a+b;},0)/days.length):null;
}
function _calcSimilarScoreCloseRate(decisions, target) {
  var s=decisions.filter(function(d){return Math.abs((d.final_score||d.meta_score||0)-target)<=10;});
  if(!s.length)return null;
  var c=s.filter(function(d){return d.outcome==='נסגר';});
  return {total:s.length,closed:c.length,rate:Math.round(c.length/s.length*100)};
}
function _calcMinClosingScore(decisions) {
  var c=decisions.filter(function(d){return d.outcome==='נסגר';});
  if(!c.length)return null;
  return Math.min.apply(null,c.map(function(d){return d.final_score||d.meta_score||0;}));
}
function _calcSureClosingScore(decisions) {
  for(var t=90;t>=60;t-=5){
    var a=decisions.filter(function(d){return(d.final_score||d.meta_score||0)>=t;});
    if(a.length<3)continue;
    var c=a.filter(function(d){return d.outcome==='נסגר';});
    if(c.length/a.length>=0.75)return t;
  }
  return null;
}
function _calcScoreDeviation(decisions) {
  var d=decisions.filter(function(d){return d.outcome!==null;}).map(function(d){return(d.outcome==='נסגר'?1:0)===(((d.final_score||d.meta_score||50)>=60)?1:0)?0:1;});
  return d.length?Math.round(d.reduce(function(a,b){return a+b;},0)/d.length*100):null;
}
function _findLeastAccurateEngine(decisions) {
  var e={claude:0,gpt:0,gemini:0,total:0};
  decisions.forEach(function(d){
    if(!d.outcome)return; e.total++;
    var actual=d.outcome==='נסגר'?1:0;
    ['claude','gpt','gemini'].forEach(function(eng){
      var s=d[eng+'_score']||(d[eng+'_raw']&&d[eng+'_raw'].score)||null;
      if(s!==null&&(s>=60?1:0)!==actual) e[eng]++;
    });
  });
  if(!e.total)return null;
  var w=['claude','gpt','gemini'].sort(function(a,b){return e[b]-e[a];})[0];
  return {engine:w,error_rate:Math.round(e[w]/e.total*100)};
}

function _buildMemoryString(memory, lead) {
  if(!memory||!memory.segment_stats) return 'אין היסטוריה זמינה עדיין.';
  var lines=['Firebase Memory:'];
  var ss=memory.segment_stats, ps=memory.platform_stats, sc=memory.score_correlations, mp=memory.mistake_patterns;

  if(ss.total>0){
    lines.push('סגמנט "'+( lead.segment||lead.type||'')+'": '+ss.total+' לידים | נסגרו: '+ss.closed+' ('+(ss.close_rate||0)+'%) | לא נסגרו: '+ss.lost);
    if(ss.avg_score_closed) lines.push('  ציון ממוצע נסגרו: '+ss.avg_score_closed);
    if(ss.avg_score_lost)   lines.push('  ציון ממוצע לא נסגרו: '+ss.avg_score_lost);
    if(ss.top_pain_closed)  lines.push('  כאב שהוביל לסגירה: '+ss.top_pain_closed);
    if(ss.top_pain_lost)    lines.push('  כאב שחזר בלא-נסגרים: '+ss.top_pain_lost);
    if(ss.best_cadence)     lines.push('  cadence שעבד: '+ss.best_cadence);
  } else { lines.push('סגמנט "'+( lead.segment||lead.type||'')+'": אין נתונים עדיין'); }

  if(ps&&ps.total>0){
    lines.push('פלטפורמה "'+( lead.platform||'')+'": '+ps.total+' | נסגרו: '+ps.closed+(ps.close_rate?' ('+ps.close_rate+'%)':''));
    if(ps.best_pain) lines.push('  כאב שעבד: '+ps.best_pain);
    if(ps.avg_close_days) lines.push('  זמן סגירה ממוצע: '+ps.avg_close_days+' ימים');
  }

  if(sc){
    if(sc.similar_score_close_rate){var s=sc.similar_score_close_rate; lines.push('לידים עם ציון דומה: '+s.total+' | נסגרו: '+s.closed+' ('+s.rate+'%)');}
    if(sc.min_closing_score)  lines.push('ציון מינימלי שנסגר: '+sc.min_closing_score);
    if(sc.sure_closing_score) lines.push('ציון שמעליו 75%+ נסגרים: '+sc.sure_closing_score);
  }

  if(mp){
    if(mp.false_positives&&mp.false_positives.length){ lines.push('⚠️ ציון גבוה שלא נסגר:'); mp.false_positives.forEach(function(fp){ lines.push('  • '+fp.lead+' ('+fp.score+')'+(fp.notes?': '+fp.notes.substring(0,60):'')); }); }
    if(mp.least_accurate_engine) lines.push('מנוע הכי לא מדויק בסגמנט: '+mp.least_accurate_engine.engine+' ('+mp.least_accurate_engine.error_rate+'% שגיאות)');
  }

  if(memory.recent_wins&&memory.recent_wins.length){
    lines.push('ניצחונות אחרונים:');
    memory.recent_wins.slice(0,3).forEach(function(w){ lines.push('  ✅ '+w.name+' ('+w.score+')'+(w.action?' — '+w.action.substring(0,60):'')); });
  }
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════
//  ENGINE 1 — CLAUDE: בלש הכאבים
// ════════════════════════════════════════════════════════════════

async function _claudePainDetective(lead, proxyCtx, compInfo, METH) {
  var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;

  var system = [
    'אתה בלש כאבים של XTIX — מוצא היכן מפיקים מפסידים כסף ושליטה.',
    'ענה על 5 שאלות ליבה בדיוק. כאבים = ראיות בלבד.',
    '',
    '5 שאלות ליבה:',
    '1. DATA OWNERSHIP: הקונים שייכים לליד או לפלטפורמה?',
    '2. REDIRECT: הרכישה קורית באתר הליד או בחוץ?',
    '3. UX: תהליך הקנייה קל או מסורבל?',
    '4. VALUE FOR MONEY: העמלה מוצדקת לעומת המענה?',
    '5. AI & GROWTH: משתמשים בכלים חכמים לצמיחה?',
    '',
    '⚡ KILLER COMBO: עמלה גבוהה + UX גרוע = סמן במיוחד',
    '',
    SHARED_SCORING_GUIDE,
    'החזר JSON נקי בלבד. עברית.'
  ].join('\n');

  var user = [
    'שם: '+(lead.name||'')+' | דומיין: '+domain,
    'סוג: '+(lead.type||'?')+' | פלטפורמה: '+(lead.platform||'?'),
    '',
    'מידע מהאתר (ראיות):',
    proxyCtx||'לא נמצא',
    'מתחרים: '+(compInfo||''),
    '',
    'החזר JSON:',
    '{',
    '  "score": 75,',
    '  "score_breakdown": {"sells_tickets":30,"external_platform":25,"manual_sales":0,"recurring_events":10,"event_size":10,"ticket_price":5,"deductions":0},',
    '  "tier": "A",',
    '  "pain_analysis": {',
    '    "data_ownership":   {"has_pain":true,  "evidence":"...", "severity":"high"},',
    '    "redirect":         {"has_pain":true,  "evidence":"...", "severity":"high"},',
    '    "ux_accessibility": {"has_pain":false, "evidence":null,  "severity":null},',
    '    "value_for_money":  {"has_pain":true,  "evidence":"...", "severity":"mid"},',
    '    "ai_growth":        {"has_pain":true,  "evidence":"...", "severity":"low"}',
    '  },',
    '  "killer_combo": true,',
    '  "killer_combo_explanation": "7% עמלה + checkout מחייב הרשמה",',
    '  "pain_points": ["כאב ספציפי עם ראיה"],',
    '  "pain_evidence": {"כאב": "הראיה"},',
    '  "platform_current": "SmartTicket",',
    '  "platform_weakness": "קהל לא שייך למפיק",',
    '  "competitors_used": ["SmartTicket"],',
    '  "summary": "2-3 משפטים על הכאבים",',
    '  "reasoning": "נימוק הציון — כמה נקודות לכל פרמטר",',
    '  "score_confidence": 0.85',
    '}'
  ].join('\n');

  var result = await _callAI(system, user, 2500, TIMEOUT_CLAUDE);
  result._engine = 'claude';
  result.status  = 'done';
  return result;
}

// ════════════════════════════════════════════════════════════════
//  ENGINE 2 — GPT: אנליסט הכסף
// ════════════════════════════════════════════════════════════════

async function _gptMoneyAnalyst(lead, proxyCtx, compInfo) {
  var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;

  var system = [
    'אתה אנליסט כלכלי של XTIX — בונה תמונת כסף מדויקת.',
    '6 משימות: (1) מחירי כרטיסים לפי סוג (2) היקף מכירות ומחזור (3) כמות אירועים (4) אירוע קרוב ותאריך (5) גודל קהילה (6) ROI CALCULATION — כמה חוסכים עם XTIX',
    'מספרים קונקרטיים — לא טווחים. אם אומדן — ציין.',
    SHARED_SCORING_GUIDE,
    'החזר JSON נקי בלבד. עברית.'
  ].join('\n');

  var user = [
    'שם: '+(lead.name||'')+' | דומיין: '+domain+' | פלטפורמה: '+(lead.platform||'?'),
    '',
    'מידע מהאתר:',
    proxyCtx||'לא נמצא',
    '',
    'החזר JSON:',
    '{',
    '  "score": 80,',
    '  "score_breakdown": {"sells_tickets":30,"external_platform":25,"recurring_events":10,"event_size":10,"ticket_price":5,"deductions":0},',
    '  "tier": "A",',
    '  "ticket_prices": {"regular":"₪120","vip":"₪220","early_bird":"₪90","source":"אתר/אומדן"},',
    '  "revenue_intel": {"annual_revenue_estimate":"₪200,000","source":"רשם החברות/אומדן","confidence":"mid"},',
    '  "event_volume": {"events_per_year":4,"avg_tickets_per_event":350,"total_annual_tickets":1400},',
    '  "next_event": {"date":"15.4.2026","name":"שם אירוע","urgency":"6 שבועות לסגירה","estimated_tickets":400},',
    '  "audience_size": {"facebook_followers":12000,"instagram_followers":4500,"total_blast_potential":16500},',
    '  "roi_calculation": {"current_platform_fee_pct":7,"current_annual_fees":"₪14,000","xtix_fee_pct":5.5,"xtix_annual_fees":"₪11,000","annual_saving":"₪3,000","total_value_pitch":"₪3,000 חיסכון + 1,400 קונים"},',
    '  "summary": "2-3 משפטים על תמונת הכסף",',
    '  "reasoning": "נימוק הציון"',
    '}'
  ].join('\n');

  var result = await _callGPT(system, user, 2000);
  result._engine = 'gpt';
  result.status  = 'done';
  return result;
}

// ════════════════════════════════════════════════════════════════
//  ENGINE 3 — GEMINI: סורק המודיעין
// ════════════════════════════════════════════════════════════════

async function _geminiIntelScanner(lead, proxyCtx, compInfo) {
  var domain = (lead.domain||'').replace(/https?:\/\//,'').split('/')[0] || lead.name;

  var system = [
    'אתה סורק מודיעין של XTIX — רואה את הליד מבחוץ.',
    '7 משימות: (1) COMPETITOR DOMAINS — דומיינים מתחרים (2) ערוצי שיווק (3) מכירה ברשתות או רק פרסום (4) רשתות פעילות + engagement (5) ניתוח עמוד + UX (6) טראפיק (7) מי מתחרה בליד עצמו',
    SHARED_SCORING_GUIDE,
    'החזר JSON נקי בלבד. עברית.'
  ].join('\n');

  var user = [
    'שם: '+(lead.name||'')+' | דומיין: '+domain+' | פלטפורמה: '+(lead.platform||'?'),
    '',
    'מידע מהאתר:',
    proxyCtx||'לא נמצא',
    'מתחרי XTIX: '+(compInfo||''),
    '',
    'החזר JSON:',
    '{',
    '  "score": 75,',
    '  "score_breakdown": {"sells_tickets":30,"external_platform":25,"recurring_events":10,"event_size":5,"ticket_price":5,"deductions":0},',
    '  "tier": "A",',
    '  "competitor_domains": {"platforms_used":["SmartTicket"],"lock_level":"high","external_urls_found":["smarticket.co.il/lead"]},',
    '  "marketing": {"channels":["Facebook organic"],"has_paid_ads":false,"has_pixel":false,"sophistication":"low"},',
    '  "social_selling": {"sells_via_social":false,"has_link_in_bio":true,"bio_link_destination":"SmartTicket"},',
    '  "social_platforms": {"facebook":{"active":true,"followers":12000,"posts_per_week":3,"engagement":"mid"},"instagram":{"active":true,"followers":4500,"engagement":"low"},"tiktok":{"active":false}},',
    '  "page_analysis": {"has_own_website":true,"design_quality":"mid","cta_clarity":"low","notes":"כפתור מוביל ל-SmartTicket"},',
    '  "traffic": {"monthly_visits_estimate":"2,400","source":"SimilarWeb אומדן"},',
    '  "lead_competitors": ["מתחרה 1","מתחרה 2"],',
    '  "competitive_pressure": "mid",',
    '  "summary": "2-3 משפטים על המודיעין החיצוני",',
    '  "reasoning": "נימוק הציון"',
    '}'
  ].join('\n');

  var result = await _callGemini(system, user, 2000);
  result._engine = 'gemini';
  result.status  = 'done';
  return result;
}

// ════════════════════════════════════════════════════════════════
//  META-JUDGE — לומד מ-Firebase, שופט, מחליט
// ════════════════════════════════════════════════════════════════

async function _metaJudge(lead, claudeResult, gptResult, geminiResult, memory, ctx) {
  ctx = ctx || {};
  var t0 = Date.now();

  function _eLine(name, result, env) {
    if(!result) return name+' ('+(env&&env.status||'failed')+'): נכשל';
    var bd = result.score_breakdown ? ' | פירוט: '+JSON.stringify(result.score_breakdown) : '';
    var rn = result.reasoning ? ' | נימוק: '+result.reasoning.substring(0,200) : '';
    var pp = result.pain_points&&result.pain_points.length ? ' | כאבים: '+result.pain_points.slice(0,3).join('; ') : '';
    var pl = result.platform_current ? ' | פלטפורמה: '+result.platform_current : '';
    var kc = result.killer_combo ? ' | ⚡ KILLER: '+(result.killer_combo_explanation||'') : '';
    return name+': ציון '+(result.score||'?')+pl+pp+kc+bd+rn;
  }

  var engineSummary = [
    _eLine('Claude (כאבים)', claudeResult, ctx.claudeEnv),
    _eLine('GPT (כסף)',      gptResult,    ctx.gptEnv),
    _eLine('Gemini (מודיעין)',geminiResult, ctx.geminiEnv)
  ].join('\n\n');

  var memStr = _buildMemoryString(memory, lead);
  var partialNote = (ctx.failedEngines&&ctx.failedEngines.length) ? '\n⚠️ נכשלו: '+ctx.failedEngines.join(', ') : '';

  var system = [
    'אתה Meta-Judge של XTIX CRM — השופט הסופי.',
    'יש לך: (1) תוצאות 3 מנועים (2) זיכרון Firebase (3) מדריך ציון.',
    'אתה לא ממצע — אתה מחליט ומסביר בנקודות.',
    'כאב ללא ראיה = לא קיים. Firebase pattern = משקל גבוה.',
    SHARED_SCORING_GUIDE,
    'החזר JSON נקי בלבד. עברית.'
  ].join('\n');

  var user = [
    'ליד: '+(lead.name||'')+' | סגמנט: '+(lead.segment||lead.type||'')+' | פלטפורמה: '+(lead.platform||''),
    '',
    '=== תוצאות מנועים ===',
    engineSummary,
    partialNote,
    '',
    '=== זיכרון Firebase ===',
    memStr,
    '',
    '=== 25 שאלות לענות עליהן בניתוח ===',
    '1. ציון סופי — פרט נקודות לכל פרמטר',
    '2. Killer Combo קיים?',
    '3. אילו כאבים מאושרים? אילו ממוצאים?',
    '4. מה הפלטפורמה הנכונה + ראיה',
    '5. מחלוקות בין מנועים — למה בחרת צד?',
    '6. אחוז סגירה בסגמנט (Firebase)',
    '7. ציון ממוצע לידים שנסגרו בסגמנט',
    '8. כאב שהכי הוביל לסגירה בסגמנט',
    '9. pattern טעות שחוזרת',
    '10. ROI לציג בשיחה',
    '11. דחיפות — אירוע קרוב?',
    '12. cadence מומלץ (Firebase)',
    '13. רמת ביטחון + נימוק',
    '14. פעולה ספציפית מחר',
    '15. נוסח פתיחה מדויק לשיחה',
    '16. Tier סופי',
    '17. סיכוני סגירה',
    '18. social proof שניתן להשתמש',
    '19. שאלות גילוי לשיחה',
    '20. תשובה ל"מרוצים מהפלטפורמה"',
    '21. pitch angle מומלץ (ROI/Data/Brand/AI)',
    '22. blast potential (כמה אנשים)',
    '23. מה Gemini גילה שמשפיע על גישה',
    '24. מצב שיווק + איך XTIX משפר',
    '25. סיכום לנציג — 3 משפטים לפני שיחה',
    '',
    'החזר JSON:',
    '{',
    '  "meta_score": 82,',
    '  "final_tier": "A",',
    '  "score_breakdown": {"sells_tickets":30,"external_platform":25,"recurring_events":10,"event_size":10,"ticket_price":5,"deductions":0},',
    '  "platform_verdict": "SmartTicket — מאושר ע"י URL ישיר",',
    '  "pain_verdict": ["כאב מאושר בראיה"],',
    '  "killer_combo": true,',
    '  "killer_combo_explanation": "7% + הרשמה חובה",',
    '  "roi_pitch": "₪3,000 חיסכון + 1,400 קונים",',
    '  "next_event_urgency": "15.4 — 6 שבועות",',
    '  "recommended_cadence": "hot",',
    '  "meta_reasoning": "נימוק מפורט בנקודות",',
    '  "meta_action": "פעולה מחר",',
    '  "opening_line": "נוסח פתיחה מדויק",',
    '  "pitch_angle": "ROI",',
    '  "blast_potential": 16500,',
    '  "discovery_questions": ["שאלה1","שאלה2","שאלה3","שאלה4","שאלה5"],',
    '  "objection_handler": "איך לטפל ב\'מרוצים\'",',
    '  "risk_factors": ["סיכון1","סיכון2"],',
    '  "social_proof": "social proof רלוונטי",',
    '  "marketing_insight": "מה גילה Gemini",',
    '  "rep_summary": "3 משפטים לנציג לפני שיחה",',
    '  "firebase_context": "מה Firebase לימד",',
    '  "disagreements": ["מנוע X נתן Y כי Z — בחרתי A כי B"],',
    '  "confidence": "high",',
    '  "confidence_reason": "3 ראיות עצמאיות",',
    '  "final_summary": "סיכום מלא"',
    '}'
  ].join('\n');

  try {
    var judgeAbort = new AbortController();
    var judgeTimer = setTimeout(function(){ judgeAbort.abort(); }, TIMEOUT_META_JUDGE);
    var verdict = await _callAI(system, user, 2000, TIMEOUT_META_JUDGE, judgeAbort.signal);
    clearTimeout(judgeTimer);
    if(!verdict) throw new Error('empty');
    verdict._judgeMs = Date.now()-t0;
    return verdict;
  } catch(e) {
    console.warn('[Brain] Meta-Judge failed:', e.message);
    var best = claudeResult||gptResult||geminiResult||{};
    return { meta_score:best.score||50, final_tier:best.tier||'B', meta_reasoning:'Meta-Judge לא זמין', meta_action:best.next_action||'', pain_verdict:best.pain_points||[], platform_verdict:best.platform_current||'', disagreements:[], confidence:'low', confidence_reason:'Meta-Judge נכשל', final_summary:best.summary||'', rep_summary:best.summary||'', _judgeMs:Date.now()-t0 };
  }
}

// ════════════════════════════════════════════════════════════════
//  CONSENSUS
// ════════════════════════════════════════════════════════════════

function _calcConsensus(c, g, gem) {
  var pairs=[{score:c,weight:0.5},{score:g,weight:0.3},{score:gem,weight:0.2}].filter(function(p){return p.score!==null&&p.score!==undefined;});
  if(!pairs.length) return {weightedScore:50,spread:0,confidence:'low',hadConflict:false};
  var wt=pairs.reduce(function(a,p){return a+p.weight;},0);
  pairs.forEach(function(p){p.weight=p.weight/wt;});
  var weighted=Math.round(pairs.reduce(function(s,p){return s+p.score*p.weight;},0));
  var scores=pairs.map(function(p){return p.score;});
  var spread=scores.length>1?Math.max.apply(null,scores)-Math.min.apply(null,scores):0;
  return {weightedScore:weighted,spread:spread,confidence:spread<=10?'high':spread<=25?'mid':'low',hadConflict:spread>20};
}

// ════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════

window._cleanForFirebase = function _cleanForFirebase(obj) {
  if(obj===undefined) return null;
  if(obj===null||typeof obj!=='object') return obj;
  if(Array.isArray(obj)) return obj.map(window._cleanForFirebase);
  var out={};
  Object.keys(obj).forEach(function(k){out[k]=window._cleanForFirebase(obj[k]);});
  return out;
};

function _engineEnvelope(id,result,status,error,startMs){return{id:id,result:result||null,status:status,error:error||null,durationMs:Date.now()-startMs};}

function _withTimeout(promise,ms,label){
  var timerId;
  var timeout=new Promise(function(resolve){timerId=setTimeout(function(){console.warn('[Brain] '+label+' timeout');resolve('__TIMEOUT__');},ms);});
  return Promise.race([promise,timeout]).then(function(r){clearTimeout(timerId);return r;});
}

async function _runEngine(id,promiseFn,timeoutMs,dbgFn){
  var t0=Date.now(); dbgFn(id,'🔄 רץ...',null,false);
  try {
    var raw=await _withTimeout(promiseFn(),timeoutMs,id);
    if(raw==='__TIMEOUT__'){dbgFn(id,'⏱ Timeout ('+timeoutMs/1000+'s)',null,true);return _engineEnvelope(id,null,'timeout','timeout',t0);}
    if(!raw){dbgFn(id,'⚠️ ריק',null,true);return _engineEnvelope(id,null,'error','empty',t0);}
    var score=raw.score||null;
    var note=(id==='gemini'&&raw._geminiModel&&raw._geminiModel!=='gemini-2.0-flash')?' ('+raw._geminiModel+')':'';
    dbgFn(id,'✅ '+((Date.now()-t0)/1000).toFixed(1)+'s'+note+(score?' — ציון: '+score:''),score,false);
    return _engineEnvelope(id,raw,'ok',null,t0);
  } catch(e) {
    var isT=e.name==='TimeoutError'||e.name==='AbortError'||(e.message||'').includes('timeout');
    dbgFn(id,(isT?'⏱ Timeout':'❌ שגיאה')+': '+(e.message||'').substring(0,40),null,true);
    return _engineEnvelope(id,null,isT?'timeout':'error',e.message,t0);
  }
}

// ════════════════════════════════════════════════════════════════
//  DEBUG PANEL
// ════════════════════════════════════════════════════════════════

function _showDebugPanel(brainKeys){
  var existing=document.getElementById('_triple_debug_panel');
  if(existing&&existing.parentNode)existing.parentNode.removeChild(existing);
  var panel=document.createElement('div');
  panel.id='_triple_debug_panel';
  panel.style.cssText='position:fixed;bottom:60px;left:20px;z-index:9998;background:#0d0d14;border:1px solid rgba(124,58,237,0.4);border-radius:14px;padding:16px 20px;min-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-family:Heebo,sans-serif;direction:rtl';
  function row(id,color,label,flag){
    var ok=!flag||(brainKeys&&brainKeys[flag]);
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba('+color+',0.06);border:1px solid rgba('+color+',0.2);border-radius:8px;margin-bottom:6px">'+
      '<div style="flex:1"><div style="font-size:11px;font-weight:700;color:rgb('+color+')">'+label+'</div>'+
      '<div id="_dbg_'+id+'_status" style="font-size:11px;color:rgba(255,255,255,0.4)">'+(ok?'⏳ ממתין...':'○ לא מוגדר')+'</div></div>'+
      '<div id="_dbg_'+id+'_score" style="font-size:16px;font-weight:800;color:rgb('+color+');min-width:32px;text-align:center">—</div></div>';
  }
  panel.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
      '<div style="font-size:13px;font-weight:800;color:#a78bfa" id="_dbg_header">🔬 Triple Engine</div>'+
      '<button onclick="document.getElementById(\'_triple_debug_panel\').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;padding:2px 8px;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px">✕</button>'+
    '</div>'+
    row('claude','139,92,246','🟣 Claude — בלש כאבים',null)+
    row('gpt',   '16,185,129','🟢 GPT-4o — אנליסט כסף','gpt')+
    row('gemini','59,130,246','🔵 Gemini — מודיעין','gemini')+
    row('judge', '245,158,11','⚖️ Meta-Judge — למד מDB',null)+
    '<div id="_dbg_timing" style="font-size:10px;color:rgba(255,255,255,0.25);text-align:center;margin-top:8px">⏱ <span id="_dbg_elapsed">0</span>s</div>';
  document.body.appendChild(panel);
  var t=Date.now();
  var timer=setInterval(function(){var el=document.getElementById('_dbg_elapsed');if(el)el.textContent=((Date.now()-t)/1000).toFixed(1);else clearInterval(timer);},200);
  panel._dbgTimer=timer;
}

function _dbgUpdate(engine,status,score,isError){
  var sEl=document.getElementById('_dbg_'+engine+'_status');
  var scEl=document.getElementById('_dbg_'+engine+'_score');
  if(sEl){sEl.textContent=status;sEl.style.color=isError?'#ef4444':score?'#10b981':'rgba(255,255,255,0.6)';}
  if(scEl&&score!=null){scEl.textContent=score;scEl.style.color=score>=80?'#10b981':score>=60?'#F59E0B':'#3b82f6';}
}

function _dbgSetHeader(ok,total){var el=document.getElementById('_dbg_header');if(el)el.textContent='🔬 Triple Engine — '+ok+'/'+total;}

// ════════════════════════════════════════════════════════════════
//  TRIPLE ENGINE PIPELINE — ראשי
// ════════════════════════════════════════════════════════════════

window._tripleEnginePipeline = async function(lead) {
  var METH = await ensureMethodologyInFirebase();
  var compInfo = '';
  try { compInfo=Object.values(competitorData||{}).map(function(c){return c.name+': '+c.weakness;}).join('\n'); } catch(e){}

  function setP(pct,msg){
    var bar=document.getElementById('analysis-bar-'+lead.id);
    var txt=document.getElementById('analysis-progress-'+lead.id);
    if(bar)bar.style.width=pct+'%'; if(txt)txt.textContent=msg;
    var gPct=Math.round(((_aq&&_aq.done||0)/(_aq&&_aq.total||1))*100);
    if(typeof _pbUpdate==='function')_pbUpdate(Math.round(gPct*0.7+pct*0.3),msg.substring(0,40),lead);
  }

  var _brainKeys = window.getBrainKeys ? window.getBrainKeys() : {};
  var activeEngines = 1+(_brainKeys&&_brainKeys.gpt?1:0)+(_brainKeys&&_brainKeys.gemini?1:0);

  setP(5,activeEngines===3?'🚀 Triple Engine — Claude + GPT + Gemini במקביל...':activeEngines===2?'🚀 Dual Engine...':'🧠 Claude מנתח...');
  _showDebugPanel(_brainKeys);
  if(!(_brainKeys&&_brainKeys.gpt))    _dbgUpdate('gpt','○ לא מוגדר',null,false);
  if(!(_brainKeys&&_brainKeys.gemini)) _dbgUpdate('gemini','○ לא מוגדר',null,false);

  // שלב 1: proxy — פעם אחת לכולם
  setP(8,'🌐 סורק את האתר...');
  var proxyData=null, sharedProxyCtx='';
  try {
    var domain=(lead.domain||'').replace(/https?:\/\//,'').split('/')[0];
    var pr=await window._authFetch(SERVER+'/analyze?url='+encodeURIComponent('https://'+domain),{signal:AbortSignal.timeout(10000)});
    if(pr.ok){
      proxyData=await pr.json();
      sharedProxyCtx=[
        'פלטפורמה: '+(proxyData.ticketPlatform||'לא זוהתה'),
        'מייל: '+(proxyData.email||'לא נמצא'),
        'טלפון: '+(proxyData.phone||'לא נמצא'),
        proxyData.externalTicketUrl?'קישור חיצוני: '+proxyData.externalTicketUrl:'',
        proxyData.socialLinks&&proxyData.socialLinks.length?'רשתות: '+proxyData.socialLinks.join(', '):'',
        proxyData.contactName?'איש קשר: '+proxyData.contactName:'',
        proxyData.address?'כתובת: '+proxyData.address:'',
        proxyData.description?'תיאור: '+proxyData.description.substring(0,300):''
      ].filter(Boolean).join('\n');
    }
  } catch(e){console.warn('[Triple] Proxy failed:',e.message);}

  // שלב 2: זיכרון Firebase
  setP(12,'🧠 טוען זיכרון היסטורי...');
  var memory={};
  try{memory=await window.getBrainMemory(lead);}catch(e){console.warn('[Brain] Memory failed:',e.message);}

  // שלב 3: 3 מנועים במקביל
  setP(18,'🚀 '+activeEngines+' מנועים רצים במקביל...');

  var enginePromises=[
    _runEngine('claude',function(){return _claudePainDetective(lead,sharedProxyCtx,compInfo,METH);},TIMEOUT_CLAUDE,_dbgUpdate)
  ];
  if(_brainKeys&&_brainKeys.gpt)
    enginePromises.push(_runEngine('gpt',function(){return _gptMoneyAnalyst(lead,sharedProxyCtx,compInfo);},TIMEOUT_GPT,_dbgUpdate));
  else
    enginePromises.push(Promise.resolve(_engineEnvelope('gpt',null,'skipped','no key',Date.now())));

  if(_brainKeys&&_brainKeys.gemini)
    enginePromises.push(_runEngine('gemini',function(){return _geminiIntelScanner(lead,sharedProxyCtx,compInfo);},TIMEOUT_GEMINI,_dbgUpdate));
  else
    enginePromises.push(Promise.resolve(_engineEnvelope('gemini',null,'skipped','no key',Date.now())));

  var engineResults=await Promise.all(enginePromises);
  var claudeEnv=engineResults[0], gptEnv=engineResults[1], geminiEnv=engineResults[2];
  var claudeResult=claudeEnv.result, gptResult=gptEnv.result, geminiResult=geminiEnv.result;

  var successCount=[claudeEnv,gptEnv,geminiEnv].filter(function(e){return e.status==='ok';}).length;
  var configuredCount=1+(_brainKeys&&_brainKeys.gpt?1:0)+(_brainKeys&&_brainKeys.gemini?1:0);
  var failedEngines=[claudeEnv,gptEnv,geminiEnv].filter(function(e){return e.status==='error'||e.status==='timeout';}).map(function(e){return e.id+'('+e.status+')';});

  _dbgSetHeader(successCount,configuredCount);

  var allFailed=[claudeEnv,gptEnv,geminiEnv].filter(function(e){return e.status!=='skipped';}).every(function(e){return e.status!=='ok';});
  if(allFailed){
    _dbgUpdate('judge','⚠️ כל המנועים נכשלו',null,true);
    var fallback={score:50,tier:'B',summary:'ניתוח לא זמין',status:'done',triple_engine:true,engines_ok:0,engines_total:configuredCount};
    lead.ai_analysis=Object.assign({},fallback);
    if(typeof db!=='undefined'&&db)db.collection('leads').doc(String(lead.id)).set(window._cleanForFirebase(lead)).catch(function(){});
    renderSimpleLead(lead);setP(100,'⚠️ נסה שנית');return fallback;
  }

  var baseResult=claudeResult||gptResult||geminiResult;

  // שלב 4: Meta-Judge
  setP(75,'⚖️ Meta-Judge — מייעץ עם הזיכרון ומחליט...');
  _dbgUpdate('judge','🔄 שולף היסטוריה ומנתח...',null,false);

  var consensus=_calcConsensus(
    claudeResult?(claudeResult.score||50):null,
    gptResult?(gptResult.score||50):null,
    geminiResult?(geminiResult.score||50):null
  );

  var verdict=await _metaJudge(lead,claudeResult,gptResult,geminiResult,memory,{
    claudeEnv:claudeEnv,gptEnv:gptEnv,geminiEnv:geminiEnv,
    failedEngines:failedEngines,consensus:consensus
  });

  _dbgUpdate('judge','✅ '+((verdict._judgeMs||0)/1000).toFixed(1)+'s — ציון: '+(verdict.meta_score||'?'),verdict.meta_score,false);

  // שלב 5: שמירה
  setP(92,'💾 שומר ל-Firebase...');
  var logDocId=null;
  try{logDocId=await window.saveAnalysisLog(lead.id,lead.name,{claude:claudeResult,gpt:gptResult,gemini:geminiResult},verdict,proxyData);}catch(e){console.warn('[Brain] saveAnalysisLog:',e.message);}
  try{
    await window.saveBrainDecision({
      lead_id:lead.id,lead_name:lead.name,lead_segment:lead.segment||lead.type||'',
      platform:verdict.platform_verdict||lead.platform||'',
      claude_score:claudeResult?(claudeResult.score||50):null,claude_summary:claudeResult?(claudeResult.summary||''):null,
      gpt_score:gptResult?(gptResult.score||50):null,gpt_summary:gptResult?(gptResult.summary||''):null,
      gemini_score:geminiResult?(geminiResult.score||50):null,gemini_summary:geminiResult?(geminiResult.summary||''):null,
      meta_score:verdict.meta_score!=null?verdict.meta_score:null,
      meta_reasoning:verdict.meta_reasoning!=null?verdict.meta_reasoning:null,
      meta_action:verdict.meta_action!=null?verdict.meta_action:null,
      score_breakdown:verdict.score_breakdown||null,
      platform_verdict:verdict.platform_verdict||null,pain_verdict:verdict.pain_verdict||null,
      confidence:verdict.confidence||consensus.confidence,confidence_reason:verdict.confidence_reason||null,
      had_conflict:consensus.hadConflict,disagreements:verdict.disagreements||[],
      recommended_cadence:verdict.recommended_cadence||null,
      engine_statuses:{claude:claudeEnv.status,gpt:gptEnv.status,gemini:geminiEnv.status},
      engines_ok:successCount,log_doc_id:logDocId
    });
  }catch(e){console.warn('[Brain] saveBrainDecision:',e.message);}

  // שלב 6: תוצאה סופית
  var finalResult=Object.assign({},baseResult,{
    status:'done',enriched_at:new Date().toISOString(),
    triple_engine:true,engines_ok:successCount,engines_total:configuredCount,
    engine_statuses:{claude:claudeEnv.status,gpt:gptEnv.status,gemini:geminiEnv.status},
    log_doc_id:logDocId,
    // Meta-Judge overrides
    score:verdict.meta_score||baseResult.score||50,
    tier:verdict.final_tier||baseResult.tier||'B',
    summary:verdict.final_summary||baseResult.summary||'',
    executive_summary:verdict.meta_reasoning||baseResult.executive_summary||'',
    next_action:verdict.meta_action||baseResult.next_action||'',
    platform_current:verdict.platform_verdict||baseResult.platform_current||'',
    pain_points:(verdict.pain_verdict&&verdict.pain_verdict.length)?verdict.pain_verdict:(baseResult.pain_points||[]),
    // Meta-Judge fields
    meta_score:verdict.meta_score!=null?verdict.meta_score:null,
    meta_reasoning:verdict.meta_reasoning!=null?verdict.meta_reasoning:null,
    meta_action:verdict.meta_action!=null?verdict.meta_action:null,
    meta_score_breakdown:verdict.score_breakdown||null,
    platform_verdict:verdict.platform_verdict||null,
    pain_verdict:verdict.pain_verdict||null,
    killer_combo:verdict.killer_combo||false,
    killer_combo_explanation:verdict.killer_combo_explanation||null,
    roi_pitch:verdict.roi_pitch||null,
    next_event_urgency:verdict.next_event_urgency||null,
    recommended_cadence:verdict.recommended_cadence||baseResult.recommended_cadence||'warm',
    opening_line:verdict.opening_line||null,
    pitch_angle:verdict.pitch_angle||'ROI',
    blast_potential:verdict.blast_potential||null,
    discovery_questions:verdict.discovery_questions||baseResult.discovery_questions||[],
    objection_handler:verdict.objection_handler||null,
    risk_factors:verdict.risk_factors||[],
    social_proof:verdict.social_proof||null,
    marketing_insight:verdict.marketing_insight||null,
    rep_summary:verdict.rep_summary||null,
    firebase_context:verdict.firebase_context||null,
    confidence_reason:verdict.confidence_reason||null,
    disagreements:verdict.disagreements||[],
    confidence:verdict.confidence||consensus.confidence,
    had_conflict:consensus.hadConflict,
    // Per-engine
    claude_score:claudeResult?claudeResult.score:null,
    gpt_score:gptResult?gptResult.score:null,
    gemini_score:geminiResult?geminiResult.score:null,
    claude_data:claudeResult||null,gpt_data:gptResult||null,gemini_data:geminiResult||null,
    // GPT money
    ticket_prices:gptResult?(gptResult.ticket_prices||null):null,
    revenue_intel:gptResult?(gptResult.revenue_intel||null):null,
    event_volume:gptResult?(gptResult.event_volume||null):null,
    next_event:gptResult?(gptResult.next_event||null):null,
    audience_size:gptResult?(gptResult.audience_size||null):null,
    roi_calculation:gptResult?(gptResult.roi_calculation||null):null,
    // Gemini intel
    competitor_domains:geminiResult?(geminiResult.competitor_domains||null):null,
    marketing:geminiResult?(geminiResult.marketing||null):null,
    social_selling:geminiResult?(geminiResult.social_selling||null):null,
    social_platforms:geminiResult?(geminiResult.social_platforms||null):null,
    page_analysis:geminiResult?(geminiResult.page_analysis||null):null,
    traffic:geminiResult?(geminiResult.traffic||null):null,
    lead_competitors:geminiResult?(geminiResult.lead_competitors||[]):[]
  });

  // Debug panel summary
  (function(){
    var panel=document.getElementById('_triple_debug_panel');
    if(!panel)return;
    if(panel._dbgTimer)clearInterval(panel._dbgTimer);
    var el=document.getElementById('_dbg_elapsed');
    var tEl=document.getElementById('_dbg_timing');
    if(tEl&&el)tEl.innerHTML=(successCount<configuredCount?'<span style="color:#F59E0B">⚠️ '+successCount+'/'+configuredCount+'</span> — ':'✅ ')+'הושלם ב-<strong style="color:#a78bfa">'+el.textContent+'s</strong>';
    var sum=document.createElement('div');
    sum.style.cssText='margin-top:8px;padding:8px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;text-align:center';
    var s=finalResult.score||'?';
    var sc=s>=80?'#10b981':s>=60?'#F59E0B':'#ef4444';
    sum.innerHTML='<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">ציון סופי (Meta-Judge)</div>'+
      '<div style="font-size:26px;font-weight:900;color:'+sc+'">'+s+'</div>'+
      (finalResult.tier?'<div style="font-size:11px;color:rgba(255,255,255,0.5)">Tier '+finalResult.tier+'</div>':'')+
      (finalResult.killer_combo?'<div style="font-size:11px;color:#f59e0b;margin-top:4px">⚡ Killer Combo</div>':'');
    panel.appendChild(sum);
    setTimeout(function(){panel.style.transition='opacity 0.8s ease';panel.style.opacity='0';setTimeout(function(){if(panel.parentNode)panel.parentNode.removeChild(panel);},800);},8000);
  })();

  // Deep pipeline async
  setP(100,'✅ ניתוח הושלם — מעשיר אסטרטגיה + מיילים...');
  (function(){
    setTimeout(async function(){
      try{
        var deepResult=await window._deepAIPipeline(lead);
        var enriched=Object.assign({},deepResult,{
          score:finalResult.score,tier:finalResult.tier,summary:finalResult.summary,
          executive_summary:finalResult.executive_summary,next_action:finalResult.next_action,
          platform_current:finalResult.platform_current,pain_points:finalResult.pain_points,
          status:'done',triple_engine:true,
          meta_score:finalResult.meta_score,meta_reasoning:finalResult.meta_reasoning,
          meta_score_breakdown:finalResult.meta_score_breakdown,
          killer_combo:finalResult.killer_combo,killer_combo_explanation:finalResult.killer_combo_explanation,
          roi_pitch:finalResult.roi_pitch,rep_summary:finalResult.rep_summary,
          firebase_context:finalResult.firebase_context,opening_line:finalResult.opening_line,
          discovery_questions:finalResult.discovery_questions,
          engines_ok:finalResult.engines_ok,engines_total:finalResult.engines_total,
          engine_statuses:finalResult.engine_statuses,
          claude_data:finalResult.claude_data,gpt_data:finalResult.gpt_data,gemini_data:finalResult.gemini_data,
          ticket_prices:finalResult.ticket_prices,revenue_intel:finalResult.revenue_intel,
          roi_calculation:finalResult.roi_calculation,next_event:finalResult.next_event,
          audience_size:finalResult.audience_size,competitor_domains:finalResult.competitor_domains,
          social_platforms:finalResult.social_platforms,marketing:finalResult.marketing
        });
        lead.ai_analysis=enriched;
        var idx=leads.findIndex(function(l){return l.id===lead.id;});
        if(idx!==-1)leads[idx]=lead;
        if(typeof db!=='undefined'&&db)db.collection('leads').doc(String(lead.id)).set(window._cleanForFirebase(lead)).catch(function(){});
        renderSimpleLead(lead);
        var bdy=document.getElementById('body-'+lead.id);
        if(bdy&&bdy.classList.contains('open')){var tabs=document.querySelectorAll('#lead-'+lead.id+' .lead-tab');if(tabs[1])switchLeadTab(lead.id,'analysis',tabs[1]);}
      }catch(e){console.warn('[Brain] Deep enrich failed:',e.message);}
    },300);
  })();

  return finalResult;
};

// ════════════════════════════════════════════════════════════════
//  DEEP PIPELINE — אסטרטגיה + מיילים (async)
// ════════════════════════════════════════════════════════════════

window._deepAIPipeline = async function(lead) {
  var domain=(lead.domain||'').replace(/https?:\/\//,'').split('/')[0]||lead.name;
  var compInfo='';
  try{compInfo=Object.values(competitorData||{}).map(function(c){return c.name+': '+c.weakness;}).join('\n');}catch(e){}
  var METH=await ensureMethodologyInFirebase();

  function setP(pct,msg){
    var bar=document.getElementById('analysis-bar-'+lead.id);
    var txt=document.getElementById('analysis-progress-'+lead.id);
    if(bar)bar.style.width=pct+'%';if(txt)txt.textContent=msg;
    var gPct=Math.round(((_aq&&_aq.done||0)/(_aq&&_aq.total||1))*100);
    _pbUpdate(Math.round(gPct*0.7+pct*0.3),msg.substring(0,35),lead);
  }

  setP(5,'🧠 Claude — מחקר + אסטרטגיה...');
  var proxy=null;
  try{var pr=await window._authFetch(SERVER+'/analyze?url='+encodeURIComponent('https://'+domain),{signal:AbortSignal.timeout(7000)});if(pr.ok)proxy=await pr.json();}catch(e){}
  var pCtx=proxy?'פלטפורמה='+(proxy.ticketPlatform||'?')+', מייל='+(proxy.email||'?')+', טלפון='+(proxy.phone||'?'):'לא נמצא';

  setP(15,'🧠 Claude — ניתוח + אסטרטגיה...');
  var pA=await _callAI(
    'אתה חוקר B2B ומנהל מכירות בכיר ב-XTIX.AI. JSON נקי בלבד. עברית.',
    'נתח:\nשם: '+lead.name+' | דומיין: '+domain+'\nמידע: '+pCtx+'\nמתחרים: '+compInfo+
    '\n\nJSON: {summary,executive_summary,segment,platform_current,platform_weakness,competitors_used,target_audience,events_per_year,venue_size,ticket_price_range,estimated_annual_tickets,estimated_annual_revenue,estimated_annual_fees,estimated_xtix_savings,pain_points,social_intel,pricing_intel,address,raw_research,sales_attack,pitch_angle,pitch,meeting_prep,discovery_questions,next_action,objection_handlers}',
    2500,TIMEOUT_DEEP);

  setP(55,'🧠 Claude — מתודולוגיה...');
  var cadenceDays={'hot':[1,3,7,14],'cool':[1,7,21,45],'warm':[1,5,12,25]};
  var pB1=await _callAI(
    'יועץ מכירות בכיר. JSON נקי בלבד. עברית.',
    'נתח מתודולוגיה:\n'+lead.name+'\nכאבים: '+(pA.pain_points||[]).join(', ')+'\nפלטפורמה: '+(pA.platform_current||'?')+
    '\n\nJSON: {score,tier,recommended_cadence,scoring_breakdown,four_fs,salesforce_bps,attack_angle,best_opening,risk_factors,summary_for_rep}',
    1200,TIMEOUT_DEEP);

  setP(80,'🧠 Claude — מיילים...');
  var cadence=pB1.recommended_cadence||'warm';
  var days=cadenceDays[cadence]||cadenceDays['warm'];
  var pB2={email_sequence:[]};
  try{
    pB2=await window._callAIFast(
      'מומחה מכירות XTIX. 4 מיילים ספציפיים. JSON בלבד. עברית.',
      '4 מיילים ל-'+lead.name+' | ימים: '+days.join('→')+' | Cadence: '+cadence+
      '\nכאבים: '+(pA.pain_points||[]).join(', ')+'\nROI: '+(pA.estimated_xtix_savings||'?')+
      '\n\n{"email_sequence":[{"email_num":1,"day":'+days[0]+',"type":"curiosity","subject":"","body":"","cta":""},{"email_num":2,"day":'+days[1]+',"type":"roi","subject":"","body":"","cta":""},{"email_num":3,"day":'+days[2]+',"type":"social_proof","subject":"","body":"","cta":""},{"email_num":4,"day":'+days[3]+',"type":"breakup","subject":"","body":"","cta":""}]}',
      1400,40000);
  }catch(e){console.warn('[Brain] Email failed:',e.message);}

  setP(97,'💾 שומר...');
  var sc=parseInt(pB1.score)||55;
  return {
    status:'done',enriched_at:new Date().toISOString(),
    summary:pA.summary||'',executive_summary:pA.executive_summary||'',
    segment:pA.segment||lead.type||'',platform_current:pA.platform_current||lead.platform||'',
    platform_weakness:pA.platform_weakness||'',competitors_used:pA.competitors_used||[],
    target_audience:pA.target_audience||'',events_per_year:pA.events_per_year||'',
    venue_size:pA.venue_size||'',ticket_price_range:pA.ticket_price_range||'',
    estimated_annual_tickets:pA.estimated_annual_tickets||'',estimated_annual_revenue:pA.estimated_annual_revenue||'',
    estimated_annual_fees:pA.estimated_annual_fees||'',estimated_xtix_savings:pA.estimated_xtix_savings||'',
    pain_points:pA.pain_points||[],social_intel:pA.social_intel||'',
    pricing_intel:pA.pricing_intel||'',address:pA.address||lead.address||'',
    raw_research:pA.raw_research||'',sales_attack:pA.sales_attack||'',
    pitch_angle:pA.pitch_angle||'ROI',pitch:pA.pitch||'',
    meeting_prep:pA.meeting_prep||'',discovery_questions:pA.discovery_questions||[],
    next_action:pA.next_action||'',objection_handlers:pA.objection_handlers||{},
    score:sc,tier:pB1.tier||(sc>=80?'A':sc>=60?'B':'C'),
    recommended_cadence:pB1.recommended_cadence||'warm',
    scoring_breakdown:pB1.scoring_breakdown||{},four_fs:pB1.four_fs||{},
    salesforce_bps:pB1.salesforce_bps||{},attack_angle:pB1.attack_angle||'',
    best_opening:pB1.best_opening||'',risk_factors:pB1.risk_factors||[],
    summary_for_rep:pB1.summary_for_rep||'',email_sequence:pB2.email_sequence||[],
    internal_summary:(pB1.summary_for_rep||pA.executive_summary||'')+(pA.next_action?'\n\nהצעד הבא: '+pA.next_action:'')
  };
};

})();
