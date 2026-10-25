'use strict';

/**
 * Template renderers for a time-machine-ci bundle.
 *
 * Every string here ends up on disk inside the generated bundle, so the
 * escaping rules matter more than usual:
 *   - Dockerfile line continuations are a literal backslash + newline
 *     (written in JS as '\\\n' inside single-quoted strings).
 *   - The sed sources-list rewrite keeps regex backslashes verbatim, so it
 *     is written with String.raw.
 *   - Shell/PowerShell scripts embed the project name, which generate.js
 *     sanitizes to [A-Za-z0-9._-] before it ever reaches us.
 */

const BASE_APT = ['ca-certificates', 'curl', 'git', 'make'];

const SED_OLD_RELEASES = String.raw`RUN sed -i -re 's/([a-z]{2}\.)?archive\.ubuntu\.com|security\.ubuntu\.com/old-releases.ubuntu.com/g' /etc/apt/sources.list`;

function rule() {
  return '# ' + '─'.repeat(76);
}

function buildDockerfile(era, ctx) {
  const apt = BASE_APT.concat(era.apt).join(' ');
  const lines = [];

  lines.push(rule());
  lines.push('# ⏳ time-machine-ci · era capsule');
  lines.push(`#    era   : ${era.id}`);
  lines.push(`#    year  : ${era.year} — ${era.nickname}`);
  lines.push(`#    stack : ${era.title}`);
  lines.push(`#    repo  : ${ctx.repo}`);
  lines.push(`#    tests : ${ctx.testCommand}`);
  lines.push('#    This file is generated — re-run the CLI instead of editing by hand.');
  lines.push(rule());
  lines.push(`FROM ${era.base}`);
  lines.push('');
  lines.push('ARG DEBIAN_FRONTEND=noninteractive');
  lines.push('ENV LANG=C.UTF-8');
  lines.push(`ENV TIME_MACHINE_ERA=${era.id}`);
  lines.push(`ENV TIME_MACHINE_YEAR=${era.year}`);

  if (era.sourcesFix) {
    lines.push('');
    const codename = era.base.split(':')[1];
    lines.push(`# ${codename} is EOL: Ubuntu moved its apt archives off archive.ubuntu.com`);
    lines.push('# onto old-releases.ubuntu.com. Rewrite the sources first or nothing installs.');
    lines.push(SED_OLD_RELEASES);
  }

  lines.push('');
  lines.push('RUN apt-get update \\\n && apt-get install -y --no-install-recommends ' + apt + ' \\\n && rm -rf /var/lib/apt/lists/*');

  lines.push('');
  lines.push(era.runtimeSetup);

  lines.push('');
  lines.push('# Era hint:');
  lines.push(`# ${era.hint}`);

  lines.push('');
  lines.push('WORKDIR /repo');
  // The source is bind-mounted at /repo at run time; COPY bakes it into the
  // image too so a capsule stays runnable without docker-compose.
  lines.push('COPY . .');

  lines.push('');
  lines.push('LABEL org.time-machine-ci.era="' + era.id + '" \\\n      org.time-machine-ci.year="' + era.year + '" \\\n      org.time-machine-ci.repo="' + ctx.repo + '"');

  lines.push('');
  lines.push('CMD ["sh", "-c", ' + JSON.stringify(ctx.testCommand) + ']');

  return lines.join('\n') + '\n';
}

