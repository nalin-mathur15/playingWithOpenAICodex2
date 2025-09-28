const SESSION_STORAGE = (chrome.storage && (chrome.storage.session || chrome.storage.local)) || null;
const aiRoot = (typeof self !== 'undefined' && self.ai) ? self.ai : (typeof chrome !== 'undefined' && chrome.ai ? chrome.ai : null);

const stateCache = new Map();

const DEFAULT_STATE = () => ({
  detected: false,
  detection: null,
  scanning: false,
  analysis: null,
  error: null,
  lastScannedAt: null,
  lastUpdated: Date.now()
});

function stateKey(tabId) {
  return `policy-state:${tabId}`;
}

async function readState(tabId) {
  if (stateCache.has(tabId)) {
    return stateCache.get(tabId);
  }
  if (!SESSION_STORAGE) {
    const fresh = DEFAULT_STATE();
    stateCache.set(tabId, fresh);
    return fresh;
  }
  try {
    const raw = await SESSION_STORAGE.get(stateKey(tabId));
    const value = raw[stateKey(tabId)] || DEFAULT_STATE();
    stateCache.set(tabId, value);
    return value;
  } catch (error) {
    console.warn('Policy Guardian: failed to read state', error);
    const fallback = DEFAULT_STATE();
    stateCache.set(tabId, fallback);
    return fallback;
  }
}

async function writeState(tabId, state) {
  stateCache.set(tabId, state);
  if (!SESSION_STORAGE) {
    return;
  }
  try {
    await SESSION_STORAGE.set({ [stateKey(tabId)]: state });
  } catch (error) {
    console.warn('Policy Guardian: failed to persist state', error);
  }
}

async function updateState(tabId, updates) {
  const current = await readState(tabId);
  const next = { ...current, ...updates, lastUpdated: Date.now() };
  await writeState(tabId, next);
  return next;
}

async function clearState(tabId) {
  stateCache.delete(tabId);
  if (SESSION_STORAGE) {
    try {
      await SESSION_STORAGE.remove(stateKey(tabId));
    } catch (error) {
      console.warn('Policy Guardian: failed to remove state', error);
    }
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch (error) {
  }
}

async function broadcast(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
  }
}

async function ensureBadge(tabId, detection) {
  const text = detection ? (detection.pageType === 'privacy-policy' ? 'PP' : 'TOS') : '';
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6750A4' });
    await chrome.action.setBadgeText({ tabId, text });
  } catch (error) {
    console.debug('Policy Guardian: unable to update badge', error);
  }
}

function truncateForModel(text, maxLength = 24000) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function summarizerResultToString(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (typeof result.summary === 'string') return result.summary;
  if (Array.isArray(result.points)) {
    return result.points.join('\n');
  }
  if (typeof result.text === 'string') return result.text;
  return null;
}

function wordCount(text) {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function trimToWordLimit(text, limit = 300) {
  if (!text) return '';
  if (!limit || limit <= 0) return '';
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= limit) {
    return words.join(' ');
  }
  const trimmed = words.slice(0, limit).join(' ');
  return `${trimmed}…`;
}

async function tryCreatePromptSession(systemPrompt) {
  if (!aiRoot || !aiRoot.languageModel || typeof aiRoot.languageModel.create !== 'function') {
    return null;
  }
  try {
    return await aiRoot.languageModel.create({
      systemPrompt,
      temperature: 0.2,
      topK: 40,
      topP: 0.95
    });
  } catch (error) {
    console.warn('Policy Guardian: failed to create language model session', error);
    return null;
  }
}

function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (error) {
    console.warn('Policy Guardian: unable to parse JSON from model response');
    return null;
  }
}

