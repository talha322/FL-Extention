(async function () {
    // ── Stealth Shield ───────────────────────────────────────────────────────
    try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages',  { get: () => ['en-US', 'en'] });
    } catch (e) {}

    console.log('[FL Radar] Bid Agent Active');

    // ── Manual Fill Listener (Always Active) ─────────────────────────────────
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'manualFill') {
            chrome.storage.local.get(['settings'], async (res) => {
                const settings = res.settings;
                if (!settings) return;
                console.log('[FL Radar] Manual fill triggered');
                
                const title = extractTitle();
                const budgetInfo = extractBudget();
                const skills = extractSkills();
                
                await fillThreeFields(settings, title, budgetInfo, skills);
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] ✅ Manual Fill completed.' }).catch(() => {});
            });
        }
    });

    // ── Guard 1: Is radar even running? ──────────────────────────────────────
    const runCheck = await chrome.storage.local.get(['isRunning']).catch(() => ({}));
    if (!runCheck.isRunning) {
        console.log('[FL Radar] Radar is OFF — bid agent inactive.');
        return;
    }

    // ── Guard 2: Is this a tab opened by the extension? ──────────────────────
    const response = await chrome.runtime.sendMessage({ action: 'isThisMyTab' }).catch(() => ({}));
    if (!response || !response.isMyTab) {
        console.log('[FL Radar] Manual tab — bid agent inactive.');
        return;
    }

    chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] Project page detected. Waiting for content...' }).catch(() => {});

    // ── Wait for project page to load ────────────────────────────────────────
    await waitForProjectPage();
    await sleep(2500);

    // ── Extract project info ─────────────────────────────────────────────────
    const id         = extractProjectId();
    const title      = extractTitle();
    const budgetInfo = extractBudget();
    const skills     = extractSkills();
    const country    = extractCountry();

    chrome.runtime.sendMessage({
        action: 'log',
        text: `[Bid Agent] "${title}" | Budget: ${budgetInfo.text} | Client: ${country || 'Unknown'}`
    }).catch(() => {});

    // ── Load settings ────────────────────────────────────────────────────────
    const { settings } = await chrome.storage.local.get(['settings']);


    // ─── Skip helper: notify background + self-close this tab ────────────────
    async function skipJob(logText, data = {}) {
        chrome.runtime.sendMessage({ action: 'log', text: logText }).catch(() => {});
        await chrome.runtime.sendMessage({
            action: 'bidDone',
            id, title, url: window.location.href,
            budget: bVal, budgetText: budgetInfo.text, skills,
            skipped: true,
            ...data
        }).catch(() => {});
        await sleep(500);
        window.close();
    }

    // ── Budget validation ────────────────────────────────────────────────────
    const minBudget = settings?.minBudget || 0;
    const maxBudget = settings?.maxBudget || 999999;
    const bVal      = budgetInfo.value;

    if (bVal > 0 && (bVal < minBudget || bVal > maxBudget)) {
        await skipJob(`[Bid Agent] Skipped — budget $${bVal} out of range ($${minBudget}-$${maxBudget}).`);
        return;
    }

    // ── Client Filters ───────────────────────────────────────────────────────
    const clientRating = extractClientRating();
    const reviewCount  = extractReviewCount();
    const verifs       = extractVerifications();

    let skipReason = '';

    if (settings?.minRating > 0 && clientRating < settings.minRating) {
        skipReason = `Rating ${clientRating} < ${settings.minRating}`;
    } else if (settings?.minReviews > 0 && reviewCount < settings.minReviews) {
        skipReason = `Reviews ${reviewCount} < ${settings.minReviews}`;
    } else if (settings?.reqPayment && !verifs.payment) {
        skipReason = `Payment not verified`;
    } else if (settings?.reqDeposit && !verifs.deposit) {
        skipReason = `Deposit not made`;
    } else if (settings?.reqIdentity && !verifs.identity) {
        skipReason = `Identity not verified`;
    } else if (settings?.reqPhone && !verifs.phone) {
        skipReason = `Phone not verified`;
    } else if (settings?.reqEmail && !verifs.email) {
        skipReason = `Email not verified`;
    }

    if (skipReason) {
        await skipJob(`[Bid Agent] Skipped — Client Filter: ${skipReason}`);
        return;
    }

    // ── Country Exclude validation ─────────────────────────────────────────────────
    if (settings?.excludeCountry && country) {
        const excludeList = settings.excludeCountry.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
        const isExcluded = excludeList.some(ex => country.toLowerCase().includes(ex));
        if (isExcluded) {
            await skipJob(`[Bid Agent] Skipped — Country "${country}" is in exclude list.`);
            return;
        }
    }

    // ── Auto-bid: fill form ────────────────────────────────────────────────
    if (settings?.autoBid) {
        chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] Auto-bid ON — waiting 5s for full page load...' }).catch(() => {});
        await sleep(5000); // wait for Angular form to fully render

        await fillThreeFields(settings, title, budgetInfo, skills);

        // ── STEP 4: Auto-Submit OR Notify ────────────────────────────────────────────
        if (settings.autoSubmit) {
            await sleep(1000);
            const submitBtn = document.querySelector('.BidFormBtn button[data-color="primary"], button.ButtonElement[data-color="primary"]');
            if (submitBtn) {
                submitBtn.click();
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] ✅ Place Bid clicked automatically!' }).catch(() => {});
                await sleep(2000);
            } else {
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] ⚠️ Submit button not found.' }).catch(() => {});
            }
            chrome.runtime.sendMessage({
                action: 'bidDone',
                id, title, url: window.location.href,
                budget: bVal, budgetText: budgetInfo.text, skills
            }).catch(() => {});
        } else {
            chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] Form filled. 🔔 Please review and submit manually!' }).catch(() => {});
            for (let i = 0; i < 3; i++) {
                chrome.runtime.sendMessage({ action: 'playSound' }).catch(() => {});
                await sleep(1000);
            }
            await sleep(2000);
            chrome.runtime.sendMessage({
                action: 'bidDone',
                id, title, url: window.location.href,
                budget: bVal, budgetText: budgetInfo.text, skills,
                manualReview: true
            }).catch(() => {});
        }

    } else {
        chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] Auto-bid OFF — project opened for manual review.' }).catch(() => {});
        await sleep(1000);
        chrome.runtime.sendMessage({
            action: 'bidDone',
            id, title, url: window.location.href,
            budget: bVal, budgetText: budgetInfo.text, skills
        }).catch(() => {});
    }

    // ─── Helper Functions ────────────────────────────────────────────────────

    async function fillThreeFields(settings, title, budgetInfo, skills) {
        const bidSection = document.querySelector(
            '#place-bid, .BidFormInputGroup, [class*="BidForm"], [class*="bid-box"]'
        );
        if (bidSection) {
            bidSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(1000);
        }

        // ── STEP 1: Calculate bid amount from strategy ────────────────────────────
        const budgetNums = (budgetInfo.text || '').replace(/,/g, '').match(/[\d.]+/g);
        let bidAmount = budgetInfo.value;
        if (budgetNums && budgetNums.length >= 2) {
            const bMin = parseFloat(budgetNums[0]);
            const bMax = parseFloat(budgetNums[budgetNums.length - 1]);
            if (settings.bidStrategy === 'min') bidAmount = bMin;
            else if (settings.bidStrategy === 'max') bidAmount = bMax;
            else bidAmount = Math.round((bMin + bMax) / 2);
        }

        chrome.runtime.sendMessage({ action: 'log', text: `[Bid Agent] Filling bid amount: ${bidAmount}...` }).catch(() => {});
        await fillBidAmount(bidAmount);
        await sleep(500);
        // Verify
        const amountInput = document.querySelector('#bidAmountInput, input[placeholder*="bid amount"]');
        const amountVerified = amountInput && parseFloat(amountInput.value) === bidAmount;
        chrome.runtime.sendMessage({
            action: 'log',
            text: amountVerified
                ? `[Bid Agent] ✅ Bid amount confirmed: ${amountInput.value}`
                : `[Bid Agent] ⚠️ Bid amount may not have set (field shows: ${amountInput?.value || 'N/A'})`
        }).catch(() => {});

        await sleep(300);

        // ── STEP 2: Delivery days ─────────────────────────────────────────────
        if (settings.deliveryDays) {
            chrome.runtime.sendMessage({ action: 'log', text: `[Bid Agent] Filling delivery days: ${settings.deliveryDays}...` }).catch(() => {});
            await fillDeliveryDays(settings.deliveryDays);
            await sleep(500);
            const daysInput = document.querySelector('#periodInput, input[placeholder*="number of days"]');
            const daysVerified = daysInput && parseInt(daysInput.value) === parseInt(settings.deliveryDays);
            chrome.runtime.sendMessage({
                action: 'log',
                text: daysVerified
                    ? `[Bid Agent] ✅ Delivery days confirmed: ${daysInput.value}`
                    : `[Bid Agent] ⚠️ Delivery days may not have set (field shows: ${daysInput?.value || 'N/A'})`
            }).catch(() => {});
        }

        await sleep(1000);

        // ── STEP 3: Cover letter ────────────────────────────────────────────────
        if (settings.coverMode === 'ai') {
            const aiBtn = document.querySelector('.WriteMyBid button, app-bid-description-button button');
            if (aiBtn) {
                aiBtn.click();
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] 🤖 AI Write My Bid clicked. Waiting 10s for generation...' }).catch(() => {});
                await sleep(10000);
                const textarea = document.querySelector('#descriptionTextArea, textarea[placeholder*="proposal"]');
                const aiGenerated = textarea && textarea.value.trim().length > 50;
                chrome.runtime.sendMessage({
                    action: 'log',
                    text: aiGenerated
                        ? `[Bid Agent] ✅ AI cover letter generated (${textarea.value.length} chars)`
                        : `[Bid Agent] ⚠️ AI generation may have failed or is still loading`
                }).catch(() => {});
            } else {
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] ⚠️ AI button not found.' }).catch(() => {});
            }
        } else {
            const template = settings.coverLetter || '';
            if (template) {
                const filledLetter = template
                    .replace(/\{PROJECT_NAME\}/gi, title)
                    .replace(/\{BUDGET\}/gi, budgetInfo.text)
                    .replace(/\{SKILLS\}/gi, skills.slice(0, 3).join(', '));
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] Filling cover letter...' }).catch(() => {});
                await fillCoverLetter(filledLetter);
                await sleep(500);
                const textarea = document.querySelector('#descriptionTextArea, textarea[placeholder*="proposal"]');
                const letterVerified = textarea && textarea.value.trim().length > 10;
                chrome.runtime.sendMessage({
                    action: 'log',
                    text: letterVerified
                        ? `[Bid Agent] ✅ Cover letter confirmed (${textarea.value.length} chars)`
                        : `[Bid Agent] ⚠️ Cover letter may not have set`
                }).catch(() => {});
            } else {
                chrome.runtime.sendMessage({ action: 'log', text: '[Bid Agent] No cover letter template set, skipping.' }).catch(() => {});
            }
        }
    }

    // ─── Helper Functions ────────────────────────────────────────────────────

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function extractProjectId() {
        const m = window.location.pathname.match(/\/projects\/[^/]+\/([^/?#]+)/);
        return m ? m[1] : window.location.pathname.replace(/\//g, '-');
    }

    function extractTitle() {
        const el = document.querySelector(
            'h1.PageProjectViewInfo-title, ' +
            '.ProjectViewHeader-title h1, ' +
            '[class*="project-title"] h1, ' +
            'h1.title, h1'
        );
        return el?.innerText?.trim() || document.title;
    }

    function extractBudget() {
        const el = document.querySelector(
            '.PageProjectViewInfo-budget, ' +
            '[class*="budget"], ' +
            '[class*="Budget"], ' +
            '[class*="price"]'
        );
        const text = el?.innerText?.trim() || '';
        const nums = text.replace(/,/g, '').match(/[\d.]+/g);
        if (!nums) return { text, value: 0 };
        const vals = nums.map(parseFloat).filter(n => !isNaN(n));
        const avg  = vals.length >= 2 ? Math.round((vals[0] + vals[vals.length - 1]) / 2) : (vals[0] || 0);
        return { text, value: avg };
    }

    function extractSkills() {
        const els = document.querySelectorAll(
            '.PageProjectViewInfo-skills a, ' +
            '[class*="skill"] a, ' +
            '[class*="tag"] a'
        );
        return Array.from(els).map(e => e.innerText?.trim()).filter(Boolean);
    }

    function extractCountry() {
        // Try multiple selectors for client location/country
        const els = document.querySelectorAll(
            'fl-flag img, ' +
            'fl-flag, ' +
            '[itemprop="addressCountry"], ' +
            '[itemprop="addressLocality"], ' +
            '.ProjectViewClient-location, ' +
            '[class*="ClientLocation"], ' +
            '[class*="client-location"], ' +
            'fl-country-flag, ' +
            '[class*="Country"]'
        );
        
        for (let el of els) {
            let text = el.innerText?.trim();
            const tag = el.tagName.toLowerCase();

            if (!text && (tag === 'fl-country-flag' || tag === 'fl-flag')) {
                text = el.getAttribute('title') || el.getAttribute('alt');
                if (!text) {
                    const img = el.querySelector('img');
                    if (img) text = img.getAttribute('title') || img.getAttribute('alt');
                }
            } else if (!text && tag === 'img') {
                text = el.getAttribute('title') || el.getAttribute('alt');
            }

            // Cleanup "Flag of GERMANY" -> "GERMANY"
            if (text && text.toLowerCase().startsWith('flag of ')) {
                text = text.substring(8).trim();
            }

            // Some elements might have "City, Country", so let's just grab the whole string
            // and the matcher will do an .includes() check.
            if (text && text.length > 2) {
                return text;
            }
        }
        return '';
    }

    function extractClientRating() {
        const el = document.querySelector('fl-rating .ValueBlock, [class*="Rating"] .ValueBlock');
        return el ? parseFloat(el.innerText?.trim()) || 0 : 0;
    }

    function extractReviewCount() {
        const el = document.querySelector('fl-review-count span, [class*="ReviewCount"] span');
        return el ? parseInt(el.innerText?.trim()) || 0 : 0;
    }

    function extractVerifications() {
        const verifs = {
            payment: false,
            deposit: false,
            identity: false,
            phone: false,
            email: false
        };

        const wrappers = document.querySelectorAll('app-user-verifications [mattooltip], .PageProjectViewClient-verifications [mattooltip]');
        
        if (wrappers.length > 0) {
            wrappers.forEach(el => {
                const tip = (el.getAttribute('mattooltip') || '').toLowerCase();
                // In the new DOM, the tooltip text changes. If unverified, it contains "not".
                if (tip.includes('payment method') && !tip.includes('not ')) verifs.payment = true;
                if (tip.includes('deposit') && !tip.includes('not ')) verifs.deposit = true;
                if (tip.includes('identity') && !tip.includes('not ')) verifs.identity = true;
                if (tip.includes('phone number') && !tip.includes('not ')) verifs.phone = true;
                if (tip.includes('email') && !tip.includes('not ')) verifs.email = true;
            });
        } else {
            // Fallback for older DOM structures where the text only appears if verified
            const text = document.body.innerText.toLowerCase();
            verifs.payment  = text.includes('payment verified');
            verifs.deposit  = text.includes('deposit made');
            verifs.identity = text.includes('identity verified');
            verifs.phone    = text.includes('phone verified');
            verifs.email    = text.includes('email verified');
        }

        return verifs;
    }

    async function fillBidAmount(amount) {
        const input = document.querySelector(
            '#bidAmountInput, ' +
            'input[name="amount"], ' +
            'input[placeholder*="bid"], ' +
            'input[placeholder*="Bid"], ' +
            'input[placeholder*="amount"], ' +
            'input[placeholder*="Amount"]'
        );
        if (!input) return false;
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
        // Angular reactive forms need nativeElement value + input event
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, String(amount));
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        return true;
    }

    async function fillDeliveryDays(days) {
        const input = document.querySelector(
            '#periodInput, ' +
            'input[name="period"], ' +
            'input[placeholder*="day"], ' +
            'input[placeholder*="Day"]'
        );
        if (!input) return false;
        input.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, String(days));
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        return true;
    }

    async function fillCoverLetter(text) {
        const textarea = document.querySelector(
            '#descriptionTextArea, ' +
            'textarea[name="description"], ' +
            'textarea[placeholder*="proposal"], ' +
            'textarea[placeholder*="cover"], ' +
            'textarea'
        );
        if (!textarea) return false;
        textarea.focus();
        // Angular textarea needs nativeElement setter
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeTextareaSetter.call(textarea, text);
        textarea.dispatchEvent(new Event('input',  { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.style.border = '2px solid #00c4b4';
        setTimeout(() => { textarea.style.border = ''; }, 3000);
        textarea.blur();
        return true;
    }

    async function waitForProjectPage() {
        return new Promise((resolve) => {
            const check = () => !!(
                document.querySelector('#place-bid, #bid-section') ||
                document.querySelector('[class*="BidBox"]') ||
                document.querySelector('[class*="PageProjectView"]') ||
                document.querySelector('h1') ||
                document.querySelector('main')
            );
            if (check()) return resolve();
            const obs = new MutationObserver(() => { if (check()) { obs.disconnect(); resolve(); } });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(); }, 30000);
        });
    }
})();
