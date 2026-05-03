// popup.js — Ask AI

const $ = id => document.getElementById(id);

const els = {
  unsupported:    $('unsupported'),
  controls:       $('controls'),
  questionInput:  $('questionInput'),
  chips:          $('chips'),
  btnAsk:         $('btnAsk'),
  loading:        $('loading'),
  loadingText:    $('loadingText'),
  output:         $('output'),
  outputLabel:    $('outputLabel'),
  answerBox:      $('answerBox'),
  errorBox:       $('errorBox'),
  errorText:      $('errorText'),
  btnCopy:        $('btnCopy'),
  btnExpand:      $('btnExpand'),
  sourceBadge:    $('sourceBadge'),
  sourceKind:     $('sourceKind'),
  sourceTitle:    $('sourceTitle'),
  sourceIcon:     $('sourceIcon'),
};

let lastAnswer = '';
let lastQuestion = '';
let lastMeta = null;
let pageKind = 'page'; // 'page' or 'youtube'

const PAGE_CHIPS = [
  'Summarize this',
  "What's the main argument?",
  'Explain like I\'m new to this',
  'List the key takeaways',
];

const YT_CHIPS = [
  'Summarize this video',
  "What's the main point?",
  'List the key takeaways',
  'Are there any specific tips or steps?',
];

// INITIALIZATION
async function init() {
  document.getElementById('flagLink').addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://flags/#prompt-api-for-gemini-nano' });
  });

  const version = chrome.runtime.getManifest().version;
  const chromeMatch = navigator.userAgent.match(/Chrome\/([\d.]+)/);
  const chromeVersion = chromeMatch ? chromeMatch[1] : 'unknown';
  const feedbackSubject = encodeURIComponent('Ask AI Feedback');
  const feedbackBody = encodeURIComponent(
    'Hi,\n\n[Replace this with your feedback, or fill in the bug report below]\n\n' +
    '---\nBUG REPORT (delete if not applicable)\n' +
    'Extension: Ask AI v' + version + '\n' +
    'Chrome: ' + chromeVersion + '\n'
  );
  document.getElementById('feedbackLink').href =
    'mailto:jtysonwilliams@yahoo.com?subject=' + feedbackSubject + '&body=' + feedbackBody;

  const overlay = document.getElementById('aboutOverlay');
  document.getElementById('btnLearn').addEventListener('click', function() {
    overlay.classList.add('visible');
  });
  document.getElementById('btnCloseAbout').addEventListener('click', function() {
    overlay.classList.remove('visible');
  });

  const supported = await checkSupportAsync();
  if (!supported) {
    els.controls.style.display = 'none';
    els.unsupported.classList.add('visible');
    return;
  }

  // Detect what kind of page we're on (YouTube vs article)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isYouTube = tab && tab.url && /youtube\.com\/watch/.test(tab.url);
  pageKind = isYouTube ? 'youtube' : 'page';
  renderSourceBadge(isYouTube, tab && tab.title);
  renderChips(isYouTube ? YT_CHIPS : PAGE_CHIPS);

  els.questionInput.focus();

  // Wire up
  els.btnAsk.addEventListener('click', runAsk);
  els.btnCopy.addEventListener('click', copyText);
  els.btnExpand.addEventListener('click', function() {
    if (lastAnswer) openExpandTab(lastQuestion, lastAnswer, lastMeta);
  });

  els.questionInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      runAsk();
    }
  });
}

function renderSourceBadge(isYouTube, title) {
  els.sourceBadge.style.display = 'flex';
  els.sourceKind.textContent = isYouTube ? 'YouTube' : 'Page';
  els.sourceTitle.textContent = title ? '· ' + title.replace(/ - YouTube$/, '').trim() : '';
  if (isYouTube) {
    els.sourceIcon.innerHTML =
      '<polygon points="23 7 16 12 23 17 23 7"/>' +
      '<rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>';
  }
}

function renderChips(items) {
  els.chips.innerHTML = '';
  items.forEach(function(label) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', function() {
      els.questionInput.value = label;
      runAsk();
    });
    els.chips.appendChild(btn);
  });
}

