'use strict';

/**
 * Best-effort test-command detection.
 *
 * The goal is not to be clever — it is to be *era-portable*. We deliberately
 * prefer era-appropriate commands (npm install && npm test, setup.py test)
 * over modern tooling that a 2014 runtime cannot even parse.
 */

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function has(dir, names) {
  return names.some((n) => fs.existsSync(path.join(dir, n)));
}

function setupCfgDeclaresPytest(dir) {
  const file = path.join(dir, 'setup.cfg');
  try {
    const text = fs.readFileSync(file, 'utf8');
    return /^\[(tool:)?pytest\]/m.test(text);
  } catch {
    return false;
  }
}

function makefileHasTestTarget(dir) {
  const candidates = ['Makefile', 'makefile', 'GNUmakefile'];
  for (const name of candidates) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      if (/^test\s*:/m.test(text)) return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

/**
 * @returns {{family: string, command: string, note: string}}
 */
function detect(dir) {
  const stats = fs.statSync(dir);
  if (!stats.isDirectory()) {
    throw new Error(`source is not a directory: ${dir}`);
  }

  // ── Node ──────────────────────────────────────────────────────────────
  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg && typeof pkg === 'object') {
    const test = pkg.scripts && typeof pkg.scripts.test === 'string' ? pkg.scripts.test : '';
    if (test && !/no test specified/i.test(test)) {
      return {
        family: 'node',
        command: 'npm install && npm test',
        note: `package.json scripts.test = "${test}"`,
      };
    }
    return {
      family: 'node',
      command: 'npm install && echo \'⚠ package.json has no "test" script — all eras trivially pass\' && exit 0',
      note: 'package.json present, but no usable scripts.test',
    };
  }

  // ── Python ────────────────────────────────────────────────────────────
  const hasRequirements = has(dir, ['requirements.txt']);
  const hasPytest =
    has(dir, ['pytest.ini', 'tox.ini', 'conftest.py']) || setupCfgDeclaresPytest(dir);
  if (hasPytest) {
    const pip = hasRequirements ? 'pip3 install -r requirements.txt && ' : '';
    return {
      family: 'python',
      command: `${pip}pip3 install -q pytest && python3 -m pytest -q`,
      note: 'pytest configuration detected (pytest.ini / tox.ini / conftest.py / [tool:pytest])',
    };
  }
  if (has(dir, ['setup.py']) || has(dir, ['pyproject.toml'])) {
    const pip = hasRequirements ? 'pip3 install -r requirements.txt && ' : '';
    return {
      family: 'python',
      command: `${pip}python3 setup.py test`,
      note: 'setuptools-style project — running the era-appropriate setup.py test',
    };
  }

  // ── PHP ───────────────────────────────────────────────────────────────
  const composer = readJson(path.join(dir, 'composer.json'));
  if (composer && typeof composer === 'object') {
    if (composer.scripts && typeof composer.scripts.test === 'string') {
      return {
        family: 'php',
        command: 'composer install --no-interaction && composer test',
        note: `composer.json scripts.test = "${composer.scripts.test}"`,
      };
    }
    return {
      family: 'php',
      command: 'composer install --no-interaction && vendor/bin/phpunit',
      note: 'composer.json present — assuming phpunit lives in vendor/bin',
    };
  }

  // ── Make ──────────────────────────────────────────────────────────────
  if (has(dir, ['Makefile', 'makefile', 'GNUmakefile']) && makefileHasTestTarget(dir)) {
    return {
      family: 'make',
      command: 'make test',
      note: 'Makefile with a test target',
    };
  }

  return {
    family: 'unknown',
    command:
      "echo 'time-machine-ci: no test command detected — pass --test-command to set one' && exit 0",
    note: 'no recognized project manifest found',
  };
}

module.exports = { detect };
