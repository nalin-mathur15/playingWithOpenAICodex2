const params = new URLSearchParams(window.location.search);
const clauseTemplate = document.getElementById('clause-template');
const reportSubtitle = document.getElementById('reportSubtitle');
const reportTitle = document.getElementById('reportTitle');
const reportUrl = document.getElementById('reportUrl');
const reportDetection = document.getElementById('reportDetection');
const reportTimestamp = document.getElementById('reportTimestamp');
const reportAnalysisSection = document.getElementById('reportAnalysis');
const reportSummary = document.getElementById('reportSummary');
const reportHeatmap = document.getElementById('reportHeatmap');
const reportClauses = document.getElementById('reportClauses');
const reportClauseCount = document.getElementById('reportClauseCount');
const reportErrorSection = document.getElementById('reportErrors');
const reportErrorMessage = document.getElementById('reportErrorMessage');
const reportCopySummary = document.getElementById('reportCopySummary');
const reportRescanButton = document.getElementById('reportRescan');

let targetTabId = Number.parseInt(params.get('tab'), 10);
let currentState = null;
let currentSettings = { darkMode: false };

function ensureValidTabId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

targetTabId = ensureValidTabId(targetTabId);

function formatConfidence(confidence) {
  if (typeof confidence !== 'number') return 'Unknown confidence';
  return `${Math.round(confidence * 100)}% confidence`;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const delta = Date.now() - timestamp;
  if (delta < 1000 * 60) return 'moments ago';
  if (delta < 1000 * 60 * 60) {
    const minutes = Math.floor(delta / (1000 * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(delta / (1000 * 60 * 60));
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Not yet scanned';
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return 'Not yet scanned';
  }
}

function riskLabel(score) {
  if (score >= 4) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get('policyGuardianSettings');
    const settings = stored.policyGuardianSettings || {};
    return { darkMode: Boolean(settings.darkMode) };
  } catch (error) {
    console.debug('Policy Guardian report: unable to load settings', error);
    return { darkMode: false };
  }
}

function applyTheme(settings) {
  document.body.classList.toggle('dark', Boolean(settings.darkMode));
}

function renderHeatmap(heatmap) {
  reportHeatmap.innerHTML = '';
  if (!heatmap || heatmap.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No high-risk categories detected.';
    empty.className = 'heatmap__empty';
    reportHeatmap.appendChild(empty);
    return;
  }

  for (const entry of heatmap) {
    const row = document.createElement('div');
    row.className = 'heatmap__row';
    const severity = riskLabel(Number(entry.riskLevel) || 0);
    row.dataset.risk = String(Math.max(0, Math.min(5, Number(entry.riskLevel) || 0)));
    row.dataset.severity = severity;
    const label = document.createElement('div');
    label.className = 'heatmap__label';
    label.textContent = entry.category;
    const bars = document.createElement('div');
    bars.className = 'heatmap__bars';
    bars.dataset.severity = severity;
    for (let i = 1; i <= 5; i += 1) {
      const span = document.createElement('span');
      if (i <= entry.riskLevel) {
        span.classList.add('active');
      }
      bars.appendChild(span);
    }
    const evidence = document.createElement('div');
    evidence.className = 'heatmap__evidence';
    evidence.textContent = Array.isArray(entry.evidence)
      ? entry.evidence.join(', ')
      : entry.evidence || '';
    row.appendChild(label);
    row.appendChild(bars);
    row.appendChild(evidence);
    reportHeatmap.appendChild(row);
  }
}

function renderClauses(clauses) {
  reportClauses.innerHTML = '';
  if (!clauses || clauses.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No suspicious clauses were flagged.';
    empty.className = 'clause clause--empty';
    reportClauses.appendChild(empty);
    reportClauseCount.textContent = '0 clauses';
    return;
  }

  reportClauseCount.textContent = `${clauses.length} clause${clauses.length === 1 ? '' : 's'}`;

  for (const clause of clauses) {
    const fragment = clauseTemplate.content.cloneNode(true);
    const li = fragment.querySelector('.clause');
    const score = fragment.querySelector('.clause__score');
    const scoreValue = fragment.querySelector('.clause__score-value');
    const scoreLabel = fragment.querySelector('.clause__score-label');
    const excerpt = fragment.querySelector('.clause__excerpt');
    const reason = fragment.querySelector('.clause__reason');
    const plain = fragment.querySelector('.clause__plain');

    const scoreValueNumber = Math.max(1, Math.min(5, Math.round(Number(clause.riskScore) || 1)));
    const label = riskLabel(scoreValueNumber);
    li.dataset.severity = label;
    score.dataset.score = label;
    scoreValue.textContent = scoreValueNumber.toString();
    scoreLabel.textContent = `${label} risk`;
    excerpt.textContent = clause.excerpt || 'No excerpt available.';
    reason.textContent = clause.reason || 'No rationale provided.';
    if (clause.plainLanguage) {
      plain.hidden = false;
      plain.textContent = clause.plainLanguage;
    }

    reportClauses.appendChild(fragment);
  }
}

function updateDetectionDetails(state) {
  const detection = state.detection;
  const scanning = state.scanning;
  const analysisReady = Boolean(state.analysis);

  if (scanning) {
    reportSubtitle.textContent = 'Scanning with built-in AI…';
  } else if (analysisReady) {
    reportSubtitle.textContent = `Last scanned ${formatTimeAgo(state.lastScannedAt)}.`;
  } else {
    reportSubtitle.textContent = 'Detailed scan overview';
  }

  if (detection) {
    reportTitle.textContent = detection.title || 'Untitled page';
    reportUrl.textContent = detection.url || 'View original page';
    if (detection.url) {
      reportUrl.href = detection.url;
    } else {
      reportUrl.removeAttribute('href');
    }
    const pageLabel = detection.pageType === 'privacy-policy' ? 'Privacy policy' : 'Terms of service';
    const parts = [pageLabel, formatConfidence(detection.confidence)];
    reportDetection.textContent = parts.join(' • ');
  } else {
    reportTitle.textContent = 'Waiting for detection';
    reportUrl.textContent = 'Open original page';
    reportUrl.removeAttribute('href');
    reportDetection.textContent = 'No policy detected yet';
  }

  reportTimestamp.textContent = formatTimestamp(state.lastScannedAt);
}

function updateAnalysis(state) {
  const analysis = state.analysis;
  if (!analysis) {
    reportAnalysisSection.hidden = true;
    return;
  }

  reportAnalysisSection.hidden = false;
  reportSummary.textContent = analysis.summary || 'No summary generated.';
  renderHeatmap(analysis.riskHeatmap);
  renderClauses(analysis.suspiciousClauses);
}

function updateError(state) {
  if (state.error) {
    reportErrorSection.hidden = false;
    reportErrorMessage.textContent = state.error;
  } else {
    reportErrorSection.hidden = true;
    reportErrorMessage.textContent = '';
  }
}

async function requestState(tabId) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-state', tabId });
    if (response && response.ok) {
      return response.state;
    }
  } catch (error) {
    console.warn('Policy Guardian report failed to fetch state', error);
  }
  return null;
}