// SUPPORT CHECK — Prompt API (LanguageModel)
async function checkSupportAsync() {
  try {
    if (self.LanguageModel) {
      const avail = await self.LanguageModel.availability();
      return avail !== 'unavailable';
    }
    if (self.ai && self.ai.languageModel) {
      const avail = await self.ai.languageModel.availability();
      return avail !== 'unavailable';
    }
    return false;
  } catch (e) {
    return false;
  }
}

function getLanguageModel() {
  if (self.LanguageModel) return self.LanguageModel;
  if (self.ai && self.ai.languageModel) return self.ai.languageModel;
  return null;
}

// MAIN WORKFLOW
async function runAsk() {
  const question = els.questionInput.value.trim();
  if (!question) {
    showError('Type a question first.');
    return;
  }

  setLoading(true);
  hideError();
  hideSetup();
  hideOutput();
  lastQuestion = question;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isYouTube = tab && tab.url && /youtube\.com\/watch/.test(tab.url);

    let extracted;
    if (isYouTube) {
      setLoadingText('Extracting transcript');
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractYouTubeTranscriptFromPage,
          world: 'MAIN',
        });
        extracted = res[0] && res[0].result;
      } catch (e) {
        throw new Error("Couldn't access this page.");
      }
      if (!extracted || !extracted.content || extracted.content.trim().length < 100) {
        throw new Error("No transcript found. This video may not have captions available. Look for the CC icon on the player.");
      }
    } else {
      setLoadingText('Reading the page');
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractContentFromPage,
        });
        extracted = res[0] && res[0].result;
      } catch (e) {
        throw new Error("Couldn't access this page.");
      }
      if (!extracted || !extracted.content || extracted.content.trim().length < 100) {
        throw new Error("Not enough readable text found on this page.");
      }
    }
    lastMeta = extracted;

    const lm = getLanguageModel();
    if (!lm) {
      setLoading(false);
      showSetup(
        'To use this feature, you must turn on an exploratory Chrome feature. Click below, then restart Chrome.',
        'Enable Prompt API for Gemini Nano',
        'chrome://flags/#prompt-api-for-gemini-nano'
      );
      return;
    }

    setLoadingText('Loading on-device model');
    let availability;
    try {
      availability = await lm.availability();
    } catch (e) {
      availability = 'unavailable';
    }

    if (availability === 'unavailable' || availability === 'no') {
      setLoading(false);
      showSetup(
        "The on-device AI model isn't ready yet. This sometimes takes a few minutes after enabling the Chrome feature. Try closing and reopening Chrome, then try again.",
        'Open Chrome flags',
        'chrome://flags/#prompt-api-for-gemini-nano'
      );
      return;
    }

    let session;
    if (availability === 'downloadable') {
      setLoadingText('Downloading model (once)');
      session = await lm.create({
        monitor: function(m) {
          m.addEventListener('downloadprogress', function(e) {
            const pct = Math.round((e.loaded || 0) * 100);
            setLoadingText('Downloading model ' + pct + '%');
          });
        }
      });
    } else {
      session = await lm.create();
    }

    setLoadingText(isYouTube ? 'Watching the transcript' : 'Reading and answering');

    const prompt = buildPrompt(extracted, question, isYouTube);

    let streamedText = '';
    let prevChunk = '';
    let streamingStarted = false;
    let rafId = null;
    const stream = session.promptStreaming(prompt);

    for await (const chunk of stream) {
      const delta = chunk.startsWith(prevChunk) ? chunk.slice(prevChunk.length) : chunk;
      streamedText += delta;
      prevChunk = chunk;

      if (!streamingStarted) {
        streamingStarted = true;
        setLoading(false);
        els.outputLabel.textContent = 'Answer';
        els.output.classList.add('visible');
      }

      if (!rafId) {
        rafId = requestAnimationFrame(function() {
          rafId = null;
          renderAnswerStreaming(streamedText, question);
        });
      }
    }

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    session.destroy();
    displayAnswer(streamedText, question);
    setLoading(false);
  } catch (err) {
    setLoading(false);
    showError(err.message || 'An unexpected error occurred.');
  }
}

