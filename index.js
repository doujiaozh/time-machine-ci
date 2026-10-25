#!/usr/bin/env node
'use strict';

// time-machine-ci — CLI entry point.
// Everything interesting lives in ./src so the tool stays requireable and testable.
const { run } = require('./src/cli');

process.exitCode = run(process.argv.slice(2));
