'use strict';

/**
 * The era matrix — five fossilized development environments.
 *
 * Each record is one "time capsule": an EOL Ubuntu release paired with the
 * runtime that ruled that year. `buildDockerfile()` in templates.js renders
 * one Dockerfile per era from these records, so adding a sixth era is just a
 * matter of appending an object here.
 *
 * Why bind mounts instead of `git clone` inside the image?
 *   Because cloning from inside a 2014 image means a 2014 OpenSSL
 *   (1.0.1f) negotiating TLS with a 2020s GitHub — the DST Root CA X3
 *   expiry alone breaks it. We clone on the host with a modern git and
 *   bind-mount the result, so the era only has to run the code, not reach
 *   the modern network.
 *
 * `sourcesFix`: Ubuntu moves EOL releases off archive.ubuntu.com onto
 *   old-releases.ubuntu.com roughly a year after support ends. As of 2026
 *   that covers everything here except Jammy (EOL 2027).
 */

const ERAS = [
  {
    id: 'trusty-python34',
    dockerfileName: 'trusty-python34.Dockerfile',
    title: 'Ubuntu 14.04 (Trusty Tahr) + Python 3.4',
    short: 'Ubuntu 14.04 · Python 3.4',
    year: 2014,
    nickname: 'the pip-it-and-pray era',
    glyph: '🦕',
    family: 'python',
    runtime: 'python3.4 · pip 1.5',
    base: 'ubuntu:14.04',
    sourcesFix: true,
    apt: ['python3', 'python3-pip', 'python3-dev', 'build-essential'],
    runtimeSetup: [
      '# Python 3.4 is the floor of the matrix. pytest>=5 dropped it for good,',
      '# so we try to pre-install the last compatible pytest line. This is best',
      '# effort: a 2014 OpenSSL negotiating with a modern PyPI may simply refuse.',
      'RUN pip3 install --disable-pip-version-check "pytest<5" \\\n || echo "tmci: pytest<5 not installable here — pass --test-command for stdlib tests"',
    ].join('\n'),
    hint:
      'pytest 5+ dropped Python 3.4 and modern pip dropped it even earlier. ' +
      'For stdlib-only projects pass --test-command "python3 -m unittest discover -v".',
  },
  {
    id: 'xenial-node6',
    dockerfileName: 'xenial-node6.Dockerfile',
    title: 'Ubuntu 16.04 (Xenial Xerus) + Node.js 6',
    short: 'Ubuntu 16.04 · Node.js 6',
    year: 2016,
    nickname: 'the left-pad winter',
    glyph: '💾',
    family: 'node',
    runtime: 'node 6 · npm 3',
    base: 'ubuntu:16.04',
    sourcesFix: true,
    apt: ['build-essential'],
    runtimeSetup: [
      "# Xenial's own repos only carry Node 4.2.6, so Node 6 comes from the",
      '# NodeSource setup_6.x channel. If that channel is ever retired, the',
      '# fallback installs whatever ancient nodejs apt still offers.',
      'RUN curl -fsSL https://deb.nodesource.com/setup_6.x | bash - \\\n && apt-get install -y --no-install-recommends nodejs \\\n && rm -rf /var/lib/apt/lists/* \\\n || (apt-get update \\\n && apt-get install -y --no-install-recommends nodejs npm)',
      'RUN node --version && npm --version',
    ].join('\n'),
    hint:
      'Node 6 reached EOL in 2019. Packages using ^ engines ranges or ES2018+ ' +
      'syntax fail here — which is exactly the point of the capsule.',
  },
  {
    id: 'bionic-node8',
    dockerfileName: 'bionic-node8.Dockerfile',
    title: 'Ubuntu 18.04 (Bionic Beaver) + Node.js 8',
    short: 'Ubuntu 18.04 · Node.js 8',
    year: 2018,
    nickname: 'the async/await spring',
    glyph: '🧭',
    family: 'node',
    runtime: 'node 8 · npm 6',
    base: 'ubuntu:18.04',
    sourcesFix: true,
    apt: ['build-essential'],
    runtimeSetup: [
      '# Node 8 via the NodeSource setup_8.x channel. Bionic itself ships',
      '# nodejs 8.10, so the fallback is the distro package if NodeSource is gone.',
      'RUN curl -fsSL https://deb.nodesource.com/setup_8.x | bash - \\\n && apt-get install -y --no-install-recommends nodejs \\\n && rm -rf /var/lib/apt/lists/* \\\n || (apt-get update \\\n && apt-get install -y --no-install-recommends nodejs)',
      'RUN node --version && npm --version',
    ].join('\n'),
    hint:
      'Node 8 was the LTS bridge into modern async code; npm 6 from setup_8.x ' +
      'understands lockfileVersion 1. Native modules may need python3/g++ present.',
  },
  {
    id: 'focal-php74',
    dockerfileName: 'focal-php74.Dockerfile',
    title: 'Ubuntu 20.04 (Focal Fossa) + PHP 7.4',
    short: 'Ubuntu 20.04 · PHP 7.4',
    year: 2020,
    nickname: 'the typed-property thaw',
    glyph: '🧊',
    family: 'php',
    runtime: 'php 7.4-cli · composer 1.10',
    base: 'ubuntu:20.04',
    sourcesFix: true,
    apt: [
      'php7.4-cli',
      'php7.4-mbstring',
      'php7.4-xml',
      'php7.4-curl',
      'php7.4-sqlite3',
      'composer',
    ],
    runtimeSetup: [
      '# PHP 7.4 + composer 1.10 straight from Focal universe. The php7.4-* CLI',
      '# extensions cover the usual legacy-framework bootstrap: mbstring/xml for',
      '# PHPUnit, curl for Composer, sqlite for in-memory test databases.',
      'RUN php --version && composer --version',
    ].join('\n'),
    hint:
      'PHP 7.4 was the last of the 7.x line. composer 1.10 from Focal universe ' +
      'still resolves most pre-8 packages without a network proxy dance.',
  },
  {
    id: 'jammy-python310',
    dockerfileName: 'jammy-python310.Dockerfile',
    title: 'Ubuntu 22.04 (Jammy Jellyfish) + Python 3.10',
    short: 'Ubuntu 22.04 · Python 3.10',
    year: 2022,
    nickname: 'the match-case summer',
    glyph: '🛰️',
    family: 'python',
    runtime: 'python3.10 · pip 22',
    base: 'ubuntu:22.04',
    sourcesFix: false,
    apt: ['python3', 'python3-pip', 'python3-venv', 'python3-dev', 'build-essential'],
    runtimeSetup: [
      '# Jammy ships Python 3.10 as "python3" and (unlike 23.04+) still permits',
      '# plain `pip3 install` into the system Python. python3-venv is included',
      '# for projects that prefer to keep their eggs in their own basket.',
      'RUN python3 --version && pip3 --version',
    ].join('\n'),
    hint:
      'The "modern baseline" of the matrix — if it fails here too, the bug is ' +
      'you, not the era.',
  },
];

const BY_ID = new Map(ERAS.map((era) => [era.id, era]));

/**
 * Look up an era by id, throwing a friendly error that lists every
 * available era (so a typo teaches you the vocabulary instead of just 1-ing).
 */
function getEra(id) {
  const era = BY_ID.get(id);
  if (!era) {
    throw new Error(
      `unknown era "${id}"\navailable eras: ${ERAS.map((e) => e.id).join(', ')}`
    );
  }
  return era;
}

module.exports = { ERAS, getEra };
