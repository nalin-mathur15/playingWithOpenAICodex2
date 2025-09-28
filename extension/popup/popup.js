const statusLabel = document.getElementById('statusLabel');
const statusMeta = document.getElementById('statusMeta');
const scanButton = document.getElementById('scanButton');
const rescanButton = document.getElementById('rescanButton');
const summaryEl = document.getElementById('summary');
const analysisSection = document.getElementById('analysis');
const heatmapContainer = document.getElementById('heatmapContainer');
const clausesList = document.getElementById('clausesList');
const clauseCount = document.getElementById('clauseCount');
const errorSection = document.getElementById('errors');
const errorMessage = document.getElementById('errorMessage');
const copySummaryButton = document.getElementById('copySummary');
const clauseTemplate = document.getElementById('clause-template');
const settingsToggle = document.getElementById('settingsToggle');
const settingsCard = document.getElementById('settingsCard');
const darkModeToggle = document.getElementById('darkModeToggle');
const openReportButton = document.getElementById('openReport');

let currentTabId = null;
let currentState = null;
let currentSettings = { darkMode: false };

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get('policyGuardianSettings');
    const settings = stored.policyGuardianSettings || {};
    return { darkMode: Boolean(settings.darkMode) };
  } catch (error) {
    console.debug('Policy Guardian: unable to load settings', error);
    return { darkMode: false };
  }
}

async function persistSettings(settings) {
  try {
    await chrome.storage.local.set({ policyGuardianSettings: settings });
  } catch (error) {
    console.debug('Policy Guardian: unable to save settings', error);
  }
}

function applyTheme(settings) {
  document.body.classList.toggle('dark', Boolean(settings.darkMode));
}

async function updateSettings(partial) {
  currentSettings = { ...currentSettings, ...partial };
  applyTheme(currentSettings);
  await persistSettings(currentSettings);
}

