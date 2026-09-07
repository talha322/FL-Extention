document.addEventListener('DOMContentLoaded', () => {

    // ── Element refs ──────────────────────────────────────────────────────────
    const excludeCountryInput= document.getElementById('exclude-country');
    const maxAgeInput        = document.getElementById('max-age');
    const matchLimitInput    = document.getElementById('match-limit');
    const oneTimeScanInput   = document.getElementById('one-time-scan');
    const minIntervalInput   = document.getElementById('min-interval');
    const maxIntervalInput   = document.getElementById('max-interval');
    const intervalContainer  = document.getElementById('interval-container');

    const skillMatchEnabled  = document.getElementById('skill-match-enabled');
    const skillMatchOptions  = document.getElementById('skill-match-options');
    const myKeywordsInput    = document.getElementById('my-keywords');
    const skillMatchThreshold= document.getElementById('skill-match-threshold');

    const autoBidInput       = document.getElementById('auto-bid');
    const bidOptions         = document.getElementById('bid-options');
    const bidStrategyInput   = document.getElementById('bid-strategy');
    const deliveryDaysInput  = document.getElementById('delivery-days');
    const coverModeAI        = document.getElementById('cover-mode-ai');
    const coverModeTemplate  = document.getElementById('cover-mode-template');
    const coverLetterBox     = document.getElementById('cover-letter-box');
    const coverLetterInput   = document.getElementById('cover-letter');
    const autoSubmitInput    = document.getElementById('auto-submit');
    const toggleBtn          = document.getElementById('toggle-btn');
    const scanStatus         = document.getElementById('scan-status');

    // Matches tab
    const jobList            = document.getElementById('job-list');
    const matchCountLabel    = document.getElementById('match-count-label');
    const openAllBtn         = document.getElementById('open-all-btn');
    const seenCount          = document.getElementById('seen-count');
    const matchCount         = document.getElementById('match-count');
    const clearHistoryBtn    = document.getElementById('clear-history');

    // Log tab
    const logContainer       = document.getElementById('log-container');
    const clearLogBtn        = document.getElementById('clear-log-btn');

    // Global
    const cleanAllBtn        = document.getElementById('clean-all-btn');

    let isRunning = false;

    // ── Tab switching ─────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    // ── Conditional UI ────────────────────────────────────────────────────────
    oneTimeScanInput.addEventListener('change', updateIntervalVisibility);
    autoBidInput.addEventListener('change', updateBidOptionsVisibility);
    skillMatchEnabled.addEventListener('change', updateSkillMatchVisibility);

    function updateSkillMatchVisibility() {
        skillMatchOptions.style.display = skillMatchEnabled.checked ? 'block' : 'none';
    }

    function updateIntervalVisibility() {
        intervalContainer.style.display = oneTimeScanInput.checked ? 'none' : 'flex';
        if (!isRunning) {
            toggleBtn.textContent = oneTimeScanInput.checked ? '▶ Start One-Time Sweep' : '▶ Start Monitoring';
        }
    }

    function updateBidOptionsVisibility() {
        bidOptions.style.display = autoBidInput.checked ? 'flex' : 'none';
        if (autoBidInput.checked) bidOptions.style.flexDirection = 'column';
    }

    function updateCoverLetterVisibility() {
        coverLetterBox.style.display = coverModeTemplate.checked ? 'block' : 'none';
    }

    document.querySelectorAll('input[name="cover-mode"]').forEach(r =>
        r.addEventListener('change', updateCoverLetterVisibility)
    );

    // ── Load saved state ──────────────────────────────────────────────────────
    chrome.storage.local.get(['settings', 'matches', 'stats', 'isRunning', 'logs'], (res) => {
        const s = res.settings || {};

        if (s.excludeCountry)    excludeCountryInput.value = s.excludeCountry;
        if (s.maxAge    != null) maxAgeInput.value         = s.maxAge;
        if (s.matchLimit!= null) matchLimitInput.value     = s.matchLimit;
        if (s.minInterval!=null) minIntervalInput.value    = s.minInterval;
        if (s.maxInterval!=null) maxIntervalInput.value    = s.maxInterval;
        if (s.myKeywords)        myKeywordsInput.value      = s.myKeywords;
        if (s.skillMatchThreshold != null) skillMatchThreshold.value = s.skillMatchThreshold;
        if (s.deliveryDays!=null) deliveryDaysInput.value  = s.deliveryDays;
        if (s.coverLetter)       coverLetterInput.value    = s.coverLetter;
        if (s.bidStrategy)       bidStrategyInput.value    = s.bidStrategy;

        // Cover mode radio
        if (s.coverMode === 'ai') {
            coverModeAI.checked = true;
        } else {
            coverModeTemplate.checked = true;
        }
        autoSubmitInput.checked  = !!s.autoSubmit;

        oneTimeScanInput.checked = !!s.oneTimeScan;
        skillMatchEnabled.checked = !!s.skillMatchEnabled;
        autoBidInput.checked     = !!s.autoBid;

        updateIntervalVisibility();
        updateSkillMatchVisibility();
        updateBidOptionsVisibility();
        updateCoverLetterVisibility();

        if (res.matches && res.matches.length > 0) renderMatches(res.matches);
        if (res.stats) {
            seenCount.textContent  = `Seen: ${res.stats.seen  || 0}`;
            matchCount.textContent = `Matched: ${res.stats.matched || 0}`;
        }
        if (res.logs && res.logs.length > 0) {
            logContainer.innerHTML = '';
            res.logs.forEach(l => appendLog(l, false));
        }
        isRunning = res.isRunning || false;
        updateUIState();
    });

    // ── Start / Stop ──────────────────────────────────────────────────────────
    toggleBtn.addEventListener('click', () => {
        isRunning = !isRunning;

        const settings = {
            excludeCountry:   excludeCountryInput.value.trim(),
            maxAge:           parseInt(maxAgeInput.value)        || 30,
            matchLimit:       parseInt(matchLimitInput.value)    || 5,
            oneTimeScan:      oneTimeScanInput.checked,
            minInterval:      parseInt(minIntervalInput.value)   || 120,
            maxInterval:      parseInt(maxIntervalInput.value)   || 240,

            skillMatchEnabled: skillMatchEnabled.checked,
            myKeywords:        myKeywordsInput.value.trim(),
            skillMatchThreshold: parseInt(skillMatchThreshold.value) || 70,

            autoBid:          autoBidInput.checked,
            bidStrategy:      bidStrategyInput.value || 'min',
            coverMode:        coverModeAI.checked ? 'ai' : 'template',
            autoSubmit:       autoSubmitInput.checked,
            deliveryDays:     parseInt(deliveryDaysInput.value)  || 1,
            coverLetter:      coverLetterInput.value.trim()
        };

        chrome.storage.local.set({ isRunning, settings }, () => {
            updateUIState();
            chrome.runtime.sendMessage({ action: isRunning ? 'start' : 'stop' });
        });
    });

    // ── Clear history ─────────────────────────────────────────────────────────
    clearHistoryBtn.addEventListener('click', () => {
        chrome.storage.local.set({ matches: [], stats: { seen: 0, matched: 0 } }, () => {
            renderMatches([]);
            seenCount.textContent  = 'Seen: 0';
            matchCount.textContent = 'Matched: 0';
        });
    });

    // ── Clear log ─────────────────────────────────────────────────────────────
    clearLogBtn.addEventListener('click', () => {
        chrome.storage.local.set({ logs: [] });
        logContainer.innerHTML = '<p class="log-entry">Log cleared.</p>';
    });

    // ── Global Clean All ──────────────────────────────────────────────────────
    cleanAllBtn.addEventListener('click', () => {
        chrome.storage.local.set({ 
            logs: [], 
            matches: [], 
            stats: { seen: 0, matched: 0 },
            seenIds: {} // clear memory of seen jobs too!
        }, () => {
            logContainer.innerHTML = '<p class="log-entry">Everything cleared (Logs, Matches, Memory).</p>';
            renderMatches([]);
            seenCount.textContent  = 'Seen: 0';
            matchCount.textContent = 'Matched: 0';
        });
    });

    // ── Background messages ───────────────────────────────────────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'updateMatches') renderMatches(msg.matches);
        if (msg.action === 'updateStats') {
            seenCount.textContent  = `Seen: ${msg.stats.seen  || 0}`;
            matchCount.textContent = `Matched: ${msg.stats.matched || 0}`;
        }
        if (msg.action === 'log' || msg.action === 'log_broadcast') {
            appendLog(msg.text || msg.logEntry);
        }
        if (msg.action === 'stop') { isRunning = false; updateUIState(); }
        if (msg.action === 'status') {
            scanStatus.textContent = msg.text;
            scanStatus.className   = 'status-badge';
            if (msg.text.toLowerCase().includes('scan') || msg.text.toLowerCase().includes('opening')) {
                scanStatus.classList.add('scanning');
            } else if (msg.text.toLowerCase().includes('break')) {
                scanStatus.classList.add('on-break');
            }
        }
    });

    // ── UI state helper ───────────────────────────────────────────────────────
    function updateUIState() {
        if (isRunning) {
            toggleBtn.textContent = '■ Stop Radar';
            toggleBtn.classList.add('active');
            scanStatus.textContent = 'Scanning...';
            scanStatus.className   = 'status-badge scanning';
        } else {
            const isOneTime = oneTimeScanInput.checked;
            toggleBtn.textContent = isOneTime ? '▶ Start One-Time Sweep' : '▶ Start Monitoring';
            toggleBtn.classList.remove('active');
            scanStatus.textContent = 'Idle';
            scanStatus.className   = 'status-badge';
        }
    }

    // ── Render matches ────────────────────────────────────────────────────────
    function renderMatches(matches) {
        if (!matches || matches.length === 0) {
            jobList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎯</div>
                    <p>No matches yet.<br>Start the radar to begin.</p>
                </div>`;
            matchCountLabel.textContent = 'No matches yet';
            openAllBtn.style.display = 'none';
            return;
        }

        matchCountLabel.textContent = `${matches.length} match${matches.length > 1 ? 'es' : ''}`;
        openAllBtn.style.display = 'block';

        jobList.innerHTML = matches.map(job => {
            const skills    = (job.skills || []).slice(0, 4);
            const tagsHtml  = skills.map(s => `<span class="job-tag">${s}</span>`).join('');
            const age       = job.ageText ? `${job.ageText}` : 'Just now';

            return `
                <li class="job-item">
                    <a href="${job.url}" target="_blank" class="job-title">${job.title}</a>
                    ${tagsHtml ? `<div class="job-tags">${tagsHtml}</div>` : ''}
                    <div class="job-meta">
                        <span>⏱ ${age}</span>
                    </div>
                </li>`;
        }).join('');

        openAllBtn.onclick = () => matches.forEach(j => chrome.tabs.create({ url: j.url }));
    }

    // ── Log helper ────────────────────────────────────────────────────────────
    function appendLog(text, prepend = true) {
        if (!text) return;
        const p   = document.createElement('p');
        p.className = 'log-entry';

        // Color coding
        const lower = text.toLowerCase();
        if (lower.includes('match') || lower.includes('✅')) p.classList.add('match');
        else if (lower.includes('skip') || lower.includes('break') || lower.includes('filter')) p.classList.add('warn');
        else if (lower.includes('error') || lower.includes('fail'))  p.classList.add('error');

        // Add timestamp if not already present
        p.textContent = text.startsWith('[') ? text : `[${now()}] ${text}`;

        if (prepend) {
            logContainer.prepend(p);
        } else {
            logContainer.appendChild(p);
        }

        // Keep max 100 entries
        while (logContainer.children.length > 100) logContainer.removeChild(logContainer.lastChild);
    }

    function now() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
});
