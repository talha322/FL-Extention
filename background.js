// background.js — Freelancer Job Radar

const ALARM_SCAN     = 'fl-radar-scan';
const ALARM_NEXT_JOB = 'fl-radar-next-job';

const SEARCH_URL = 'https://www.freelancer.com/search/projects?projectSort=latest';

let sessionMatchCount  = 0;
let activeSearchTabId  = null;
let isOnBreak          = false;

// ─── Tab cleanup ──────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get(['openedTabIds'], (res) => {
        const openedTabIds = (res.openedTabIds || []).filter(id => id !== tabId);
        chrome.storage.local.set({ openedTabIds });
    });
});

// ─── Install defaults ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        isRunning:          false,
        matches:            [],
        seenIds:            {},
        stats:              { seen: 0, matched: 0 },
        logs:               [],
        jobQueue:           [],
        isProcessingQueue:  false,
        scanCount:      0,
        cycleStartTime: 0
    });
});

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'start':
            sendLog('Radar Started');
            sessionMatchCount = 0;
            isOnBreak = false;
            chrome.storage.local.set({
                jobQueue: [], isProcessingQueue: false,
                scanCount: 0, cycleStartTime: 0
            }, () => {
                // Only start AFTER storage is confirmed written
                startScanning();
            });
            break;

        case 'stop':
            sendLog('Radar Stopped');
            stopScanning();
            break;

        case 'log':
            sendLog(request.message || request.text || 'Empty Log');
            break;

        case 'playSound':
            playSound();
            break;

        case 'jobFound':
            addToQueue(request.jobs);
            break;

        case 'bidDone':
            handleBidDone(request, sender.tab?.id);
            break;

        case 'isThisMyTab':
            chrome.storage.local.get(['openedTabIds', 'isRunning'], (res) => {
                // If radar is NOT running, NEVER treat any tab as ours
                if (!res.isRunning) {
                    sendResponse({ isMyTab: false });
                    return;
                }
                const openedTabIds = res.openedTabIds || [];
                const isMyTab = openedTabIds.includes(sender.tab?.id) || sender.tab?.id === activeSearchTabId;
                sendResponse({ isMyTab });
            });
            return true;
    }
    return true;
});

// ─── Logging ──────────────────────────────────────────────────────────────────
function sendLog(text) {
    if (!text) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logEntry = `[${time}] ${text}`;
    chrome.runtime.sendMessage({ action: 'log_broadcast', logEntry }).catch(() => {});
    chrome.storage.local.get(['logs'], (res) => {
        const logs = [logEntry, ...(res.logs || [])].slice(0, 100);
        chrome.storage.local.set({ logs });
    });
}

// ─── Scanning ─────────────────────────────────────────────────────────────────
function startScanning() { performScan(); }

function stopScanning() {
    chrome.alarms.clearAll();
    // Clear openedTabIds so recycled Chrome tab IDs don't ghost-trigger the scraper
    chrome.storage.local.set({ isProcessingQueue: false, jobQueue: [], openedTabIds: [] });
    activeSearchTabId = null;
    if (activeSearchTabId) {
        chrome.tabs.remove(activeSearchTabId).catch(() => {});
        activeSearchTabId = null;
    }
}

function scheduleNextScan(min, max) {
    if (isOnBreak) return;
    chrome.storage.local.get(['cycleStartTime'], (res) => {
        const elapsed   = Math.round((Date.now() - (res.cycleStartTime || Date.now())) / 1000);
        const target    = Math.floor(Math.random() * (max - min + 1) + min);
        const delay     = Math.max(30, target - elapsed);
        chrome.alarms.create(ALARM_SCAN, { delayInMinutes: delay / 60 });
        sendLog(`Next scan in ${delay}s`);
    });
}

// ─── Alarm Dispatcher ─────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_SCAN) {
        performScan();
    } else if (alarm.name === ALARM_NEXT_JOB) {
        executeNextJobInQueue();
    }
});

// ─── seenIds Cleanup ──────────────────────────────────────────────────────────
async function cleanupSeenIds(settings) {
    const res      = await chrome.storage.local.get(['seenIds']);
    const seenIds  = res.seenIds || {};
    const maxAgeMs = (settings.maxAge || 30) * 60 * 1000;
    const threshold = Date.now() - maxAgeMs;
    let removed = 0;
    const cleaned = {};
    for (const [id, ts] of Object.entries(seenIds)) {
        if (ts > threshold) { cleaned[id] = ts; } else { removed++; }
    }
    if (removed > 0) {
        await chrome.storage.local.set({ seenIds: cleaned });
        sendLog(`[Memory] Pruned ${removed} old jobs.`);
    }
}

