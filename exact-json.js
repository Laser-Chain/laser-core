'use strict';

// JSON from the native node contains uint64 photon values. Preserve integers
// that JSON.parse would otherwise round before they cross the IPC boundary.
function parseExactJSON(text) {
  return JSON.parse(String(text).replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (token[0] === '"' || /[.eE]/.test(token)) return token;
    const value = BigInt(token);
    return value > 9007199254740991n || value < -9007199254740991n
      ? '"' + token + '"' : token;
  }));
}

module.exports = { parseExactJSON };
