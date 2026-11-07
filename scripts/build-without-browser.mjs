#!/usr/bin/env node
// DS1.5: run a build command with a fail-closed browser preloader inherited by every Node child.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const commandLine = process.argv.slice(2);
if (commandLine.length < 2 || commandLine[0] !== '--') throw new Error('Usage: build-without-browser.mjs -- <command> [args]');
const [, command, ...args] = commandLine;
const preload = fileURLToPath(new URL('deny-browser.mjs', import.meta.url));
const result = spawnSync(command, args, { stdio: 'inherit', env: {
  ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${JSON.stringify(preload)}`,
} });
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