// ─── Core Scan ────────────────────────────────────────────────────────────────
async function performScan() {
    const res = await chrome.storage.local.get(['isRunning', 'settings', 'scanCount']);
    if (!res.isRunning) return;

    // Ghost Mode: coffee break
    let currentScanCount = (res.scanCount || 0) + 1;
    const breakTrigger   = Math.floor(Math.random() * 6) + 10;

    if (currentScanCount >= breakTrigger && !res.settings?.oneTimeScan) {
        const breakMins = Math.floor(Math.random() * 21) + 10; // 10-30 min
        isOnBreak = true;
        sendLog(`[Ghost Mode] Coffee break for ${breakMins} min.`);
        chrome.runtime.sendMessage({ action: 'status', text: `Break (${breakMins}m)` }).catch(() => {});
        chrome.alarms.create(ALARM_SCAN, { delayInMinutes: breakMins });
        chrome.storage.local.set({ scanCount: 0 });
        return;
    }

    isOnBreak = false;
    chrome.storage.local.set({ scanCount: currentScanCount });
    await cleanupSeenIds(res.settings || {});

    const settings = res.settings || {};

    if (!settings) {
        sendLog('Settings not found.');
        return;
    }

    chrome.storage.local.set({ cycleStartTime: Date.now() });
    sessionMatchCount = 0;

    sendLog(`Scan #${currentScanCount}: All Projects`);
    chrome.runtime.sendMessage({ action: 'status', text: 'Scanning: All Projects' }).catch(() => {});

    sendLog(`[URL] Opening: ${SEARCH_URL}`);

    chrome.tabs.create({ url: SEARCH_URL, active: false }, (tab) => {
        activeSearchTabId = tab.id;
        chrome.storage.local.get(['openedTabIds'], (r) => {
            const openedTabIds = [...(r.openedTabIds || []), tab.id];
            chrome.storage.local.set({ openedTabIds });
        });
    });
}

// ─── Queue Management ─────────────────────────────────────────────────────────
async function addToQueue(jobs) {
    const res = await chrome.storage.local.get(['seenIds', 'jobQueue', 'isProcessingQueue', 'settings', 'matches']);
    const { seenIds, isProcessingQueue, settings, matches } = res;
    let jobQueue = res.jobQueue || [];

    let newJobs = 0;
    for (const job of jobs) {
        if (newJobs >= 15) break;
        const isSeen = !!seenIds[job.id];
        const isDupTitle = (matches || []).some(m =>
            m.title.trim().toLowerCase() === job.title.trim().toLowerCase()
        );
        if (!isSeen && !isDupTitle) {
            seenIds[job.id] = Date.now();
            jobQueue.push(job);
            chrome.storage.local.set({ [`jobInfo_${job.id}`]: job });
            newJobs++;
        }
    }

    await chrome.storage.local.set({ seenIds, jobQueue });

    if (newJobs > 0) {
        sendLog(`Found ${jobs.length} projects. Queuing ${newJobs} new.`);
        if (!isProcessingQueue) processQueue(true);
    } else {
        sendLog('No new projects found.');
        onBatchComplete();
    }
}

async function onBatchComplete() {
    const res = await chrome.storage.local.get(['settings', 'isRunning', 'jobQueue']);
    if (!res.isRunning) return;
    if (res.jobQueue && res.jobQueue.length > 0) return;

    if (activeSearchTabId) {
        chrome.tabs.remove(activeSearchTabId).catch(() => {});
        activeSearchTabId = null;
    }

    if (res.settings?.oneTimeScan) {
        sendLog('[Sweep] Scan complete. Stopping.');
        chrome.storage.local.set({ isRunning: false });
        chrome.runtime.sendMessage({ action: 'stop' }).catch(() => {});
        stopScanning();
        return;
    }

    sendLog('[Cycle Complete] Resting...');
    chrome.runtime.sendMessage({ action: 'status', text: 'Monitoring (Idle)' }).catch(() => {});
    scheduleNextScan(res.settings?.minInterval || 150, res.settings?.maxInterval || 250);
}

