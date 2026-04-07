'use strict';

// Semi Semantic Versioning - mirrors Python imgtool/version.py
const VERSION_RE = /^([1-9]\d*|0)(\.([1-9]\d*|0)(\.([1-9]\d*|0)(\+([1-9]\d*|0))?)?)?$/;

function decodeVersion(text) {
  const m = VERSION_RE.exec(text);
  if (!m) {
    throw new Error(
      'Invalid version number, should be maj.min.rev+build with later parts optional'
    );
  }
  return {
    major:    m[1] ? parseInt(m[1], 10) : 0,
    minor:    m[3] ? parseInt(m[3], 10) : 0,
    revision: m[5] ? parseInt(m[5], 10) : 0,
    build:    m[7] ? parseInt(m[7], 10) : 0,
  };
}

module.exports = { decodeVersion };