function buildCompose(eras, ctx) {
  const matrix = eras
    .map((era) => `#   ${era.glyph} ${era.year}  ${era.id.padEnd(18)} ${era.short}`)
    .join('\n');

  const services = eras
    .map((era) => {
      return [
        `  ${era.id}:`,
        `    build:`,
        `      context: .`,
        `      dockerfile: eras/${era.dockerfileName}`,
        `    image: tmci-${ctx.slug}:${era.id}`,
        `    container_name: tmci-${ctx.slug}-${era.id}`,
        `    working_dir: /repo`,
        `    volumes:`,
        `      - ./src:/repo`,
        `    environment:`,
        `      CI: "true"`,
        `      TIME_MACHINE_ERA: "${era.id}"`,
        `      TIME_MACHINE_YEAR: "${era.year}"`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '# ═══════════════════════════════════════════════════════════════════════════════',
    '# ⏳ time-machine-ci bundle — an era-matrix test environment',
    `#   project : ${ctx.name}`,
    `#   source  : ${ctx.repo}`,
    `#   tests   : ${ctx.testCommand}`,
    '#',
    '# Era matrix:',
    matrix,
    '#',
    '# Run the whole matrix with one of:',
    '#   ./run.sh        # macOS / Linux / Git Bash / WSL',
    '#   .\\run.ps1       # Windows PowerShell',
    '#',
    '# Regenerate this bundle: npx time-machine-ci <repo>',
    '# ═══════════════════════════════════════════════════════════════════════════════',
    '',
    `name: ${ctx.slug}-time-machine`,
    '',
    'services:',
    services,
    '',
  ].join('\n');
}

function buildEnv(eras, ctx) {
  return [
    '# time-machine-ci bundle settings — informational. The Dockerfiles already',
    '# bake these values in; re-run the CLI (with --test-command, --eras, ...) to',
    '# change anything. docker compose also interpolates this file, so the values',
    '# are available as ${TIME_MACHINE_ERA} etc. if you extend the compose file.',
    `TIME_MACHINE_PROJECT=${ctx.name}`,
    `TIME_MACHINE_SOURCE=${ctx.repo}`,
    `TIME_MACHINE_ERAS=${eras.map((e) => e.id).join(',')}`,
    `TEST_COMMAND=${ctx.testCommand}`,
  ].join('\n') + '\n';
}

function buildRunSh(eras, ctx) {
  const ids = eras.map((e) => `  '${e.id}'`).join('\n');
  const stacks = eras.map((e) => `  '${e.short}'`).join('\n');
  const years = eras.map((e) => `  '${e.year}'`).join('\n');

  return `#!/usr/bin/env bash
# ⏡ time-machine-ci era-matrix runner — ${ctx.name}
# Generated by time-machine-ci. Runs every era, captures each exit code,
# and writes results/summary.md. Exit code is 0 only if every era passed.

set -uo pipefail
cd "$(dirname "$0")"

PROJECT="${ctx.name}"
SOURCE="${ctx.repo}"
ERAS=(
${ids}
)
STACKS=(
${stacks}
)
YEARS=(
${years}
)

RESULTS_DIR="results"
SUMMARY="$RESULTS_DIR/summary.md"
mkdir -p "$RESULTS_DIR"

{
  echo "# ⏳ time-machine-ci — era-matrix results"
  echo ""
  echo "- project: \`\${PROJECT}\`"
  echo "- source:  \${SOURCE}"
  echo "- tests:   ${ctx.testCommand}"
  echo "- started: \$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "| era | year | stack | result |"
  echo "|-----|------|-------|--------|"
} > "$SUMMARY"

printf '🕰  time-machine-ci · %s\n' "$PROJECT"

failed=0
index=0
for era in "\${ERAS[@]}"; do
  stack="\${STACKS[$index]}"
  year="\${YEARS[$index]}"
  index=$((index + 1))
  log="$RESULTS_DIR/\${era}.log"

  printf '\n🧪 %s — %s (%s)\n' "$era" "$stack" "$year"
  if ! docker compose build "$era" >"$log" 2>&1; then
    printf '   ❌ build failed → %s\n' "$log"
    printf '| \`%s\` | %s | %s | ❌ build failed |\n' "$era" "$year" "$stack" >> "$SUMMARY"
    failed=$((failed + 1))
    continue
  fi
  docker compose up --abort-on-container-exit --exit-code-from "$era" "$era" >>"$log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    printf '   ✅ passed\n'
    printf '| \`%s\` | %s | %s | ✅ passed |\n' "$era" "$year" "$stack" >> "$SUMMARY"
  else
    printf '   ❌ failed (exit %s) → %s\n' "$code" "$log"
    printf '| \`%s\` | %s | %s | ❌ failed (exit %s) |\n' "$era" "$year" "$stack" "$code" >> "$SUMMARY"
    failed=$((failed + 1))
  fi
done

{
  echo ""
  echo "- finished: \$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$SUMMARY"

printf '\n🕯  done — %s of %s eras failed.\n' "$failed" "\${#ERAS[@]}"
printf '    summary → %s\n\n' "$SUMMARY"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
`;
}

function buildRunPs1(eras, ctx) {
  const idList = eras.map((e) => `'${e.id}'`).join(', ');
  const stackRows = eras
    .map((e) => `  '${e.id}' = '${e.short}'`)
    .join('\n');
  const yearRows = eras
    .map((e) => `  '${e.id}' = '${e.year}'`)
    .join('\n');

  return `# ⏡ time-machine-ci era-matrix runner — ${ctx.name}
# Generated by time-machine-ci. Runs every era, captures each exit code, and
# writes results/summary.md. Exit code is 0 only if every era passed.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$Project = '${ctx.name}'
$Source = '${ctx.repo}'
$Eras = @(${idList})
$Stacks = @{
${stackRows}
}
$Years = @{
${yearRows}
}

$ResultsDir = 'results'
$Summary = Join-Path $ResultsDir 'summary.md'
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null

$started = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$header = @(
  '# ⏳ time-machine-ci — era-matrix results',
  '',
  "- project: \`\`$Project\`\`",
  "- source:  $Source",
  "- tests:   ${ctx.testCommand}",
  "- started: $started",
  '',
  '| era | year | stack | result |',
  '|-----|------|-------|--------|'
)
Set-Content -LiteralPath $Summary -Value $header -Encoding utf8

Write-Host "🕰  time-machine-ci · $Project"

$failed = 0
foreach ($era in $Eras) {
  $stack = $Stacks[$era]
  $year = $Years[$era]
  $log = Join-Path $ResultsDir "$era.log"

  Write-Host ""
  Write-Host "🧪 $era — $stack ($year)"
  & docker compose build $era 2>&1 | Out-File -FilePath $log -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    Write-Host "   ❌ build failed -> $log"
    Add-Content -LiteralPath $Summary -Value ('| \`\`{0}\`\` | {1} | {2} | ❌ build failed |' -f $era, $year, $stack) -Encoding utf8
    $failed += 1
    continue
  }
  & docker compose up --abort-on-container-exit --exit-code-from $era $era 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ passed"
    Add-Content -LiteralPath $Summary -Value ('| \`\`{0}\`\` | {1} | {2} | ✅ passed |' -f $era, $year, $stack) -Encoding utf8
  } else {
    Write-Host "   ❌ failed (exit $LASTEXITCODE) -> $log"
    Add-Content -LiteralPath $Summary -Value ('| \`\`{0}\`\` | {1} | {2} | ❌ failed (exit $LASTEXITCODE) |' -f $era, $year, $stack) -Encoding utf8
    $failed += 1
  }
}

$finished = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
Add-Content -LiteralPath $Summary -Value '' -Encoding utf8
Add-Content -LiteralPath $Summary -Value "- finished: $finished" -Encoding utf8

Write-Host ""
Write-Host "🕯  done — $failed of $($Eras.Count) eras failed."
Write-Host "    summary -> $Summary"

if ($failed -gt 0) {
  exit 1
}
`;
}

function buildGeneratedReadme(eras, ctx) {
  const rows = eras
    .map((era) => `| ${era.glyph} ${era.year} | \`${era.id}\` | ${era.short} | ${era.nickname} |`)
    .join('\n');

  return `# ⏡ ${ctx.name} — time-machine-ci bundle

A **time capsule**: your repository, dropped into ${eras.length} fossilized
development environments. If it passes in 2014 and in 2022, it is probably
portable. If it fails in 2014 — now you know, before your users do.

## Run the matrix

\`\`\`bash
./run.sh          # macOS / Linux / Git Bash / WSL
\`\`\`
\`\`\`powershell
.\\run.ps1         # Windows PowerShell
\`\`\`

Every era builds, runs the test command, and leaves a log in \`results/\`.
The runner writes \`results/summary.md\` and exits non-zero if any era failed,
so it drops straight into a CI job.

## What is in here

\`\`\`
docker-compose.yml      the era matrix (one service per era)
eras/*.Dockerfile       one self-contained capsule per era
src/                    a snapshot of ${ctx.repo} (bind-mounted into every capsule)
.env                    bundle settings (informational)
run.sh / run.ps1        matrix runners with result collection
GENERATED.md            this file
\`\`\`

## Era matrix

| year | era | stack | vibe |
|------|-----|-------|------|
${rows}

## Test command

\`\`\`
${ctx.testCommand}
\`\`\`

Picked by auto-detection (${ctx.detectionNote}). Override it and regenerate:

\`\`\`bash
npx time-machine-ci ${ctx.repo} --test-command "python3 -m unittest discover -v"
\`\`\`

## Why some builds talk to old-releases.ubuntu.com

Every EOL Ubuntu in this matrix has had its apt archives moved to
\`old-releases.ubuntu.com\`. The capsules rewrite \`/etc/apt/sources.list\`
themselves, so \`apt-get install\` still resolves. Similarly, the Node 6/8
capsules fall back to distro packages if the NodeSource setup channel for
those versions is ever retired. Old stacks are like that — the capsules do
the archaeology so you do not have to.

## How the code reaches the capsules

The source is **bind-mounted**, not cloned inside the image: a 2014 OpenSSL
cannot negotiate TLS with a modern GitHub. Cloning happens on your host with
a modern \`git\`; the capsule only has to *run* your code, not fetch it.

---

*Generated by [time-machine-ci](https://github.com/time-machine-ci/time-machine-ci) · MIT license*
`;
}

module.exports = {
  buildDockerfile,
  buildCompose,
  buildEnv,
  buildRunSh,
  buildRunPs1,
  buildGeneratedReadme,
};
