'use strict';

const messages = [
  { text: 'Starting node…', delay: 0 },
  { text: 'Binding RPC interface…', delay: 800 },
  { text: 'Connecting to peers…', delay: 1600 },
  { text: 'Synchronizing blocks…', delay: 2400 },
  { text: 'Preparing wallet interface…', delay: 3000 }
];

const statusElement = document.getElementById('splash-status');
const progressElement = document.getElementById('splash-progress');
let hasLiveStatus = false;

for (const message of messages) {
  setTimeout(() => {
    if (!hasLiveStatus) statusElement.textContent = message.text;
  }, message.delay);
}

window.laserSplash.onStatus(status => {
  hasLiveStatus = true;
  statusElement.textContent = String(status.text || 'Starting node…');
  progressElement.style.animation = 'none';
  const percent = Number.isFinite(status.progress) ? status.progress : 0;
  progressElement.style.width = Math.max(0, Math.min(100, percent)) + '%';
});