function buildPrompt(extracted, question, isYouTube) {
  const sourceLabel = isYouTube ? 'video transcript' : 'webpage';
  const caveat = isYouTube
    ? 'The transcript is auto-generated from spoken audio and may have errors or missing punctuation.'
    : '';

  return [
    'You are a helpful assistant answering a question about a ' + sourceLabel + '. ',
    'Use ONLY the content below to answer. If the answer is not in the content, say so plainly — do not guess. ',
    'Answer in complete sentences as flowing prose. Do NOT use bullet points, numbered lists, dashes, or any list formatting — even if the question asks for a list, write it as a sentence or short paragraph. ',
    'Directly answer the question that was asked. Be concise: 1–3 sentences when possible, longer only if the question genuinely requires it. ',
    caveat,
    '\n\n',
    'Title: ' + (extracted.title || '(no title)') + '\n\n',
    'Content:\n',
    extracted.content,
    '\n\n',
    'Question: ' + question + '\n\n',
    'Answer:'
  ].join('');
}

// PAGE CONTENT EXTRACTOR
function extractContentFromPage() {
  const url = window.location.href;

  const selectors = ['article', 'main', '[role="main"]', '.post-content', '.article-body', '.entry-content', '#content', '#main-content'];
  let el = null;
  for (let i = 0; i < selectors.length; i++) {
    const found = document.querySelector(selectors[i]);
    if (found && found.textContent.trim().length > 200) { el = found; break; }
  }
  if (!el) el = document.body;

  const clone = el.cloneNode(true);
  const noisy = ['nav','header','footer','aside','script','style','noscript','.ad','.ads','.sidebar','.comments','.share','.social','.cookie','.popup','.modal','.newsletter','[aria-hidden="true"]'];
  noisy.forEach(function(sel) {
    try { clone.querySelectorAll(sel).forEach(function(n) { n.remove(); }); } catch (e) {}
  });

  const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 15000);

  const siteEl = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]');
  const siteName = siteEl ? siteEl.content : null;

  return { type: 'article', title: document.title, content: text, url: url, siteName: siteName };
}