async function processQueue(immediate = false) {
    const res = await chrome.storage.local.get(['isRunning', 'jobQueue']);
    if (!res.isRunning || !res.jobQueue || res.jobQueue.length === 0) {
        chrome.storage.local.set({ isProcessingQueue: false, jobQueue: [] });
        onBatchComplete();
        return;
    }
    await chrome.storage.local.set({ isProcessingQueue: true });
    if (immediate) {
        executeNextJobInQueue();
        return;
    }
    const wait = Math.floor(Math.random() * 5001) + 7000;
    sendLog(`Waiting ${Math.round(wait / 1000)}s before opening project...`);
    chrome.alarms.create(ALARM_NEXT_JOB, { delayInMinutes: wait / 60000 });
}

async function executeNextJobInQueue() {
    const res = await chrome.storage.local.get(['isRunning', 'jobQueue']);
    if (!res.isRunning || !res.jobQueue || res.jobQueue.length === 0) return;

    const job       = res.jobQueue[0];
    const remaining = res.jobQueue.slice(1);
    await chrome.storage.local.set({ jobQueue: remaining });

    sendLog(`Opening: ${job.title}`);
    chrome.tabs.create({ url: job.url, active: false }, (tab) => {
        if (tab) {
            chrome.storage.local.get(['openedTabIds'], (r) => {
                chrome.storage.local.set({ openedTabIds: [...(r.openedTabIds || []), tab.id] });
            });
        }
    });
}

// ─── Bid Result Handler ───────────────────────────────────────────────────────
async function handleBidDone(data, tabId) {
    const res = await chrome.storage.local.get(['settings', 'matches', 'stats', `jobInfo_${data.id}`]);
    const { settings, matches, stats } = res;
    const jobInfo = res[`jobInfo_${data.id}`] || {};

    if (data.skipped) {
        chrome.storage.local.remove(`jobInfo_${data.id}`);
        chrome.tabs.remove(tabId).catch(() => {});
        processQueue(true);
        return;
    }

    // manualReview: form filled, tab stays open, queue continues
    if (data.manualReview) {
        chrome.storage.local.remove(`jobInfo_${data.id}`);
        // Do NOT close the tab — user will submit manually
        processQueue(true);
        return;
    }

    const budget     = data.budget || 0;

    // Save match
    stats.matched = (stats.matched || 0) + 1;
    const newMatch = {
        id:        data.id,
        url:       data.url,
        title:     data.title,
        budget:    data.budgetText || `$${budget}`,
        skills:    data.skills || [],
        ageText:   jobInfo.ageText || 'Just now',
        timestamp: Date.now()
    };

    const updatedMatches = [newMatch, ...(matches || [])].slice(0, 50);
    chrome.storage.local.set({ matches: updatedMatches, stats });
    chrome.runtime.sendMessage({ action: 'updateMatches', matches: updatedMatches }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'updateStats', stats }).catch(() => {});

    playSound();
    chrome.tabs.update(tabId, { active: true });
    sendLog(`✅ MATCH! ${data.title} — ${data.budgetText || 'Budget N/A'}`);

    chrome.storage.local.remove(`jobInfo_${data.id}`);

    sessionMatchCount++;
    const matchLimit = settings?.matchLimit || 5;
    if (sessionMatchCount >= matchLimit) {
        if (settings?.oneTimeScan) {
            sendLog(`Match limit reached (${matchLimit}). Stopping.`);
            stopScanning();
            chrome.storage.local.set({ isRunning: false });
            chrome.runtime.sendMessage({ action: 'stop' }).catch(() => {});
        } else {
            sendLog(`Cycle limit reached. Resting until next interval...`);
            chrome.storage.local.set({ jobQueue: [] });
            onBatchComplete();
        }
        return;
    }

    setTimeout(() => {
        chrome.storage.local.get(['isRunning'], (r) => { if (r.isRunning) processQueue(); });
    }, 6000);
}

// ─── Sound ────────────────────────────────────────────────────────────────────
async function playSound() {
    try {
        if (!(await chrome.offscreen.hasDocument?.())) {
            await chrome.offscreen.createDocument({
                url: 'assets/offscreen.html',
                reasons: ['AUDIO_PLAYBACK'],
                justification: 'New project notification'
            });
        }
        chrome.runtime.sendMessage({ action: 'playPing', offscreen: true }).catch(() => {});
    } catch (e) {}
}