function formatConfidence(confidence) {
  if (typeof confidence !== 'number') return 'Unknown confidence';
  return `${Math.round(confidence * 100)}% confidence`;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const delta = Date.now() - timestamp;
  if (delta < 1000 * 60) return 'just now';
  if (delta < 1000 * 60 * 60) {
    const minutes = Math.floor(delta / (1000 * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(delta / (1000 * 60 * 60));
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function riskLabel(score) {
  if (score >= 4) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function updateStatus(state) {
  const { detected, detection, scanning, analysis, error } = state;
  if (scanning) {
    statusLabel.textContent = 'Scanning with built-in AI…';
    statusMeta.textContent = 'This may take a few seconds on longer documents.';
    scanButton.disabled = true;
    rescanButton.disabled = true;
    return;
  }

  scanButton.disabled = false;
  rescanButton.disabled = !analysis;

  if (error) {
    statusLabel.textContent = 'Scan failed';
    statusMeta.textContent = 'Try scanning again or simplify the page content.';
    return;
  }

  if (!detected) {
    statusLabel.textContent = 'No policy detected yet';
    statusMeta.textContent = 'Use the Scan button to analyze the current page manually.';
    return;
  }

  const label = detection.pageType === 'privacy-policy' ? 'Privacy policy detected' : 'Terms of service detected';
  statusLabel.textContent = label;
  const parts = [formatConfidence(detection.confidence)];
  if (analysis && analysis.summary) {
    parts.push(`Last scanned ${formatTimeAgo(state.lastScannedAt)}`);
  }
  statusMeta.textContent = parts.join(' • ');
}

function renderHeatmap(heatmap) {
  heatmapContainer.innerHTML = '';
  if (!heatmap || heatmap.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No high-risk categories detected.';
    empty.className = 'heatmap__empty';
    heatmapContainer.appendChild(empty);
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
    heatmapContainer.appendChild(row);
  }
}

function renderClauses(clauses) {
  clausesList.innerHTML = '';
  if (!clauses || clauses.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No suspicious clauses were flagged.';
    empty.className = 'clause clause--empty';
    clausesList.appendChild(empty);
    clauseCount.textContent = '0 clauses';
    return;
  }

  clauseCount.textContent = `${clauses.length} clause${clauses.length === 1 ? '' : 's'}`;

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

    clausesList.appendChild(fragment);
  }
}

function updateAnalysis(state) {
  const { analysis } = state;
  if (!analysis) {
    analysisSection.hidden = true;
    return;
  }
  analysisSection.hidden = false;
  summaryEl.textContent = analysis.summary || 'No summary generated.';
  renderHeatmap(analysis.riskHeatmap);
  renderClauses(analysis.suspiciousClauses);
}

function updateError(state) {
  if (state.error) {
    errorSection.hidden = false;
    errorMessage.textContent = state.error;
  } else {
    errorSection.hidden = true;
    errorMessage.textContent = '';
  }
}

async function requestState(tabId) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-state', tabId });
    if (response && response.ok) {
      return response.state;
    }
  } catch (error) {
    console.warn('Policy Guardian popup failed to fetch state', error);
  }
  return null;
}

async function startScan(tabId) {
  scanButton.disabled = true;
  rescanButton.disabled = true;
  statusLabel.textContent = 'Requesting scan…';
  statusMeta.textContent = '';
  try {
    await chrome.runtime.sendMessage({ type: 'start-scan', tabId, origin: 'popup' });
  } catch (error) {
    console.warn('Policy Guardian popup failed to start scan', error);
  }
}

function applyState(state) {
  if (!state) return;
  currentState = state;
  updateStatus(state);
  updateAnalysis(state);
  updateError(state);
}

async function initialize() {
  currentSettings = await loadSettings();
  applyTheme(currentSettings);
  if (darkModeToggle) {
    darkModeToggle.checked = Boolean(currentSettings.darkMode);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;
  const state = await requestState(currentTabId);
  if (state) {
    applyState(state);
  } else {
    statusLabel.textContent = 'Extension is idle';
  }
}

scanButton.addEventListener('click', () => {
  if (currentTabId == null) return;
  startScan(currentTabId);
});

rescanButton.addEventListener('click', () => {
  if (currentTabId == null) return;
  startScan(currentTabId);
});

copySummaryButton.addEventListener('click', async () => {
  if (!currentState || !currentState.analysis || !currentState.analysis.summary) return;
  try {
    await navigator.clipboard.writeText(currentState.analysis.summary);
    copySummaryButton.textContent = 'Copied!';
    setTimeout(() => {
      copySummaryButton.textContent = 'Copy summary';
    }, 1600);
  } catch (error) {
    copySummaryButton.textContent = 'Copy failed';
    setTimeout(() => {
      copySummaryButton.textContent = 'Copy summary';
    }, 1600);
  }
});

if (settingsToggle) {
  settingsToggle.addEventListener('click', () => {
    if (!settingsCard) return;
    const isHidden = settingsCard.hidden;
    settingsCard.hidden = !isHidden;
    settingsToggle.setAttribute('aria-expanded', String(isHidden));
  });
}

if (darkModeToggle) {
  darkModeToggle.addEventListener('change', () => {
    updateSettings({ darkMode: darkModeToggle.checked });
  });
}

if (openReportButton) {
  openReportButton.addEventListener('click', async () => {
    if (currentTabId == null) return;
    const url = chrome.runtime.getURL(`report/report.html?tab=${currentTabId}`);
    try {
      await chrome.tabs.create({ url });
    } catch (error) {
      console.debug('Policy Guardian: unable to open report tab', error);
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.payload) return;
  if (message.payload.tabId !== currentTabId) return;
  switch (message.type) {
    case 'policy-detected': {
      requestState(currentTabId).then(applyState);
      break;
    }
    case 'scan-started': {
      requestState(currentTabId).then(applyState);
      break;
    }
    case 'scan-complete': {
      requestState(currentTabId).then(applyState);
      break;
    }
    case 'scan-error': {
      requestState(currentTabId).then(applyState);
      break;
    }
    default:
      break;
  }
});

document.addEventListener('DOMContentLoaded', initialize);
