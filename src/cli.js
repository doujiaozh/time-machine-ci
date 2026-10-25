'use strict';

/**
 * Argument parsing + entry orchestration for the time-machine-ci CLI.
 * Deliberately zero-dependency: if Node can run it, the CLI works.
 */

const pkg = require('../package.json');
const { generate } = require('./generate');

const USAGE = `🕰  time-machine-ci v${pkg.version} — test your code against the ghosts of runtimes past

USAGE
  time-machine-ci <github-repo> [options]
  time-machine-ci owner/name            # GitHub shorthand
  time-machine-ci ./my-local-repo --no-clone

ARGUMENTS
  <github-repo>   GitHub URL, owner/name shorthand, or a local path (with --no-clone)

OPTIONS
  -o, --out <dir>          Output directory (default: ./time-machine-output)
  -e, --eras <ids>         Comma-separated era ids (default: all five)
  -t, --test-command <cmd> Override the detected test command
  -n, --name <name>        Project name (default: repository name)
      --no-clone           Use <github-repo> as a local source directory, not a clone
      --force              Overwrite an existing output directory
      --dry-run            Print the generation plan without writing files
  -v, --version            Print version
  -h, --help               Show this help

ERAS (the default matrix)
  🦕 2014  trusty-python34    Ubuntu 14.04 · Python 3.4
  💾 2016  xenial-node6       Ubuntu 16.04 · Node.js 6
  🧭 2018  bionic-node8       Ubuntu 18.04 · Node.js 8
  🧊 2020  focal-php74        Ubuntu 20.04 · PHP 7.4
  🛰️ 2022  jammy-python310    Ubuntu 22.04 · Python 3.10

EXAMPLES
  time-machine-ci https://github.com/facebook/react
  time-machine-ci https://github.com/pyca/cryptography -e trusty-python34,jammy-python310
  time-machine-ci ../legacy-app --no-clone -t "python3 -m unittest discover -v"
  time-machine-ci octocat/Hello-World --dry-run`;

function parseArgs(argv) {
  const opts = {
    repo: null,
    out: null,
    eras: null,
    testCommand: null,
    name: null,
    noClone: false,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let key = arg;
    let inline;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        key = arg.slice(0, eq);
        inline = arg.slice(eq + 1);
      }
    }

    const wantValue = (flag) => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error(`option "${flag}" requires a value`);
      }
      i += 1;
      return next;
    };

    switch (key) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-o':
      case '--out':
        opts.out = wantValue(key);
        break;
      case '-e':
      case '--eras':
        opts.eras = wantValue(key);
        break;
      case '-t':
      case '--test-command':
        opts.testCommand = wantValue(key);
        break;
      case '-n':
      case '--name':
        opts.name = wantValue(key);
        break;
      case '--no-clone':
        opts.noClone = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default: {
        if (key.startsWith('-')) {
          throw new Error(`unknown option "${key}"`);
        }
        if (opts.repo !== null) {
          throw new Error(`unexpected extra argument "${arg}" — expected exactly one repository`);
        }
        opts.repo = arg;
      }
    }
  }

  return opts;
}

function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`✖ ${err.message}\n\n${USAGE}`);
    return 2;
  }

  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.version) {
    console.log(`time-machine-ci v${pkg.version}`);
    return 0;
  }
  if (!opts.repo) {
    console.error(`✖ a repository argument is required\n\n${USAGE}`);
    return 2;
  }

  try {
    return generate(opts);
  } catch (err) {
    console.error(`\n✖ ${err.message}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, USAGE };