// YOUTUBE TRANSCRIPT EXTRACTOR
async function extractYouTubeTranscriptFromPage() {
  const title = document.title.replace(/ - YouTube$/, '').trim();
  const url = window.location.href;

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function readTranscriptDOM() {
    var newSegs = document.querySelectorAll('transcript-segment-view-model span[role="text"]');
    if (newSegs.length >= 5) {
      return Array.from(newSegs)
        .map(function(s) { return s.textContent ? s.textContent.trim() : ''; })
        .filter(Boolean)
        .join(' ').replace(/\s+/g, ' ').trim();
    }

    var oldSegs = document.querySelectorAll(
      'ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer'
    );
    if (oldSegs.length < 5) return null;
    return Array.from(oldSegs)
      .map(function(s) { return s.textContent ? s.textContent.trim() : ''; })
      .filter(function(t) { return t && !/^\d+:\d+$/.test(t); })
      .join(' ').replace(/\s+/g, ' ').trim();
  }

  function collectMeta() {
    const channelEl = document.querySelector(
      'ytd-channel-name yt-formatted-string a, #channel-name .yt-formatted-string, #owner ytd-channel-name a'
    );
    const channelName = channelEl ? channelEl.textContent.trim() : null;

    const viewEl = document.querySelector('.view-count, #view-count span.view-count, ytd-video-view-count-renderer span');
    const viewCount = viewEl ? viewEl.textContent.trim() : null;

    const pubMeta = document.querySelector('meta[itemprop="datePublished"]');
    const publishedDate = pubMeta ? pubMeta.content : null;

    return { channelName: channelName, viewCount: viewCount, publishedDate: publishedDate };
  }

  function buildResult(content) {
    const m = collectMeta();
    return {
      title: title, url: url, content: content, type: 'youtube',
      channelName: m.channelName, viewCount: m.viewCount, publishedDate: m.publishedDate
    };
  }

  function parseTracksAndFetch(tracks) {
    if (!tracks || !tracks.length) return Promise.resolve(null);
    const track = tracks.find(function(t) {
      return t.languageCode === 'en' || (t.languageCode && t.languageCode.startsWith('en'));
    }) || tracks[0];
    if (!track || !track.baseUrl) return Promise.resolve(null);

    return fetch(track.baseUrl + '&fmt=json3')
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function(j) {
        const text = (j.events || [])
          .filter(function(e) { return e.segs; })
          .map(function(e) { return e.segs.map(function(s) { return s.utf8 || ''; }).join(''); })
          .join(' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        return text.length > 100 ? text.slice(0, 15000) : null;
      })
      .catch(function() {
        return fetch(track.baseUrl)
          .then(function(r) { return r.ok ? r.text() : null; })
          .then(function(xml) {
            if (!xml) return null;
            const text = xml
              .replace(/<[^>]+>/g, ' ')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
              .replace(/\s+/g, ' ').trim();
            return text.length > 100 ? text.slice(0, 15000) : null;
          })
          .catch(function() { return null; });
      });
  }

  // Method 1: ytInitialPlayerResponse
  try {
    const currentVideoId = new URLSearchParams(window.location.search).get('v');
    const ipr = window.ytInitialPlayerResponse;
    const iprVideoId = ipr && ipr.videoDetails && ipr.videoDetails.videoId;
    if (ipr && (!currentVideoId || !iprVideoId || currentVideoId === iprVideoId)) {
      const tracks = ipr.captions
        && ipr.captions.playerCaptionsTracklistRenderer
        && ipr.captions.playerCaptionsTracklistRenderer.captionTracks;
      const text = await parseTracksAndFetch(tracks);
      if (text) return buildResult(text);
    }
  } catch (e) {}

  // Method 1b: ytplayer.config
  try {
    const cfg = window.ytplayer && window.ytplayer.config;
    const raw = cfg && cfg.args && cfg.args.raw_player_response;
    const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    const tracks = parsed
      && parsed.captions
      && parsed.captions.playerCaptionsTracklistRenderer
      && parsed.captions.playerCaptionsTracklistRenderer.captionTracks;
    const text = await parseTracksAndFetch(tracks);
    if (text) return buildResult(text);
  } catch (e) {}

  // Method 2: transcript panel already open
  const existing = readTranscriptDOM();
  if (existing && existing.length > 100) return buildResult(existing.slice(0, 15000));

  // Method 3a: "In this video" panel — Transcript tab
  try {
    var allTabs = Array.from(document.querySelectorAll(
      'tp-yt-paper-tab, [role="tab"], yt-tab-shape'
    ));
    var transcriptTab = allTabs.find(function(tab) {
      var txt = (tab.innerText || tab.textContent || '').trim().toLowerCase();
      return txt === 'transcript';
    });
    if (transcriptTab) {
      transcriptTab.click();
      await sleep(1000);
      var tabText = readTranscriptDOM();
      if (tabText && tabText.length > 100) return buildResult(tabText.slice(0, 15000));
    }
  } catch (e) {}

  // Method 3b: "Show transcript" button
  try {
    var transcriptBtn = document.querySelector('[aria-label="Show transcript"]');

    if (!transcriptBtn) {
      const expandSelectors = [
        '#description-inline-expander #expand',
        'ytd-text-inline-expander #expand',
        'ytd-text-inline-expander tp-yt-paper-button',
        '#description tp-yt-paper-button[aria-expanded="false"]',
      ];
      for (var i = 0; i < expandSelectors.length; i++) {
        var expBtn = document.querySelector(expandSelectors[i]);
        if (expBtn) { expBtn.click(); break; }
      }
      await sleep(600);

      var allClickable = Array.from(document.querySelectorAll(
        'button, tp-yt-paper-button, yt-button-shape button, ytd-button-renderer button'
      ));
      transcriptBtn = allClickable.find(function(b) {
        var txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'show transcript' || txt === 'transcript' || txt === 'open transcript';
      });
    }

    if (transcriptBtn) {
      transcriptBtn.click();
      await sleep(2500);
      var domText = readTranscriptDOM();
      if (domText && domText.length > 100) return buildResult(domText.slice(0, 15000));
    }
  } catch (e) {}

  return buildResult(null);
}

// ANSWER RENDERING
function splitIntoLines(text) {
  return text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
}

function isBulletLine(line) {
  return /^[-*•]\s+/.test(line);
}

function stripBullet(line) {
  return line.replace(/^[-*•]\s+/, '').trim();
}

