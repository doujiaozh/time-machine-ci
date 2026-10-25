'use strict';

/**
 * time-machine-ci self-test suite — zero dependencies, `node test/run-tests.js`.
 *
 * Strategy: build tiny fixture repositories in a temp dir (including one real
 * local git repo to exercise the clone path), run the CLI as a subprocess,
 * and assert on the generated bundle. When docker / bash / pwsh happen to be
 * installed we additionally syntax-check everything we can; when they are not,
 * those checks report SKIP instead of failing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'index.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let passed = 0;
let failed = 0;
let skipped = 0;

function section(name) {
  console.log(`\n▶ ${name}`);
}
function check(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${msg}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${msg}`);
  }
}
function skip(msg) {
  skipped += 1;
  console.log(`  ⏭️  ${msg} (skipped)`);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'time-machine-ci-test-'));

function runCli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || TMP,
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function writeFixture(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

function makeNodeFixture(dir) {
  writeFixture(dir, {
    'package.json': JSON.stringify(
      {
        name: 'fossil-app',
        version: '1.0.0',
        scripts: { test: 'node --check index.js && node e2e.js' },
      },
      null,
      2
    ),
    'index.js': 'module.exports = { era: "any" };\n',
    'e2e.js': 'const { era } = require("./index.js");\nif (!era) process.exit(1);\nconsole.log("ok:" + era);\n',
    'README.md': '# fossil-app\n',
  });
}

function makePythonFixture(dir) {
  writeFixture(dir, {
    'setup.py': 'from setuptools import setup\nsetup(name="fossil-py", version="1.0.0")\n',
    'requirements.txt': 'requests==2.9.0\n',
    'pytest.ini': '[pytest]\ntestpaths = tests\n',
  });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'test_fossil.py'), 'def test_era():\n    assert True\n');
}

function makeMakeFixture(dir) {
  writeFixture(dir, {
    Makefile: 'test:\n\t@echo "make-test-was-here"\n',
    'main.c': 'int main(void){return 0;}\n',
  });
}

function gitInit(dir) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'tmci-test',
    GIT_AUTHOR_EMAIL: 'test@tmci.local',
    GIT_COMMITTER_NAME: 'tmci-test',
    GIT_COMMITTER_EMAIL: 'test@tmci.local',
  };
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', env });
  run('init', '--quiet');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'fixture');
}

function tryExec(file, args) {
  try {
    execFileSync(file, args, { stdio: 'pipe', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const ALL_ERAS = ['trusty-python34', 'xenial-node6', 'bionic-node8', 'focal-php74', 'jammy-python310'];

// ═══════════════════════════════════════════════════════════════════════════
// 1. CLI plumbing
// ═══════════════════════════════════════════════════════════════════════════
section('CLI plumbing');

{
  const r = runCli([]);
  check(r.status !== 0, 'no arguments exits non-zero');
  check(/repository argument is required/.test(r.stderr), 'no-args error mentions the missing repository');
}
{
  const r = runCli(['--version']);
  check(r.status === 0, '--version exits 0');
  check(r.stdout.includes(PKG.version), `--version prints ${PKG.version}`);
}
{
  const r = runCli(['--help']);
  check(r.status === 0, '--help exits 0');
  check(/USAGE/.test(r.stdout) && /--eras/.test(r.stdout), '--help shows usage with --eras');
  check(ALL_ERAS.every((id) => r.stdout.includes(id)), '--help lists all five eras');
}
{
  const r = runCli(['--bogus']);
  check(r.status !== 0, 'unknown option exits non-zero');
  check(/unknown option/.test(r.stderr), 'unknown option is reported');
}
{
  const r = runCli(['--eras']);
  check(r.status !== 0, 'option without a value exits non-zero');
  check(/requires a value/.test(r.stderr), 'missing value is reported');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Unit checks on pure helpers
// ═══════════════════════════════════════════════════════════════════════════
section('pure helpers');

{
  const { repoNameFromUrl, normalizeRepoInput, slugify } = require('../src/generate');
  check(repoNameFromUrl('https://github.com/octocat/Hello-World.git') === 'Hello-World', 'repoNameFromUrl strips .git');
  check(repoNameFromUrl('https://github.com/o/repo/') === 'repo', 'repoNameFromUrl strips trailing slash');
  check(repoNameFromUrl('D:\\repos\\Legacy App') === 'Legacy App', 'repoNameFromUrl handles Windows paths');
  const cwd = process.cwd();
  check(
    normalizeRepoInput('octocat/Hello-World', cwd) === 'https://github.com/octocat/Hello-World',
    'owner/name shorthand expands to github.com'
  );
  check(
    normalizeRepoInput('github.com/o/r', cwd) === 'https://github.com/o/r',
    'github.com/... gets an https scheme'
  );
  const weird = slugify('My_Cool$$ Repo/2');
  check(/^[a-z0-9-]+$/.test(weird), `slugify output is compose-safe ("${weird}")`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Full generation from a Node fixture
// ═══════════════════════════════════════════════════════════════════════════
section('generation — node fixture (all five eras)');

const nodeFixture = path.join(TMP, 'fossil-app');
makeNodeFixture(nodeFixture);

const nodeOut = path.join(TMP, 'out-node');
{
  const r = runCli([nodeFixture, '--no-clone', '--out', nodeOut]);
  check(r.status === 0, 'CLI exits 0 for a node fixture');
  check(/npm install && npm test/.test(r.stdout), 'report shows the detected test command');
}

const nodeProject = path.join(nodeOut, 'fossil-app');
{
  check(fs.existsSync(path.join(nodeProject, 'docker-compose.yml')), 'docker-compose.yml was written');
  check(fs.existsSync(path.join(nodeProject, '.env')), '.env was written');
  check(fs.existsSync(path.join(nodeProject, 'run.sh')), 'run.sh was written');
  check(fs.existsSync(path.join(nodeProject, 'run.ps1')), 'run.ps1 was written');
  check(fs.existsSync(path.join(nodeProject, 'GENERATED.md')), 'GENERATED.md was written');
  check(fs.existsSync(path.join(nodeProject, 'src', 'package.json')), 'source was copied into src/');
  for (const id of ALL_ERAS) {
    check(fs.existsSync(path.join(nodeProject, 'eras', `${id}.Dockerfile`)), `eras/${id}.Dockerfile written`);
  }
}
{
  const compose = fs.readFileSync(path.join(nodeProject, 'docker-compose.yml'), 'utf8');
  check(!compose.includes('\t'), 'compose file contains no tabs');
  check(/^name: fossil-app-time-machine$/m.test(compose), 'compose declares a project name');
  for (const id of ALL_ERAS) {
    check(new RegExp(`^  ${id}:`, 'm').test(compose), `compose defines service "${id}"`);
  }
  check(compose.includes('./src:/repo'), 'compose bind-mounts ./src at /repo');
  check((compose.match(/build:/g) || []).length === ALL_ERAS.length, `compose has ${ALL_ERAS.length} build blocks`);
}
{
  const env = fs.readFileSync(path.join(nodeProject, '.env'), 'utf8');
  check(/^TEST_COMMAND=npm install && npm test$/m.test(env), '.env records TEST_COMMAND=npm install && npm test');
  check(env.includes('TIME_MACHINE_ERAS=trusty-python34,xenial-node6,bionic-node8,focal-php74,jammy-python310'), '.env lists all eras');
}
{
  const trusty = fs.readFileSync(path.join(nodeProject, 'eras', 'trusty-python34.Dockerfile'), 'utf8');
  check(/^FROM ubuntu:14\.04$/m.test(trusty), 'trusty Dockerfile uses ubuntu:14.04');
  check(trusty.includes('old-releases.ubuntu.com'), 'trusty Dockerfile rewrites apt sources to old-releases');
  check(trusty.includes('python3-pip'), 'trusty Dockerfile installs python3-pip');
  check(trusty.includes('"pytest<5"'), 'trusty Dockerfile pins pytest<5');
  check(trusty.includes('"npm install && npm test"'), 'trusty Dockerfile bakes the test command into CMD');
}
{
  const xenial = fs.readFileSync(path.join(nodeProject, 'eras', 'xenial-node6.Dockerfile'), 'utf8');
  check(/^FROM ubuntu:16\.04$/m.test(xenial), 'xenial Dockerfile uses ubuntu:16.04');
  check(xenial.includes('deb.nodesource.com/setup_6.x'), 'xenial Dockerfile pulls Node 6 from NodeSource');
  check(xenial.includes('build-essential'), 'xenial Dockerfile includes build-essential for native modules');
}
{
  const bionic = fs.readFileSync(path.join(nodeProject, 'eras', 'bionic-node8.Dockerfile'), 'utf8');
  check(/^FROM ubuntu:18\.04$/m.test(bionic), 'bionic Dockerfile uses ubuntu:18.04');
  check(bionic.includes('deb.nodesource.com/setup_8.x'), 'bionic Dockerfile pulls Node 8 from NodeSource');
}
{
  const focal = fs.readFileSync(path.join(nodeProject, 'eras', 'focal-php74.Dockerfile'), 'utf8');
  check(/^FROM ubuntu:20\.04$/m.test(focal), 'focal Dockerfile uses ubuntu:20.04');
  check(focal.includes('php7.4-cli') && focal.includes('composer'), 'focal Dockerfile installs php7.4 + composer');
}
{
  const jammy = fs.readFileSync(path.join(nodeProject, 'eras', 'jammy-python310.Dockerfile'), 'utf8');
  check(/^FROM ubuntu:22\.04$/m.test(jammy), 'jammy Dockerfile uses ubuntu:22.04');
  check(!jammy.includes('old-releases.ubuntu.com'), 'jammy (not EOL yet) skips the old-releases rewrite');
  check(jammy.includes('python3-pip') && jammy.includes('python3-venv'), 'jammy Dockerfile installs python3 + pip + venv');
}
{
  const runSh = fs.readFileSync(path.join(nodeProject, 'run.sh'), 'utf8');
  check(ALL_ERAS.every((id) => runSh.includes(`'${id}'`)), 'run.sh lists all five eras');
  check(runSh.includes('docker compose up --abort-on-container-exit --exit-code-from'), 'run.sh runs one era per invocation with --exit-code-from');
  check(/results\/summary\.md/.test(runSh), 'run.sh writes results/summary.md');
  const runPs1 = fs.readFileSync(path.join(nodeProject, 'run.ps1'), 'utf8');
  check(ALL_ERAS.every((id) => runPs1.includes(`'${id}'`)), 'run.ps1 lists all five eras');
  check(runPs1.includes('--exit-code-from'), 'run.ps1 uses --exit-code-from too');
}
{
  // family mismatch warning: node project vs python/php capsules
  const r = runCli([nodeFixture, '--no-clone', '--out', path.join(TMP, 'warn-out')]);
  const expected = ['trusty-python34', 'focal-php74', 'jammy-python310'];
  check(
    r.status === 0 && expected.every((id) => r.stdout.includes(`era "${id}" is a`)),
    'report warns about node-vs-python/php era mismatches'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Detection of other project types
// ═══════════════════════════════════════════════════════════════════════════
section('detection — python, makefile, unknown');

{
  const pyDir = path.join(TMP, 'fossil-py');
  makePythonFixture(pyDir);
  const out = path.join(TMP, 'out-py');
  const r = runCli([pyDir, '--no-clone', '--out', out]);
  const env = fs.readFileSync(path.join(out, 'fossil-py', '.env'), 'utf8');
  check(r.status === 0, 'python fixture generates cleanly');
  check(
    /TEST_COMMAND=pip3 install -r requirements.txt && pip3 install -q pytest && python3 -m pytest -q/.test(env),
    'python+requirements+pytest detects the pytest pipeline'
  );
}
{
  const mkDir = path.join(TMP, 'fossil-make');
  makeMakeFixture(mkDir);
  const out = path.join(TMP, 'out-make');
  const r = runCli([mkDir, '--no-clone', '--out', out]);
  const env = fs.readFileSync(path.join(out, 'fossil-make', '.env'), 'utf8');
  check(r.status === 0, 'make fixture generates cleanly');
  check(/TEST_COMMAND=make test/.test(env), 'Makefile with a test target detects `make test`');
}
{
  const bareDir = path.join(TMP, 'bare');
  writeFixture(bareDir, { 'notes.txt': 'nothing here\n' });
  const out = path.join(TMP, 'out-bare');
  const r = runCli([bareDir, '--no-clone', '--out', out]);
  check(r.status === 0, 'manifest-less project generates cleanly');
  check(/no tests detected/.test(r.stdout), 'report warns that no tests were detected');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Era subsetting, overrides, dry-run, force
// ═══════════════════════════════════════════════════════════════════════════
section('era subsetting & overrides');

{
  const out = path.join(TMP, 'out-subset');
  const r = runCli([nodeFixture, '--no-clone', '--out', out, '--eras', 'bionic-node8, jammy-python310']);
  check(r.status === 0, 'comma-separated era list (with space) accepted');
  const compose = fs.readFileSync(path.join(out, 'fossil-app', 'docker-compose.yml'), 'utf8');
  check(new RegExp('^  bionic-node8:', 'm').test(compose), 'subset compose includes bionic-node8');
  check(new RegExp('^  jammy-python310:', 'm').test(compose), 'subset compose includes jammy-python310');
  check(!new RegExp('^  trusty-python34:', 'm').test(compose), 'subset compose excludes trusty-python34');
  check(
    fs.existsSync(path.join(out, 'fossil-app', 'eras', 'bionic-node8.Dockerfile')) &&
      !fs.existsSync(path.join(out, 'fossil-app', 'eras', 'trusty-python34.Dockerfile')),
    'subset writes only the selected Dockerfiles'
  );
}
{
  const out = path.join(TMP, 'out-override');
  const r = runCli([nodeFixture, '--no-clone', '--out', out, '-t', 'python3 -m unittest discover -v']);
  const env = fs.readFileSync(path.join(out, 'fossil-app', '.env'), 'utf8');
  check(r.status === 0, '--test-command accepted');
  check(env.includes('TEST_COMMAND=python3 -m unittest discover -v'), '--test-command lands in .env');
  const r2 = runCli([nodeFixture, '--no-clone', '--out', path.join(TMP, 'out-override-inline'), '--test-command=make ci']);
  const env2 = fs.readFileSync(path.join(TMP, 'out-override-inline', 'fossil-app', '.env'), 'utf8');
  check(r2.status === 0 && env2.includes('TEST_COMMAND=make ci'), '--test-command=... inline form works');
}
{
  const out = path.join(TMP, 'out-dry');
  const r = runCli([nodeFixture, '--no-clone', '--out', out, '--dry-run']);
  check(r.status === 0, 'dry run exits 0');
  check(/would write docker-compose\.yml/.test(r.stdout), 'dry run prints the file plan');
  check(!fs.existsSync(out), 'dry run wrote nothing to disk');
}
{
  const out = path.join(TMP, 'out-force');
  const first = runCli([nodeFixture, '--no-clone', '--out', out]);
  const second = runCli([nodeFixture, '--no-clone', '--out', out]);
  const third = runCli([nodeFixture, '--no-clone', '--out', out, '--force']);
  check(first.status === 0, 'first generation succeeds');
  check(second.status !== 0 && /already exists/.test(second.stderr), 'second generation refuses without --force');
  check(third.status === 0, '--force overwrites the existing bundle');
}
{
  const r = runCli([nodeFixture, '--no-clone', '--out', path.join(TMP, 'x'), '--eras', 'steam-engine-1894']);
  check(r.status !== 0, 'unknown era exits non-zero');
  check(r.stderr.includes('available eras:'), 'unknown era error lists the available eras');
}
{
  const out = path.join(TMP, 'out-name');
  const r = runCli([nodeFixture, '--no-clone', '--out', out, '--name', 'Mega Fossil 99']);
  check(r.status === 0, '--name accepted');
  check(fs.existsSync(path.join(out, 'mega-fossil-99', 'docker-compose.yml')), 'project dir + compose name derived from --name');
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. The clone path (real local git repository)
// ═══════════════════════════════════════════════════════════════════════════
section('clone path — real local git repo');

{
  const gitFixture = path.join(TMP, 'git-repo');
  makeNodeFixture(gitFixture);
  gitInit(gitFixture);
  const out = path.join(TMP, 'out-clone');
  const r = runCli([gitFixture, '--out', out]);
  check(r.status === 0, 'cloning a local git repository succeeds');
  check(fs.existsSync(path.join(out, 'git-repo', 'src', 'package.json')), 'clone lands in <out>/<name>/src');
  check(fs.existsSync(path.join(out, 'git-repo', 'src', '.git')), 'shallow clone carries a .git dir');
  const compose = fs.readFileSync(path.join(out, 'git-repo', 'docker-compose.yml'), 'utf8');
  check(compose.includes('npm install && npm test'), 'detection ran against the cloned tree');
}
{
  const out = path.join(TMP, 'out-clone-fail');
  const r = runCli([path.join(TMP, 'definitely-not-a-repo-' + Date.now()), '--out', out]);
  check(r.status !== 0, 'cloning a non-existent path exits non-zero');
  check(/failed to clone/.test(r.stderr), 'clone failure explains itself');
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Shell / PowerShell / Docker validation when the tools exist
// ═══════════════════════════════════════════════════════════════════════════
section('generated script validation (best effort)');

{
  const runSh = path.join(nodeProject, 'run.sh');
  if (tryExec('bash', ['--version'])) {
    try {
      execFileSync('bash', ['-n', runSh], { stdio: 'pipe', windowsHide: true });
      check(true, 'bash -n: run.sh is valid bash');
    } catch (err) {
      check(false, 'bash -n: run.sh is valid bash');
      console.log('      ' + String(err.stderr || err.message).split('\n')[0]);
    }
  } else {
    skip('bash -n on run.sh (bash not on PATH)');
  }
}
{
  const runPs1 = path.join(nodeProject, 'run.ps1');
  const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const probe = tryExec(ps, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion']);
  if (probe) {
    try {
      const raw = fs.readFileSync(runPs1, 'utf8').replace(/'/g, "''");
      const out = execFileSync(
        ps,
        ['-NoProfile', '-Command', `[scriptblock]::Create('${raw}') | Out-Null; 'PS-SYNTAX-OK'`],
        { stdio: 'pipe', encoding: 'utf8', windowsHide: true }
      );
      check(out.includes('PS-SYNTAX-OK'), `${ps}: run.ps1 parses as a valid script block`);
    } catch (err) {
      check(false, `${ps}: run.ps1 parses as a valid script block`);
      console.log('      ' + String(err.stderr || err.message).split('\n')[0]);
    }
  } else {
    skip('powershell syntax check on run.ps1 (no powershell/pwsh)');
  }
}
{
  if (tryExec('docker', ['version'])) {
    try {
      execFileSync(
        'docker',
        ['compose', '-f', path.join(nodeProject, 'docker-compose.yml'), 'config', '-q'],
        { stdio: 'pipe', windowsHide: true }
      );
      check(true, 'docker compose config: generated compose file is valid');
    } catch (err) {
      check(false, 'docker compose config: generated compose file is valid');
      console.log('      ' + String(err.stderr || err.message).split('\n')[0]);
    }
  } else {
    skip('docker compose config validation (docker not installed in this environment)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Node syntax check over the whole codebase
// ═══════════════════════════════════════════════════════════════════════════
section('codebase syntax');

{
  const files = ['index.js', 'src/cli.js', 'src/detect.js', 'src/eras.js', 'src/generate.js', 'src/templates.js'];
  let ok = true;
  for (const f of files) {
    try {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^#!.*\r?\n/, ''); // strip shebang
      new Function(src); // parse-only, does not run
    } catch (err) {
      ok = false;
      console.log(`      ${f}: ${err.message}`);
    }
  }
  check(ok, `all ${files.length} JS sources parse cleanly (new Function parse check)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(
  `\n────────────────────────────────────────────────────────────────\n` +
    `  ✅ ${passed} passed · ❌ ${failed} failed · ⏭️  ${skipped} skipped\n` +
    `────────────────────────────────────────────────────────────────`
);

fs.rmSync(TMP, { recursive: true, force: true });
process.exitCode = failed > 0 ? 1 : 0;
