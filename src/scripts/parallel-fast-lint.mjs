// Whole-repository syntax lint: four independent JS visitors, two native threads each.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { readLintConfig } from './guard-counts.mjs';
import { fastCommitLintConfig } from './precommit-checks.mjs';

/** Keep the exact native file walk (or committed snapshot), rules and diagnostics.
 * All workers settle before a refusal or config cleanup; explicit staged paths
 * continue through the single ordinary fastLint operation.
 * @param {string[] | null} selected @param {string} executable */
export async function parallelFastLint(selected, executable) {
  const path = `.commit-fast-lint-${process.pid}.json`;
  writeFileSync(path, JSON.stringify(fastCommitLintConfig({ options: { typeAware: false }, ...readLintConfig('.oxlintrc.json') })));
  try {
    let files = selected;
    if (files === null) {
      const listed = spawnSync(executable, ['--threads=2', '-c', path, '--debug', 'files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      if (listed.error !== undefined) throw listed.error;
      if (listed.status !== 0) throw new Error(`Fast lint file enumeration refused: ${listed.stderr}`);
      files = listed.stdout.trim().split(/\r?\n/u).filter(Boolean);
    }
    if (files.length === 0) throw new Error('Fast lint selected no sources');
    const partitions = Array.from({ length: Math.min(4, files.length) }, () => /** @type {string[]} */ ([]));
    files.forEach((file, index) => { partitions[index % partitions.length].push(file); });
    const results = await Promise.all(partitions.map(async partition => {
      // Keep every argv below the shared source check's conservative byte bound.
      const chunks = []; let chunk = [], bytes = 0;
      for (const file of partition) {
        const size = Buffer.byteLength(file) + 1;
        if (bytes + size > 65536 && chunk.length > 0) { chunks.push(chunk); chunk = []; bytes = 0; }
        chunk.push(file); bytes += size;
      }
      chunks.push(chunk);
      let refused = false, output = '', errors = '';
      for (const paths of chunks) {
        const result = await new Promise(resolve => {
          const child = spawn(executable, ['--threads=2', '-c', path, ...paths], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '', stderr = '';
          child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
          child.stdout.on('data', data => { stdout += data; });
          child.stderr.on('data', data => { stderr += data; });
          child.on('error', error => { stderr += error.message; });
          child.on('close', status => { resolve({ status, stdout, stderr }); });
        });
        // Preserve all native diagnostic text, including workers after a red.
        output += result.stdout; errors += result.stderr;
        if (result.status !== 0) refused = true;
      }
      return { refused, stdout: output, stderr: errors };
    }));
    for (const result of results) { process.stdout.write(result.stdout); process.stderr.write(result.stderr); }
    if (results.some(result => result.refused)) throw new Error('Fast whole-repository lint refused');
  } finally { unlinkSync(path); }
}
