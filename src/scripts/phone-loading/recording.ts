import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';

function output(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', (data: Buffer) => {stdout += data.toString();});
    child.stderr.on('data', (data: Buffer) => {stderr += data.toString();});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${file}: ${stderr}`)));
  });
}
/** Twelve chronological, phone-portrait frames, labelled without changing game pixels. */
export async function contactSheet(video: string, target: string, label: string): Promise<void> {
  const duration = Number(await output('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video]));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Recording has no duration');
  const caption = `${target}.txt`;
  await writeFile(caption, `${label}\n12 evenly spaced frames / ${duration.toFixed(1)} s`);
  const frames = `${target}.frames.jpg`;
  await output('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-vf', `fps=${12 / duration},scale=201:437,tile=4x3`, '-frames:v', '1', '-q:v', '5', frames]);
  const safeLabel = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const header = Buffer.from(`<svg width="804" height="54"><rect width="804" height="54" fill="black"/><g font-family="sans-serif" font-size="14" fill="white"><text x="10" y="20">${safeLabel}</text><text x="10" y="42">12 chronological frames / ${duration.toFixed(1)} s</text></g></svg>`);
  await sharp(frames).extend({top: 54, bottom: 0, left: 0, right: 0, background: 'black'})
    .composite([{input: header, top: 0, left: 0}]).jpeg({quality: 78}).toFile(target);
}