async function runSummarizer(text, maxWords = 300) {
  if (!aiRoot || !aiRoot.summarizer || typeof aiRoot.summarizer.create !== 'function') {
    return null;
  }
  try {
    let summarizer = null;
    try {
      summarizer = await aiRoot.summarizer.create({ type: 'paragraph' });
    } catch (primaryError) {
      console.debug('Policy Guardian: paragraph summarizer unavailable', primaryError);
    }
    if (!summarizer) {
      try {
        summarizer = await aiRoot.summarizer.create({ type: 'key-points' });
      } catch (fallbackError) {
        console.warn('Policy Guardian: unable to create summarizer', fallbackError);
        return null;
      }
    }
    const result = await summarizer.summarize(text);
    let summary = summarizerResultToString(result);
    if (!summary) return null;
    summary = summary.trim();

    if (wordCount(summary) > maxWords) {
      try {
        const shortSummarizer = await aiRoot.summarizer.create({ type: 'key-points' });
        const shorterResult = await shortSummarizer.summarize(summary);
        const shorter = summarizerResultToString(shorterResult);
        if (shorter) {
          summary = shorter.trim();
        }
      } catch (error) {
        console.debug('Policy Guardian: secondary summarizer attempt failed', error);
      }
    }

    if (wordCount(summary) > maxWords) {
      summary = trimToWordLimit(summary, maxWords);
    }

    return summary;
  } catch (error) {
    console.warn('Policy Guardian: summarizer failed', error);
    return null;
  }
}

const FALLBACK_RISK_MATRIX = [
  {
    category: 'Data Collection',
    keywords: ['collect', 'information you provide', 'personal information', 'metadata', 'usage data'],
    baseline: 2
  },
  {
    category: 'Data Sharing & Selling',
    keywords: ['share', 'third party', 'sell', 'broker', 'affiliate', 'advertising partner'],
    baseline: 1
  },
  {
    category: 'Tracking & Analytics',
    keywords: ['cookies', 'tracking', 'analytics', 'beacon', 'pixels'],
    baseline: 1
  },
  {
    category: 'Dispute Resolution',
    keywords: ['arbitration', 'waive', 'class action', 'indemnify', 'liability'],
    baseline: 1
  },
  {
    category: 'Account & Cancellation',
    keywords: ['automatic renewal', 'termination', 'cancel', 'non-refundable', 'perpetual'],
    baseline: 1
  }
];

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function pickSuspiciousClauses(text, limit = 8) {
  const paragraphs = splitParagraphs(text);
  const flags = [
    { keyword: 'perpetual', reason: 'Grants the company perpetual rights', baseScore: 3 },
    { keyword: 'irrevocable', reason: 'Irrevocable license or consent', baseScore: 3 },
    { keyword: 'binding arbitration', reason: 'Forces binding arbitration for disputes', baseScore: 4 },
    { keyword: 'class action', reason: 'Waives class action rights', baseScore: 4 },
    { keyword: 'sell', reason: 'Allows selling personal data', baseScore: 4 },
    { keyword: 'third party', reason: 'Shares data with third parties', baseScore: 3 },
    { keyword: 'tracking', reason: 'Enables extensive tracking', baseScore: 2 },
    { keyword: 'consent to share', reason: 'Implied consent to share data broadly', baseScore: 3 },
    { keyword: 'indemnif', reason: 'Requires users to indemnify the company', baseScore: 4 },
    { keyword: 'waive', reason: 'Waives important legal rights', baseScore: 3 }
  ];

  const suspicious = [];

  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase();
    for (const flag of flags) {
      if (lower.includes(flag.keyword)) {
        suspicious.push({
          excerpt: paragraph.slice(0, 400),
          reason: flag.reason,
          riskScore: Math.min(5, flag.baseScore + (paragraph.length > 500 ? 1 : 0))
        });
        break;
      }
    }
    if (suspicious.length >= limit) break;
  }
  return suspicious;
}

function computeFallbackHeatmap(text) {
  const lowerText = text.toLowerCase();
  return FALLBACK_RISK_MATRIX.map((entry) => {
    let score = entry.baseline;
    for (const keyword of entry.keywords) {
      if (lowerText.includes(keyword)) {
        score += 1;
      }
    }
    return {
      category: entry.category,
      riskLevel: Math.max(1, Math.min(5, score)),
      evidence: entry.keywords.filter((kw) => lowerText.includes(kw))
    };
  });
}

