'use strict';
const fs = require('fs');
const path = require('path');
const { miningIntensity } = require('./ipc-validation');

function loadMiningPreferences(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof value.intensity !== 'number') throw new Error('Missing intensity');
    return { intensity: miningIntensity(value.intensity), saved: true };
  } catch (_) {
    return { intensity: 100, saved: false };
  }
}

function saveMiningPreferences(file, intensity) {
  const value = miningIntensity(intensity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ intensity: value }) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function researchPaused(intensity) {
  return miningIntensity(intensity) <= 25;
}

module.exports = { loadMiningPreferences, saveMiningPreferences, researchPaused };
