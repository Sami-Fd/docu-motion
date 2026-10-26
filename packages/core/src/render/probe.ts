import {runRemotionTool} from '../media/ffmpeg.js';

export type MediaInfo = {durationSeconds: number; hasAudio: boolean; width: number; height: number};

type ProbeStream = {codec_type?: string; width?: number; height?: number};

export async function probeMedia(file: string): Promise<MediaInfo> {
  const {stdout} = await runRemotionTool('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    file,
  ]).catch((e: Error) => {
    throw new Error(`ffprobe failed for ${file}: ${e.message}`);
  });
  try {
    const json = JSON.parse(stdout) as {streams?: ProbeStream[]; format?: {duration?: string}};
    const streams = json.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const durationSeconds = Number(json.format?.duration);
    if (!video) throw new Error('no video stream found');
    if (!Number.isFinite(durationSeconds)) throw new Error('no duration in format info');
    return {
      width: video.width ?? 0,
      height: video.height ?? 0,
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
      durationSeconds,
    };
  } catch (e) {
    throw new Error(`Unusable ffprobe output for ${file}: ${(e as Error).message}`);
  }
}
