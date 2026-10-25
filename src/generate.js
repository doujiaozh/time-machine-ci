'use strict';

/**
 * Orchestrates a generation run: resolve the repository, obtain the source,
 * detect the test command, render the bundle, write it to disk, and report.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { ERAS, getEra } = require('./eras');
const { detect } = require('./detect');
const {
  buildDockerfile,
  buildCompose,
  buildEnv,
  buildRunSh,
  buildRunPs1,
  buildGeneratedReadme,
} = require('./templates');

const COPY_EXCLUDE = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  'results',
  'time-machine-output',
]);

/** "https://github.com/o/Name.git", "o/Name", "D:\\repos\\Name" -> "Name" */
function repoNameFromUrl(url) {
  const cleaned = String(url)
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'project';
}

/** Shell-safe project name (also lands inside run.sh / run.ps1). */
function sanitizeName(name) {
  const cleaned = String(name)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'project';
}

/** docker-compose-safe slug (service names, image tags, project name). */
function slugify(name) {
  const slug = sanitizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** `owner/name` shorthand -> https://github.com/owner/name (unless local). */
function normalizeRepoInput(raw, cwd) {
  const s = String(raw).trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s) && !fs.existsSync(path.resolve(cwd, s))) {
    return 'https://github.com/' + s;
  }
  if (/^github\.com\//.test(s)) return 'https://' + s;
  return s;
}

function shallowClone(url, dest) {
  try {
    execFileSync('git', ['clone', '--depth', '1', '--', url, dest], { stdio: 'ignore' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'git is required to clone a repository.\n' +
          'Install git, or point the CLI at an existing checkout: time-machine-ci <path> --no-clone'
      );
    }
    throw new Error(
      `failed to clone ${url}\n` +
        'Check the URL and network access — or clone it yourself and run:\n' +
        '  time-machine-ci <local-path> --no-clone'
    );
  }
}

function copySource(src, dest, root) {
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (candidate) => {
      const abs = path.resolve(candidate);
      if (abs === root || abs.startsWith(rootWithSep)) return false; // never recurse into the output
      return !COPY_EXCLUDE.has(path.basename(abs));
    },
  });
}