function describeRiskLevel(score) {
  if (score >= 4.5) return 'critical';
  if (score >= 4) return 'high';
  if (score >= 3) return 'elevated';
  if (score >= 2) return 'moderate';
  return 'low';
}

function buildAnalysisDigest(analysis, pageType) {
  const typeLabel = pageType === 'privacy-policy' ? 'privacy policy' : 'terms of service';
  const heatmap = Array.isArray(analysis.riskHeatmap) ? analysis.riskHeatmap : [];
  const clauses = Array.isArray(analysis.suspiciousClauses) ? analysis.suspiciousClauses : [];

  const normalizedHeatmap = heatmap
    .map((entry) => ({
      category: entry.category || 'Unnamed category',
      riskLevel: Math.max(0, Math.min(5, Number(entry.riskLevel) || 0)),
      evidence: Array.isArray(entry.evidence)
        ? entry.evidence.filter(Boolean).join(', ')
        : (entry.evidence || '')
    }))
    .sort((a, b) => b.riskLevel - a.riskLevel);

  const averageRisk = normalizedHeatmap.length
    ? normalizedHeatmap.reduce((sum, item) => sum + item.riskLevel, 0) / normalizedHeatmap.length
    : 0;
  const overallDescriptor = describeRiskLevel(averageRisk);

  const highRiskCategories = normalizedHeatmap.filter((entry) => entry.riskLevel >= 4);
  const mediumRiskCategories = normalizedHeatmap.filter(
    (entry) => entry.riskLevel >= 3 && entry.riskLevel < 4
  );

  const heatmapHighlights = [];
  heatmapHighlights.push(
    `Overall risk trend: ${overallDescriptor} (average ${(averageRisk || 0).toFixed(1)} out of 5 across ${normalizedHeatmap.length} categories).`
  );
  if (highRiskCategories.length > 0) {
    const list = highRiskCategories
      .map((entry) => `${entry.category} (${entry.riskLevel.toFixed(1)}/5${entry.evidence ? `; evidence: ${entry.evidence}` : ''})`)
      .join('; ');
    heatmapHighlights.push(`Highest risk categories: ${list}.`);
  }
  if (mediumRiskCategories.length > 0) {
    const list = mediumRiskCategories
      .map((entry) => `${entry.category} (${entry.riskLevel.toFixed(1)}/5${entry.evidence ? `; evidence: ${entry.evidence}` : ''})`)
      .join('; ');
    heatmapHighlights.push(`Elevated attention suggested for: ${list}.`);
  }
  if (heatmapHighlights.length === 1) {
    heatmapHighlights.push('No categories exceeded the medium-risk threshold.');
  }

  const clauseSummaries = [];
  const topClauses = clauses.slice(0, 5);
  if (topClauses.length === 0) {
    clauseSummaries.push('No suspicious clauses were detected in this scan.');
  } else {
    topClauses.forEach((clause, index) => {
      const rank = index + 1;
      const risk = Math.max(1, Math.min(5, Number(clause.riskScore) || 1));
      const label = describeRiskLevel(risk);
      const reason = clause.reason ? clause.reason.trim() : '';
      const plain = clause.plainLanguage ? clause.plainLanguage.trim() : '';
      const excerpt = clause.excerpt ? clause.excerpt.trim().replace(/\s+/g, ' ') : '';
      const explanation = plain || reason || excerpt || 'Potential area of concern';
      clauseSummaries.push(`Clause ${rank} (${label} risk ${risk}/5): ${explanation}`);
    });
    if (clauses.length > topClauses.length) {
      clauseSummaries.push(
        `${clauses.length - topClauses.length} additional clause${
          clauses.length - topClauses.length === 1 ? '' : 's'
        } flagged with lower priority.`
      );
    }
  }

  const digestSections = [
    `Policy Guardian analysis for this ${typeLabel}.`,
    ...heatmapHighlights,
    `Suspicious clause review (${clauses.length} flagged):`,
    ...clauseSummaries
  ];

  return trimToWordLimit(digestSections.join('\n'), 600);
}