function renderAnswerStreaming(text, question) {
  els.answerBox.innerHTML = '';

  const qEl = document.createElement('div');
  qEl.className = 'question-echo';
  qEl.textContent = question;
  els.answerBox.appendChild(qEl);

  const lines = splitIntoLines(text);
  const allBullets = lines.length > 1 && lines.every(isBulletLine);

  if (allBullets) {
    const ul = document.createElement('ul');
    lines.forEach(function(line, i) {
      const li = document.createElement('li');
      li.textContent = stripBullet(line);
      if (i === lines.length - 1) li.appendChild(createCursor());
      ul.appendChild(li);
    });
    els.answerBox.appendChild(ul);
    return;
  }

  if (!lines.length) {
    const p = document.createElement('p');
    p.appendChild(createCursor());
    els.answerBox.appendChild(p);
    return;
  }

  lines.forEach(function(line, i) {
    const p = document.createElement('p');
    p.textContent = stripBullet(line);
    if (i === lines.length - 1) p.appendChild(createCursor());
    els.answerBox.appendChild(p);
  });
}

function displayAnswer(text, question) {
  lastAnswer = text;

  els.answerBox.innerHTML = '';

  const qEl = document.createElement('div');
  qEl.className = 'question-echo';
  qEl.textContent = question;
  els.answerBox.appendChild(qEl);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'disclaimer';
  disclaimer.textContent = 'AI-generated answer using a local model. Verify important details.';
  els.answerBox.appendChild(disclaimer);

  const lines = splitIntoLines(text);
  const allBullets = lines.length > 1 && lines.every(isBulletLine);

  if (allBullets) {
    const ul = document.createElement('ul');
    lines.forEach(function(line) {
      const li = document.createElement('li');
      li.textContent = stripBullet(line);
      ul.appendChild(li);
    });
    els.answerBox.appendChild(ul);
  } else {
    lines.forEach(function(line) {
      const p = document.createElement('p');
      p.textContent = stripBullet(line);
      els.answerBox.appendChild(p);
    });
  }

  els.output.classList.add('visible');
}

function createCursor() {
  const span = document.createElement('span');
  span.className = 'stream-cursor';
  span.textContent = '▍';
  return span;
}

