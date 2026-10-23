import {spawn} from 'node:child_process';

export type MediaInfo = {durationSeconds: number; hasAudio: boolean; width: number; height: number};

type ProbeStream = {codec_type?: string; width?: number; height?: number};

export function probeMedia(file: string): Promise<MediaInfo> {
  const win = process.platform === 'win32';
  // On Windows npx is a .cmd shim that needs a shell, so quote the path ourselves.
  const quote = (s: string) => (win ? `"${s}"` : s);
  const args = ['remotion', 'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', quote(file)];
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, {shell: win, windowsHide: true});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (exit ${code}) for ${file}: ${err.trim()}`));
      try {
        const json = JSON.parse(out) as {streams?: ProbeStream[]; format?: {duration?: string}};
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        resolve({
          width: video?.width ?? 0,
          height: video?.height ?? 0,
          hasAudio: streams.some((s) => s.codec_type === 'audio'),
          durationSeconds: Number(json.format?.duration),
        });
      } catch (e) {
        reject(new Error(`Could not parse ffprobe output for ${file}: ${(e as Error).message}`));
      }
    });
  });
}
