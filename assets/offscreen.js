// assets/offscreen.js
chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === 'playPing') {
        playPing();
    }
});

async function playPing() {
    // Standard AudioContext initialization
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // IMPORTANT: Resume context if browser suspended it (common autoplay policy side effect)
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); // Sharp 1000Hz / B5 note
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + 0.05); // Faster attack
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6); // Slightly longer decay

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.7);
    
    // Close context after playback to free resources
    setTimeout(() => audioCtx.close(), 1500);
}