async function generateAnalysisSummary(analysis, pageType) {
  try {
    const digest = buildAnalysisDigest(analysis, pageType);
    const aiSummary = await runSummarizer(digest, 300);
    if (aiSummary) {
      return aiSummary.trim();
    }
    return trimToWordLimit(digest, 300);
  } catch (error) {
    console.debug('Policy Guardian: failed to summarize analysis digest', error);
    const digest = buildAnalysisDigest(analysis, pageType);
    return trimToWordLimit(digest, 300);
  }
}

async function fallbackAnalysis(pageText) {
  const suspiciousClauses = pickSuspiciousClauses(pageText);
  const riskHeatmap = computeFallbackHeatmap(pageText);
  return {
    suspiciousClauses,
    riskHeatmap
  };
}

async function analyzeWithPromptAPI(pageText, pageType) {
  const systemPrompt = `You are an expert legal analyst that evaluates website ${pageType} for risky clauses. Respond using strict JSON.`;
  const session = await tryCreatePromptSession(systemPrompt);
  if (!session) return null;
  const prompt = [
    `Evaluate the following ${pageType}.`,
    'Return JSON with the following shape:',
    '{',
    '  "summary": string,',
    '  "suspiciousClauses": [',
    '    { "excerpt": string, "reason": string, "riskScore": number }',
    '  ],',
    '  "riskHeatmap": [',
    '    { "category": string, "riskLevel": number, "evidence": string }',
    '  ]',
    '}',
    'Ensure riskLevel is between 1 (low) and 5 (critical).',
    'Focus on privacy, sharing, arbitration, consent, cancellation, and tracking risks.',
    'Text to review:',
    pageText
  ].join('\n');

  try {
    const response = await session.prompt(prompt);
    const parsed = extractJson(response);
    if (!parsed) return null;
    if (!Array.isArray(parsed.suspiciousClauses)) {
      parsed.suspiciousClauses = [];
    }
    if (!Array.isArray(parsed.riskHeatmap)) {
      parsed.riskHeatmap = [];
    }
    return parsed;
  } catch (error) {
    console.warn('Policy Guardian: prompt API analysis failed', error);
    return null;
  }
}

async function enrichClausesWithSummaries(clauses) {
  if (!clauses || clauses.length === 0) return clauses;
  if (!aiRoot || !aiRoot.rewriter || typeof aiRoot.rewriter.create !== 'function') {
    return clauses;
  }
  let rewriter;
  try {
    rewriter = await aiRoot.rewriter.create({ tone: 'cautious' });
  } catch (error) {
    console.warn('Policy Guardian: failed to create rewriter', error);
    return clauses;
  }
  const enhanced = [];
  for (const clause of clauses) {
    try {
      const result = await rewriter.rewrite({
        text: clause.excerpt,
        instruction: 'Explain this clause in plain language and why it might be risky. Limit to two sentences.'
      });
      if (result && Array.isArray(result.rewrites) && result.rewrites.length > 0) {
        enhanced.push({ ...clause, plainLanguage: result.rewrites[0].text });
      } else if (result && typeof result.text === 'string') {
        enhanced.push({ ...clause, plainLanguage: result.text });
      } else {
        enhanced.push(clause);
      }
    } catch (error) {
      enhanced.push(clause);
    }
  }
  return enhanced;
}