function generate(opts) {
  const repo = normalizeRepoInput(opts.repo, process.cwd());
  const rawName = opts.name || repoNameFromUrl(repo);
  const name = sanitizeName(rawName);
  const slug = slugify(rawName);
  const outRoot = path.resolve(opts.out || 'time-machine-output');
  const projectDir = path.join(outRoot, slug);
  const relativeDir = path.relative(process.cwd(), projectDir) || '.';

  // ── era selection ─────────────────────────────────────────────────────
  const requested = String(opts.eras || ERAS.map((e) => e.id).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new Error('no eras selected — --eras needs at least one era id');
  }
  const seen = new Set();
  const eras = requested.filter((id) => (seen.has(id) ? false : seen.add(id))).map(getEra);

  // ── guard before touching the filesystem ──────────────────────────────
  if (
    !opts.force &&
    fs.existsSync(projectDir) &&
    fs.readdirSync(projectDir).length > 0
  ) {
    throw new Error(
      `output directory already exists and is not empty:\n  ${projectDir}\n` +
        'pass --force to overwrite, or --out <dir> to write somewhere else'
    );
  }

  // ── obtain the source ─────────────────────────────────────────────────
  let scratch = null;
  let srcDir;
  let sourceLabel;
  if (opts.noClone) {
    srcDir = path.resolve(repo);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`--no-clone: source directory does not exist: ${srcDir}`);
    }
    sourceLabel = `copied → src/ (from ${srcDir})`;
  } else if (opts.dryRun) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'time-machine-ci-'));
    srcDir = path.join(scratch, 'src');
    shallowClone(repo, srcDir);
    sourceLabel = `cloned (shallow, scratch) → ${srcDir}`;
  } else {
    fs.mkdirSync(projectDir, { recursive: true });
    srcDir = path.join(projectDir, 'src');
    shallowClone(repo, srcDir);
    sourceLabel = 'cloned (shallow) → src/';
  }

  // ── detect the test command ───────────────────────────────────────────
  const detected = opts.testCommand
    ? { family: 'custom', command: opts.testCommand, note: 'overridden with --test-command' }
    : detect(srcDir);
  const ctx = {
    name,
    slug,
    repo,
    testCommand: detected.command,
    detectionNote: detected.note,
  };

  // ── render the bundle ─────────────────────────────────────────────────
  const files = [];
  for (const era of eras) {
    files.push([`eras/${era.dockerfileName}`, buildDockerfile(era, ctx)]);
  }
  files.push(['docker-compose.yml', buildCompose(eras, ctx)]);
  files.push(['.env', buildEnv(eras, ctx)]);
  files.push(['run.sh', buildRunSh(eras, ctx)]);
  files.push(['run.ps1', buildRunPs1(eras, ctx)]);
  files.push(['GENERATED.md', buildGeneratedReadme(eras, ctx)]);

  if (opts.dryRun) {
    console.log(`\n🕰  time-machine-ci — dry run for ${repo}`);
    console.log(`    project : ${name}`);
    console.log(`    output  : ${projectDir} (nothing will be written)`);
    console.log(`    source  : ${sourceLabel}`);
    console.log(`    tests   : ${ctx.testCommand}`);
    console.log(`    detection: ${ctx.detectionNote}\n`);
    for (const [rel, content] of files) {
      console.log(`  would write ${rel} (${Buffer.byteLength(content)} bytes)`);
    }
    console.log(`\n${files.length} files planned — rerun without --dry-run to write them.`);
    if (scratch) {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    return 0;
  }

  // ── write ─────────────────────────────────────────────────────────────
  fs.mkdirSync(path.join(projectDir, 'eras'), { recursive: true });
  for (const [rel, content] of files) {
    fs.writeFileSync(path.join(projectDir, rel), content);
  }
  if (opts.noClone) {
    copySource(srcDir, path.join(projectDir, 'src'), projectDir);
  }
  try {
    fs.chmodSync(path.join(projectDir, 'run.sh'), 0o755);
  } catch {
    /* Windows: chmod is a no-op; the runner can still be `sh run.sh` */
  }

  // ── report ────────────────────────────────────────────────────────────
  console.log('');
  console.log('🕰  time-machine-ci — era-matrix generator\n');
  console.log(`    repository : ${repo}`);
  console.log(`    project    : ${name}`);
  console.log(`    output     : ${projectDir}`);
  console.log(`    source     : ${sourceLabel}`);
  console.log(`    tests      : ${ctx.testCommand}`);
  console.log(`    detection  : ${ctx.detectionNote}`);
  console.log(`\n✚  eras (${eras.length}):`);
  for (const era of eras) {
    console.log(
      `   ${era.glyph} ${era.year}  ${era.id.padEnd(18)} ${era.short}`
    );
  }

  if (detected.family === 'unknown') {
    console.log(
      '\n⚠  no tests detected — every era will build but trivially pass.\n' +
        '   Pass --test-command to make the matrix meaningful.'
    );
  }
  const generic = ['unknown', 'custom', 'make'];
  if (!generic.includes(detected.family)) {
    for (const era of eras) {
      if (era.family !== detected.family) {
        console.log(
          `⚠  era "${era.id}" is a ${era.family} capsule, but this looks like a ${detected.family} project —\n` +
            `    expect a failure there. (That is information, not a bug — or pass --test-command.)`
        );
      }
    }
  }

  console.log('\n✔  generated:');
  console.log(
    '    docker-compose.yml · eras/*.Dockerfile ×' +
      `${eras.length} · run.sh · run.ps1 · .env · GENERATED.md` +
      (opts.noClone ? ' · src/' : '')
  );
  console.log('\nnext steps:\n');
  console.log(`    cd ${relativeDir}`);
  console.log('    ./run.sh          # macOS / Linux / Git Bash / WSL');
  console.log('    .\\run.ps1         # Windows PowerShell\n');

  return 0;
}

module.exports = { generate, repoNameFromUrl, normalizeRepoInput, sanitizeName, slugify };
