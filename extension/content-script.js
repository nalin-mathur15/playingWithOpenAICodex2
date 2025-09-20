(() => {
  const KEYWORD_SETS = {
    terms: [
      'terms of service',
      'terms & conditions',
      'terms and conditions',
      'user agreement',
      'service agreement',
      'acceptable use policy',
      'end user license',
      'eula',
      'conditions of use'
    ],
    privacy: [
      'privacy policy',
      'data policy',
      'privacy notice',
      'data protection',
      'personal data',
      'data collection',
      'information we collect',
      'gdpr',
      'ccpa'
    ]
  };

  const detectionState = {
    lastResult: null,
    floatingUi: null,
    pendingScanRequest: false
  };

  function normalize(str) {
    return (str || '').toLowerCase();
  }

  function gatherStructuredText() {
    const selectors = 'h1, h2, h3, h4, h5, p, li, dt, dd, blockquote';
    const nodes = Array.from(document.querySelectorAll(selectors));
    const paragraphs = [];
    for (const node of nodes) {
      const text = node.innerText.replace(/\s+/g, ' ').trim();
      if (text.length < 3) continue;
      paragraphs.push(text);
      if (paragraphs.length >= 350) break;
    }
    let joined = paragraphs.join('\n\n');
    if (joined.length > 60000) {
      joined = joined.slice(0, 60000);
    }
    return { text: joined, paragraphs };
  }

  function computeKeywordMatches(target, keywords, label) {
    const matches = [];
    for (const keyword of keywords) {
      if (target.includes(keyword)) {
        matches.push(`${label}: ${keyword}`);
      }
    }
    return matches;
  }

  function computeDetection() {
    const url = normalize(window.location.href);
    const title = normalize(document.title);
    const heading = normalize(
      Array.from(document.querySelectorAll('h1, h2'))
        .slice(0, 4)
        .map((node) => node.innerText)
        .join(' ')
    );

    const structured = gatherStructuredText();
    const bodySample = normalize(structured.text.slice(0, 4000));

    const scores = { terms: 0, privacy: 0 };
    const matches = { terms: [], privacy: [] };

    const addScore = (type, amount, match) => {
      scores[type] += amount;
      if (match) {
        matches[type].push(match);
      }
    };

    const urlMatchesTerms = computeKeywordMatches(url, KEYWORD_SETS.terms, 'URL');
    const urlMatchesPrivacy = computeKeywordMatches(url, KEYWORD_SETS.privacy, 'URL');
    const titleMatchesTerms = computeKeywordMatches(title, KEYWORD_SETS.terms, 'Title');
    const titleMatchesPrivacy = computeKeywordMatches(title, KEYWORD_SETS.privacy, 'Title');
    const headingMatchesTerms = computeKeywordMatches(heading, KEYWORD_SETS.terms, 'Heading');
    const headingMatchesPrivacy = computeKeywordMatches(heading, KEYWORD_SETS.privacy, 'Heading');
    const bodyMatchesTerms = computeKeywordMatches(bodySample, KEYWORD_SETS.terms, 'Body');
    const bodyMatchesPrivacy = computeKeywordMatches(bodySample, KEYWORD_SETS.privacy, 'Body');

    for (const match of urlMatchesTerms) addScore('terms', 2.5, match);
    for (const match of urlMatchesPrivacy) addScore('privacy', 2.5, match);
    for (const match of titleMatchesTerms) addScore('terms', 2, match);
    for (const match of titleMatchesPrivacy) addScore('privacy', 2, match);
    for (const match of headingMatchesTerms) addScore('terms', 1.5, match);
    for (const match of headingMatchesPrivacy) addScore('privacy', 1.5, match);
    for (const match of bodyMatchesTerms) addScore('terms', 1, match);
    for (const match of bodyMatchesPrivacy) addScore('privacy', 1, match);

    if (/privacy/.test(url)) addScore('privacy', 1.5, 'URL contains "privacy"');
    if (/terms|conditions/.test(url)) addScore('terms', 1.5, 'URL contains "terms"');
    if (/policy/.test(title)) addScore('privacy', 1.2, 'Title contains "policy"');

    const bestType = scores.terms >= scores.privacy ? 'terms' : 'privacy';
    const bestScore = scores[bestType];
    const otherScore = scores[bestType === 'terms' ? 'privacy' : 'terms'];

    const confidence = Math.min(0.99, bestScore / 6);

    const threshold = 2.8;
    if (bestScore < threshold) {
      return null;
    }

    const keywordMatches = matches[bestType];
    const pageType = bestType === 'terms' ? 'terms-of-service' : 'privacy-policy';
    const { text } = structured;

    return {
      pageType,
      confidence,
      keywordMatches,
      contentLength: text.length,
      title: document.title,
      url: window.location.href
    };
  }

  function createFloatingUi() {
    if (detectionState.floatingUi) return detectionState.floatingUi;
    const container = document.createElement('div');
    container.id = 'policy-guardian-widget';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.background = 'rgba(44, 27, 91, 0.92)';
    container.style.color = '#fff';
    container.style.padding = '16px';
    container.style.borderRadius = '12px';
    container.style.boxShadow = '0 8px 24px rgba(20, 16, 51, 0.32)';
    container.style.zIndex = '2147483646';
    container.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    container.style.width = '280px';
    container.style.maxWidth = '90vw';
    container.style.transition = 'opacity 160ms ease-in-out';

    const heading = document.createElement('div');
    heading.textContent = 'Policy Guardian spotted a policy page';
    heading.style.fontWeight = '600';
    heading.style.marginBottom = '8px';
    heading.style.fontSize = '14px';

    const sub = document.createElement('div');
    sub.id = 'policy-guardian-subtitle';
    sub.style.fontSize = '12px';
    sub.style.opacity = '0.85';
    sub.style.marginBottom = '12px';

    const button = document.createElement('button');
    button.textContent = 'Scan for risky clauses';
    button.style.width = '100%';
    button.style.padding = '10px 12px';
    button.style.border = 'none';
    button.style.borderRadius = '8px';
    button.style.background = '#B69DF8';
    button.style.color = '#20123A';
    button.style.fontWeight = '600';
    button.style.cursor = 'pointer';
    button.style.fontSize = '13px';

    button.addEventListener('mouseenter', () => {
      button.style.background = '#D0BCFF';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = '#B69DF8';
    });
    button.addEventListener('click', () => {
      detectionState.pendingScanRequest = true;
      chrome.runtime.sendMessage({ type: 'start-scan', origin: 'content-widget' });
      button.disabled = true;
      button.textContent = 'Scanning…';
      button.style.opacity = '0.8';
    });

    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.style.marginTop = '8px';
    dismiss.style.width = '100%';
    dismiss.style.padding = '8px 12px';
    dismiss.style.border = '1px solid rgba(255,255,255,0.3)';
    dismiss.style.borderRadius = '8px';
    dismiss.style.background = 'transparent';
    dismiss.style.color = '#fff';
    dismiss.style.cursor = 'pointer';
    dismiss.style.fontSize = '12px';

    dismiss.addEventListener('mouseenter', () => {
      dismiss.style.background = 'rgba(255,255,255,0.12)';
    });
    dismiss.addEventListener('mouseleave', () => {
      dismiss.style.background = 'transparent';
    });
    dismiss.addEventListener('click', () => {
      hideFloatingUi();
    });

    container.appendChild(heading);
    container.appendChild(sub);
    container.appendChild(button);
    container.appendChild(dismiss);

    document.body.appendChild(container);
    detectionState.floatingUi = container;
    return container;
  }

  function hideFloatingUi() {
    if (detectionState.floatingUi && detectionState.floatingUi.parentElement) {
      detectionState.floatingUi.style.opacity = '0';
      setTimeout(() => {
        if (detectionState.floatingUi && detectionState.floatingUi.parentElement) {
          detectionState.floatingUi.parentElement.removeChild(detectionState.floatingUi);
        }
        detectionState.floatingUi = null;
      }, 160);
    }
  }

  function updateFloatingUi(detection) {
    if (!detection) {
      hideFloatingUi();
      return;
    }
    const widget = createFloatingUi();
    const subtitle = widget.querySelector('#policy-guardian-subtitle');
    if (subtitle) {
      const confidencePercent = Math.round(detection.confidence * 100);
      subtitle.textContent = `Confidence ${confidencePercent}% • ${detection.pageType.replace('-', ' ')}`;
    }
    const button = widget.querySelector('button');
    if (button) {
      button.disabled = false;
      button.textContent = 'Scan for risky clauses';
      button.style.opacity = '1';
    }
  }

  async function reportDetection(detection) {
    if (!detection) return;
    const last = detectionState.lastResult;
    const changed = !last || last.pageType !== detection.pageType || Math.abs(last.confidence - detection.confidence) > 0.05;
    if (!changed) return;
    detectionState.lastResult = detection;
    try {
      await chrome.runtime.sendMessage({ type: 'policy-detected', payload: detection });
    } catch (error) {
      // Ignore if the service worker is not available.
    }
  }

  function scheduleDetection() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runDetection, { once: true });
      return;
    }
    runDetection();
  }

  function runDetection() {
    const detection = computeDetection();
    if (detection) {
      updateFloatingUi(detection);
      reportDetection(detection);
    } else {
      hideFloatingUi();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'collect-page-text') {
      const structured = gatherStructuredText();
      sendResponse({
        text: structured.text,
        paragraphs: structured.paragraphs,
        url: window.location.href,
        title: document.title
      });
      return true;
    }
    if (message && message.type === 'scan-complete') {
      if (detectionState.floatingUi) {
        const button = detectionState.floatingUi.querySelector('button');
        if (button) {
          button.disabled = false;
          button.textContent = 'View results in popup';
          button.style.opacity = '1';
        }
      }
      return false;
    }
    return false;
  });

  const observer = new MutationObserver(() => {
    window.clearTimeout(runDetection.debounceTimer);
    runDetection.debounceTimer = window.setTimeout(runDetection, 1200);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: false });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  scheduleDetection();
  window.addEventListener('load', () => runDetection());
})();