async function runPolicyAnalysis({ pageText, pageType }) {
  const truncated = truncateForModel(pageText);
  let analysis = await analyzeWithPromptAPI(truncated, pageType);

  if (!analysis) {
    analysis = await fallbackAnalysis(truncated);
  }

  if (!analysis || typeof analysis !== 'object') {
    analysis = {};
  }

  if (!analysis.riskHeatmap || analysis.riskHeatmap.length === 0) {
    analysis.riskHeatmap = computeFallbackHeatmap(truncated);
  } else {
    analysis.riskHeatmap = analysis.riskHeatmap.map((entry) => ({
      category: entry.category,
      riskLevel: Math.max(1, Math.min(5, Number(entry.riskLevel) || 1)),
      evidence: entry.evidence || ''
    }));
  }

  if (!analysis.suspiciousClauses || analysis.suspiciousClauses.length === 0) {
    analysis.suspiciousClauses = pickSuspiciousClauses(truncated);
  } else {
    analysis.suspiciousClauses = analysis.suspiciousClauses.map((entry) => ({
      excerpt: entry.excerpt || '',
      reason: entry.reason || '',
      riskScore: Math.max(1, Math.min(5, Number(entry.riskScore) || 1))
    }));
  }

  analysis.suspiciousClauses = await enrichClausesWithSummaries(analysis.suspiciousClauses);

  analysis.summary = await generateAnalysisSummary(analysis, pageType);

  return analysis;
}

async function requestPageContent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'collect-page-text' });
    return response || null;
  } catch (error) {
    console.warn('Policy Guardian: unable to collect page text', error);
    return null;
  }
}

async function startScan(tabId, pageType, origin) {
  if (typeof tabId !== 'number') return;
  const state = await updateState(tabId, {
    scanning: true,
    error: null
  });
  await broadcast({ type: 'scan-started', payload: { tabId, origin, state } });
  const pageContent = await requestPageContent(tabId);
  if (!pageContent || !pageContent.text) {
    await updateState(tabId, {
      scanning: false,
      error: 'Unable to read page content. Try refreshing the page and scanning again.'
    });
    await broadcast({ type: 'scan-error', payload: { tabId } });
    return;
  }
  const pageText = pageContent.text;
  const detectedType = pageType || (state.detection ? state.detection.pageType : 'policy');

  try {
    const analysis = await runPolicyAnalysis({ pageText, pageType: detectedType });
    const updatedState = await updateState(tabId, {
      scanning: false,
      analysis,
      lastScannedAt: Date.now()
    });
    await broadcast({
      type: 'scan-complete',
      payload: {
        tabId,
        analysis: updatedState.analysis,
        detection: updatedState.detection
      }
    });
  } catch (error) {
    console.error('Policy Guardian: analysis failed', error);
    await updateState(tabId, {
      scanning: false,
      error: 'Analysis failed. Please try again or reduce the amount of text on the page.'
    });
    await broadcast({ type: 'scan-error', payload: { tabId } });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = message.tabId || (sender && sender.tab && sender.tab.id);
    switch (message.type) {
      case 'policy-detected': {
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false });
          return;
        }
        const detection = {
          pageType: message.payload.pageType,
          confidence: message.payload.confidence,
          keywordMatches: message.payload.keywordMatches,
          contentLength: message.payload.contentLength,
          title: message.payload.title,
          url: message.payload.url,
          detectedAt: Date.now()
        };
        const next = await updateState(tabId, {
          detected: true,
          detection,
          error: null
        });
        await ensureBadge(tabId, detection);
        await broadcast({ type: 'policy-detected', payload: { tabId, detection: next.detection } });
        sendResponse({ ok: true });
        return;
      }
      case 'start-scan': {
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'Missing tab id' });
          return;
        }
        if (message.origin === 'content-widget' && chrome.action && chrome.action.openPopup) {
          try {
            await chrome.action.openPopup();
          } catch (error) {
            console.debug('Policy Guardian: unable to open popup automatically', error);
          }
        }
        startScan(tabId, message.pageType, message.origin || 'manual');
        sendResponse({ ok: true });
        return;
      }
      case 'get-state': {
        if (typeof tabId !== 'number') {
          sendResponse({ ok: false, error: 'Missing tab id' });
          return;
        }
        const state = await readState(tabId);
        sendResponse({ ok: true, state });
        return;
      }
      case 'clear-state': {
        if (typeof tabId === 'number') {
          await clearState(tabId);
        }
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    clearState(tabId);
  }
});
