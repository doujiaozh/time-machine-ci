# 🕰️ time-machine-ci

**Test your code against the ghosts of runtimes past.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥16](https://img.shields.io/badge/node-%E2%89%A516-green.svg)](https://nodejs.org)
[![Dependencies: zero](https://img.shields.io/badge/dependencies-zero-blue.svg)](#)

> Your CI is fast. Your CI is green. And your library still breaks on Python 3.4.
>
> Compatibility rot is slow and quiet: runtimes get dropped, TLS evolves, distro
> archives move to `old-releases.ubuntu.com`, and the only people who notice are
> the users on a six-year-old LTS who can't upgrade. **time-machine-ci exists to
> make that rot loud.**

Point it at a repository. It builds you a **time capsule**: a Docker Compose
bundle of five fossilized environments, each one booted fresh, each one running
*your* test command, each one reporting pass or fail on its own terms.

---

## ⚡ Quick start

```bash
npx time-machine-ci https://github.com/your-org/legacy-app
cd time-machine-output/legacy-app
./run.sh        # macOS / Linux / WSL / Git Bash
.\run.ps1       # Windows PowerShell
```

That's it. Five containers boot, your tests run in each of them, and you get a
per-era log plus a Markdown summary that tells you exactly *when* your code
stopped working — and, just as valuable, proves which ancient runtimes you still
support.

## 🧭 The default era matrix

| Era | Year | Base image | Runtime |
|---|---|---|---|
| 🦕 `trusty-python34` | 2014 | `ubuntu:14.04` | Python 3.4 + pip 1.5 |
| 💾 `xenial-node6` | 2016 | `ubuntu:16.04` | Node.js 6 (NodeSource) |
| 🧭 `bionic-node8` | 2018 | `ubuntu:18.04` | Node.js 8 (NodeSource) |
| 🧊 `focal-php74` | 2020 | `ubuntu:20.04` | PHP 7.4 + Composer 1.10 |
| 🛰️ `jammy-python310` | 2022 | `ubuntu:22.04` | Python 3.10 |

Not the eras you care about? Pick a subset:

```bash
npx time-machine-ci octocat/Hello-World --eras trusty-python34,jammy-python310
```

Want a sixth? [Add your own](#-custom-eras) — it's one object in an array.

## 🔍 What it detects

time-machine-ci inspects your repository and guesses how to run its tests:

| Detected from | Test command |
|---|---|
| `package.json` → `scripts.test` | `npm install && npm test` |
| `requirements.txt` + pytest config | `pip3 install -r requirements.txt && pip3 install -q pytest && python3 -m pytest -q` |
| `setup.py` / `pyproject.toml` | `python3 setup.py test` |
| `composer.json` | `composer test` (or `vendor/bin/phpunit`) |
| `Makefile` with a `test` target | `make test` |

…or skip the guessing entirely:

```bash
npx time-machine-ci ./my-app --no-clone --test-command "python3 -m unittest discover -v"
```

## 🧱 What you get

```
your-app/
├── docker-compose.yml      # one service per era, ./src bind-mounted at /repo
├── run.sh / run.ps1        # matrix runner → results/<era>.log + results/summary.md
├── .env                    # TEST_COMMAND, era list, provenance
├── GENERATED.md            # the bundle's own README
├── src/                    # your repository (copied or shallow-cloned)
└── eras/
    ├── trusty-python34.Dockerfile
    ├── xenial-node6.Dockerfile
    ├── bionic-node8.Dockerfile
    ├── focal-php74.Dockerfile
    └── jammy-python310.Dockerfile
```

## 🛠 How it works (and why the hard parts are hard)

- **Your source is bind-mounted, never baked into the image.** A 2014 Ubuntu
  image carries OpenSSL 1.0.1, which *cannot complete a TLS handshake with
  modern GitHub*. Cloning inside the capsule would silently fail on the oldest
  eras — so the capsule gets the network-free path and the host does the clone.
- **EOL archives are repaired.** Ubuntu 14.04/16.04/18.04 images can't `apt-get
  update` anymore: their packages moved to `old-releases.ubuntu.com`. Every EOL
  Dockerfile rewrites `sources.list` before installing anything. (Jammy is
  still on the live archive, so it skips the rewrite.)
- **Runtimes are installed the period-accurate way**: NodeSource setup scripts
  for Node 6/8, `php7.4-*` extensions for Focal, pip-pinned `pytest<5` for
  Python 3.4 — each with a documented fallback if the installer itself has
  fossilized.
- **Eras fail independently.** The runner builds and starts one era at a time
  with `docker compose up --abort-on-container-exit --exit-code-from`, so one
  broken capsule never masks the results of the others.

A mismatch between your project's language and a capsule's runtime (a Node
project vs. the Python 3.4 era) is reported as a warning, not an error — **a
failure there is information, not a bug.**

## 📖 CLI reference

```
time-machine-ci <github-repo|owner/name|path> [options]

  -o, --out <dir>          Output directory (default: ./time-machine-output)
  -e, --eras <ids>         Comma-separated era ids (default: all five)
  -t, --test-command <cmd> Override the detected test command
  -n, --name <name>        Project name (default: repository name)
      --no-clone           Use <path> as a local source directory, not a clone
      --force              Overwrite an existing output directory
      --dry-run            Print the generation plan without writing files
  -v, --version            Print version
  -h, --help               Show this help
```

## ✅ Requirements

- **Node.js ≥ 16** to run the CLI (it's zero-dependency — no `npm install` needed).
- **Docker + Compose v2** to actually run the capsules.

No Docker on your laptop? The bundle is just files: generate it, commit it to
the repo, and run it on any machine (or CI runner) that has Docker.

## 🧩 Custom eras

Append one object to `ERAS` in [`src/eras.js`](src/eras.js):

```js
{
  id: 'stretch-node9',          // dockerfile name + compose service id
  title: 'Debian 9 · Node 9',
  year: 2017,
  family: 'node',
  base: 'debian:stretch',
  sourcesFix: false,            // true → rewrite apt sources to old-releases
  apt: ['nodejs'],
  runtimeSetup: ['RUN echo "install node 9 here"'],
  hint: 'Debian stretch is EOL — needs deb.debian.org archive rewrite',
}
```

Every other file in the bundle regenerates from that single entry. PRs for new
capsules are very welcome — if you fossil-hunt an era, someone else needs it too.

## 🗺 Roadmap

- **More capsules**: CentOS 7, Debian stretch, Node.js 0.10, Python 2.7, Ruby 2.3
- **Non-apt families**: Alpine-era and Windows-container capsules
- **HTML report** generated from `results/summary.md`
- **CI mode**: a GitHub Action that regenerates the bundle on every PR
- **AUR/`pipx`-style packaging** beyond `npx`

## 🤝 Contributing

This is an early MVP — issues, era contributions, and bug reports are all
welcome. Run the test suite first:

```bash
git clone https://github.com/<you>/time-machine-ci && cd time-machine-ci
node test/run-tests.js     # zero-dependency, 96 checks, runs in seconds
```

## 📄 License

[MIT](LICENSE) — build time machines, break them, fix them, ship them.
