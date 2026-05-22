(async function () {
    // ── Stealth Shield ───────────────────────────────────────────────────────
    try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    } catch (e) {}

    console.log('[FL Radar] Search Scraper Active');

    // ── Guard 1: Is radar even running? (Fastest check — no message needed) ──
    const runCheck = await chrome.storage.local.get(['isRunning']).catch(() => ({}));
    if (!runCheck.isRunning) {
        console.log('[FL Radar] Radar is OFF — ignoring this tab.');
        return;
    }

    // ── Guard 2: Is this a tab opened by the extension? ──────────────────────
    const response = await chrome.runtime.sendMessage({ action: 'isThisMyTab' }).catch(() => ({}));
    if (!response || !response.isMyTab) {
        console.log('[FL Radar] Manual tab detected — scraper inactive.');
        return;
    }

    // ── Wait for real page (bypass Cloudflare / SSR) ─────────────────────────
    chrome.runtime.sendMessage({ action: 'log', text: 'Waiting for project listings...' }).catch(() => {});
    await waitForRealPage();
    chrome.runtime.sendMessage({ action: 'log', text: 'Page ready. Simulating human...' }).catch(() => {});

    // ── Human scroll simulation ──────────────────────────────────────────────
    const simTime   = Math.floor(Math.random() * 4001) + 7000; // 7-11s
    const startTime = Date.now();

    async function naturalScroll() {
        const totalH  = document.body.scrollHeight;
        const target  = totalH * (0.80 + Math.random() * 0.20);
        const jump    = Math.max(window.innerHeight * 0.2, target / 3);

        while (Date.now() - startTime < simTime) {
            window.scrollBy({ top: jump, behavior: 'smooth' });
            await sleep(Math.random() * 900 + 2500);
            // occasional micro-jitter
            window.scrollBy({ top: Math.random() > 0.5 ? 3 : -3, behavior: 'auto' });
            // occasional small scroll back
            if (Math.random() > 0.75) {
                window.scrollBy({ top: -window.innerHeight * 0.1, behavior: 'smooth' });
                await sleep(1200);
            }
            if ((window.scrollY + window.innerHeight) >= target - 50 &&
                (Date.now() - startTime) > 5000) break;
        }
    }

    await naturalScroll();
    chrome.runtime.sendMessage({ action: 'log', text: 'Simulation done. Extracting projects...' }).catch(() => {});

    const { settings } = await chrome.storage.local.get(['settings']);
    const maxAge         = settings?.maxAge         || 30;   // minutes

    // ── Identify project cards ───────────────────────────────────────────────
    // Freelancer.com selectors (multiple fallbacks for different layouts)
    const cardSelectors = [
        'fl-project-contest-card',
        '.ProjectCard',
        '.JobSearchCard',
        '[data-jhid]',
        'fl-search-project-card',
        '.search-project-card'
    ];

    let cards = [];
    for (const sel of cardSelectors) {
        cards = Array.from(document.querySelectorAll(sel));
        if (cards.length > 0) break;
    }

    // Angular component fallback — walk by structure
    if (cards.length === 0) {
        // Try any element that has a child with "project" in its href
        const links = document.querySelectorAll('a[href*="/projects/"]');
        const parents = new Set();
        links.forEach(l => {
            const parent = l.closest('article') || l.closest('li') || l.closest('[class*="card"]') || l.parentElement;
            if (parent) parents.add(parent);
        });
        cards = Array.from(parents);
    }

    chrome.runtime.sendMessage({ action: 'log', text: `Found ${cards.length} project cards.` }).catch(() => {});

    const results = [];

    cards.forEach((card) => {
        try {
            // ── Title & URL ────────────────────────────────────────────────
            let titleEl = card.querySelector('h2.Title-text');
            if (!titleEl) {
                titleEl = card.querySelector(
                    'a.JobSearchCard-primary-heading-link, ' +
                    '[data-jhid] h2 a, ' +
                    'h2 a[href*="/projects/"], ' +
                    'a[href*="/projects/"]'
                );
            }
            if (!titleEl) return;

            const title = titleEl.innerText?.trim();

            // The new layout wraps the whole card in an <a> tag
            let href = '';
            const linkWrapper = card.closest('a[href*="/projects/"]');
            if (linkWrapper) {
                href = linkWrapper.getAttribute('href');
            } else if (titleEl.tagName.toLowerCase() === 'a') {
                href = titleEl.getAttribute('href');
            }

            const url = href.startsWith('http') ? href : `https://www.freelancer.com${href}`;
            if (!title || !href) return;

            // Extract ID from URL slug or data attribute
            const idFromHref  = href.match(/\/projects\/[^/]+\/([^/?#]+)/)?.[1] || '';
            const idFromData  = card.getAttribute('data-jhid') || card.getAttribute('data-id') || '';
            const id          = idFromData || idFromHref || title.slice(0, 40);

            // ── Age / Time ─────────────────────────────────────────────────
            const ageEl  = card.querySelector(
                'fl-relative-time, ' +
                '.JobSearchCard-primary-heading time, ' +
                '[data-jhid] time, ' +
                'time, ' +
                '.time-left, ' +
                '[class*="time"]'
            );
            const ageText = ageEl?.getAttribute('datetime') || ageEl?.innerText?.trim() || '';
            const minutes = parseAgeToMinutes(ageText);
            if (minutes !== null && minutes > maxAge) return; // Too old

            // ── Skills / Tags ──────────────────────────────────────────────
            const skillEls = card.querySelectorAll(
                'fl-tag .Content, ' +
                '.JobSearchCard-primary-tagsLink, ' +
                '[class*="tag"] a, ' +
                '[class*="skill"] a'
            );
            const skills = Array.from(skillEls).map(s => s.innerText?.trim()).filter(Boolean);

            results.push({
                id, title, url, skills, ageText
            });

        } catch (e) { console.warn('[FL Radar] Card parse error:', e); }
    });

    chrome.runtime.sendMessage({ action: 'log', text: `Extracted ${results.length} valid projects.` }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'jobFound', jobs: results }).catch(() => {});

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function parseAgeToMinutes(text) {
        if (!text) return null;
        const t = text.toLowerCase();
        if (t.includes('second') || t.includes('just now') || t.includes('moments')) return 0;
        if (t.includes('minute') || t.includes('min')) {
            const m = t.match(/(\d+)/);
            return m ? parseInt(m[1]) : 1;
        }
        if (t.includes('hour') || t.includes('day') || t.includes('week') || t.includes('month')) return 9999;
        // ISO datetime
        if (text.includes('T')) {
            const posted = new Date(text);
            if (!isNaN(posted)) return Math.floor((Date.now() - posted.getTime()) / 60000);
        }
        return null;
    }


    async function waitForRealPage() {
        return new Promise((resolve) => {
            const check = () => {
                const hasCards = !!(
                    document.querySelector('.JobSearchCard') ||
                    document.querySelector('[data-jhid]') ||
                    document.querySelector('fl-search-project-card') ||
                    document.querySelector('a[href*="/projects/"]')
                );
                const isChallenge = !!(
                    document.querySelector('#challenge-form') ||
                    document.title.includes('Just a moment')
                );
                return hasCards && !isChallenge;
            };
            if (check()) return resolve();
            const obs = new MutationObserver(() => { if (check()) { obs.disconnect(); resolve(); } });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(); }, 60000);
        });
    }
})();