// EXPAND TAB
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openExpandTab(question, answer, meta) {
  const title = (meta && meta.title) || 'Answer';
  const url = (meta && meta.url) || '';
  const isYT = meta && meta.type === 'youtube';

  const lines = splitIntoLines(answer);
  const allBullets = lines.length > 1 && lines.every(isBulletLine);

  let answerHtml = '';
  if (allBullets) {
    answerHtml = '<ul>' + lines.map(function(l) {
      return '<li>' + escapeHtml(stripBullet(l)) + '</li>';
    }).join('') + '</ul>';
  } else {
    answerHtml = lines.map(function(l) {
      return '<p>' + escapeHtml(stripBullet(l)) + '</p>';
    }).join('');
  }

  const sourceParts = [];
  if (isYT && meta.channelName) sourceParts.push(meta.channelName);
  else if (meta && meta.siteName) sourceParts.push(meta.siteName);

  const metaHtml = sourceParts.length
    ? '<p class="meta">' + escapeHtml(sourceParts.join('  ·  ')) + '</p>'
    : '';

  const urlHtml = url
    ? '<a class="source-url" href="' + escapeHtml(url) + '" target="_blank">View original</a>'
    : '';

  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<title>' + escapeHtml(question) + '</title>'
    + '<style>'
    + ':root {'
    + '  --ink: #0E0E0F; --paper: #FAFAF7; --pure-white: #FFFFFF;'
    + '  --fg-muted: #6B6B72; --fg-subtle: #9A9AA0;'
    + '  --hairline: #E5E5E2; --hairline-strong: #C8C8CC;'
    + '  --accent: #1F8A4C;'
    + '  --warning: #92400E; --warning-bg: #FEF3C7;'
    + '  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
    + '  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;'
    + '}'
    + '@media (prefers-color-scheme: dark) {'
    + '  :root { --ink: #F5F5F2; --paper: #0B0B0C; --pure-white: #131315; --fg-muted: #A0A0A6; --fg-subtle: #6B6B72; --hairline: #26262A; --hairline-strong: #3D3D42; --warning-bg: rgba(180,83,9,0.18); }'
    + '}'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + 'body { font-family: var(--font-sans); color: var(--ink); background: var(--paper); line-height: 1.6; -webkit-font-smoothing: antialiased; }'
    + '.page { max-width: 680px; margin: 0 auto; padding: 48px 40px; }'
    + '.badge { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 24px; }'
    + '.eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 8px; }'
    + 'h1 { font-family: var(--font-sans); font-weight: 600; font-size: 28px; line-height: 1.3; letter-spacing: -0.02em; margin-bottom: 18px; color: var(--ink); }'
    + '.source-title { font-family: var(--font-sans); font-size: 14px; color: var(--fg-muted); margin-bottom: 6px; }'
    + '.meta { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted); margin-bottom: 8px; line-height: 1.5; }'
    + '.source-url { display: inline-block; font-family: var(--font-mono); font-size: 12px; color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--hairline-strong); margin-bottom: 28px; }'
    + '.source-url:hover { text-decoration-color: var(--ink); }'
    + '.divider { border: none; border-top: 1px solid var(--hairline); margin-bottom: 24px; }'
    + 'h2 { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; font-weight: 400; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 12px; }'
    + 'ul { list-style: none; display: flex; flex-direction: column; gap: 10px; }'
    + 'li { display: flex; gap: 12px; font-size: 15px; line-height: 1.65; color: var(--ink); align-items: flex-start; }'
    + 'li::before { content: ""; flex-shrink: 0; width: 4px; height: 4px; background: var(--fg-muted); border-radius: 50%; margin-top: 11px; }'
    + 'p { font-size: 15px; line-height: 1.7; color: var(--ink); margin-bottom: 10px; }'
    + '.disclaimer { font-family: var(--font-sans); font-size: 13px; color: var(--warning); background: var(--warning-bg); border: 1px solid color-mix(in srgb, var(--warning) 25%, transparent); border-radius: 6px; padding: 9px 12px; margin-bottom: 20px; line-height: 1.5; }'
    + '.footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--hairline); font-family: var(--font-mono); font-size: 11px; color: var(--fg-subtle); letter-spacing: 0.04em; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }'
    + '.footer a { color: var(--fg-muted); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--hairline-strong); }'
    + '.footer a:hover { color: var(--ink); }'
    + '@media print { body { background: white; } .page { padding: 0; } .footer a { display: none; } }'
    + '</style></head><body>'
    + '<div class="page">'
    + '<div class="badge">Ask AI</div>'
    + '<div class="eyebrow">Question</div>'
    + '<h1>' + escapeHtml(question) + '</h1>'
    + '<div class="eyebrow">Source</div>'
    + '<p class="source-title">' + escapeHtml(title) + '</p>'
    + metaHtml
    + urlHtml
    + '<hr class="divider">'
    + '<p class="disclaimer">AI-generated answer using a local model. Verify important details.</p>'
    + '<h2>Answer</h2>'
    + answerHtml
    + '<div class="footer"><span>Ask AI · Runs entirely on your device · No data sent</span><a href="https://buymeacoffee.com/jtysonwilliams" target="_blank">Buy me a coffee</a></div>'
    + '</div></body></html>';

  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  if (win) win.addEventListener('load', function() { URL.revokeObjectURL(blobUrl); });
}

// COPY
async function copyText() {
  if (!lastAnswer) return;
  await navigator.clipboard.writeText(lastAnswer);
  els.btnCopy.textContent = 'copied!';
  els.btnCopy.classList.add('copied');
  setTimeout(function() {
    els.btnCopy.textContent = 'copy';
    els.btnCopy.classList.remove('copied');
  }, 2000);
}

// UI HELPERS
function setLoading(on) {
  els.loading.classList.toggle('visible', on);
  els.controls.style.opacity       = on ? '0.4' : '1';
  els.controls.style.pointerEvents = on ? 'none' : 'auto';
}

function setLoadingText(t) { els.loadingText.textContent = t; }
function showError(msg)     { els.errorText.textContent = msg; els.errorBox.classList.add('visible'); }
function hideError()        { els.errorBox.classList.remove('visible'); }
function hideOutput()       { els.output.classList.remove('visible'); }

function showSetup(message, buttonLabel, flagUrl) {
  document.getElementById('setupText').textContent = message;
  const btn = document.getElementById('btnSetupAction');
  btn.textContent = buttonLabel;
  btn.onclick = function() { chrome.tabs.create({ url: flagUrl }); };
  document.getElementById('setupBox').classList.add('visible');
}

function hideSetup() { document.getElementById('setupBox').classList.remove('visible'); }

init();