async function ensureTabId() {
  if (targetTabId != null) {
    return targetTabId;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      targetTabId = tab.id;
      return targetTabId;
    }
  } catch (error) {
    console.warn('Policy Guardian report failed to resolve tab id', error);
  }
  return null;
}

async function startScan() {
  const tabId = await ensureTabId();
  if (tabId == null) {
    reportErrorSection.hidden = false;
    reportErrorMessage.textContent = 'Unable to determine which tab to scan.';
    return;
  }
  reportSubtitle.textContent = 'Starting scan…';
  try {
    await chrome.runtime.sendMessage({ type: 'start-scan', tabId, origin: 'report' });
  } catch (error) {
    reportErrorSection.hidden = false;
    reportErrorMessage.textContent = 'Failed to start scan. Try again from the popup.';
  }
}

function applyState(state) {
  if (!state) return;
  currentState = state;
  updateDetectionDetails(state);
  updateAnalysis(state);
  updateError(state);
}

async function initialize() {
  currentSettings = await loadSettings();
  applyTheme(currentSettings);

  const tabId = await ensureTabId();
  if (tabId == null) {
    reportErrorSection.hidden = false;
    reportErrorMessage.textContent = 'Open this report from the popup after scanning a page to view details.';
    reportRescanButton.disabled = true;
    reportCopySummary.disabled = true;
    return;
  }

  const state = await requestState(tabId);
  if (state) {
    applyState(state);
  } else {
    reportDetection.textContent = 'No scan data yet';
  }
}

if (reportCopySummary) {
  reportCopySummary.addEventListener('click', async () => {
    if (!currentState || !currentState.analysis || !currentState.analysis.summary) return;
    try {
      await navigator.clipboard.writeText(currentState.analysis.summary);
      reportCopySummary.textContent = 'Copied!';
      setTimeout(() => {
        reportCopySummary.textContent = 'Copy summary';
      }, 1600);
    } catch (error) {
      reportCopySummary.textContent = 'Copy failed';
      setTimeout(() => {
        reportCopySummary.textContent = 'Copy summary';
      }, 1600);
    }
  });
}

if (reportRescanButton) {
  reportRescanButton.addEventListener('click', () => {
    startScan();
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.payload) return;
  if (targetTabId == null || message.payload.tabId !== targetTabId) return;
  switch (message.type) {
    case 'policy-detected':
    case 'scan-started':
    case 'scan-complete':
    case 'scan-error': {
      requestState(targetTabId).then(applyState);
      break;
    }
    default:
      break;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.policyGuardianSettings) {
    currentSettings = {
      darkMode: Boolean(changes.policyGuardianSettings.newValue?.darkMode)
    };
    applyTheme(currentSettings);
  }
});

initialize();
