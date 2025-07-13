const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3069;

// ---- CONFIG --------------------------------------------------------------
const VIDEO_DIR   = path.join(__dirname, 'movies');
const FRAME_WIDTH = 640;   // 480 p
const FRAME_HEIGHT = 360;
const FPS = 30;            // Adjust if your source FPS differs
// -------------------------------------------------------------------------


app.get('/api/frames', async (req, res) => {
  const { filename, start = 0, count = 1 } = req.query;

  if (!filename) {
    return res.status(400).json({ error: 'filename query param required' });
  }

  const videoPath = path.join(VIDEO_DIR, filename);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'video not found' });
  }

  try {
    const frames = await extractFrames(videoPath, Number(start), Number(count));
    res.json({ frames });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to process video' });
  }
});

/**
 * Stream raw RGBA frames out of ffmpeg and return them
 * as JS number arrays ready for Roblox EditableImage buffers.
 */
async function extractFrames(videoPath, startFrame, count) {
  const startTime = startFrame / FPS;
  const duration  = count / FPS;
  const frameSize = FRAME_WIDTH * FRAME_HEIGHT * 4;

  console.log(`⏱ Starting frame extraction: startFrame=${startFrame}, count=${count}`);
  console.time('🧠 Frame Generation Time');

  return new Promise((resolve, reject) => {
    const frames = [];
    let leftover = Buffer.alloc(0);
    let ended = false;

    const ffmpegProcess = ffmpeg(videoPath)
      .seekInput(startTime)
      .duration(duration)
      .outputOptions([
        `-vf fps=${FPS},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}`,
        '-pix_fmt rgba',
        '-f rawvideo'
      ])
      .on('error', err => {
        if (!ended) {
          ended = true;
          console.error('❌ FFmpeg error:', err);
          reject(err);
        }
      })
      .on('end', () => {
        if (!ended) {
          ended = true;
          console.timeEnd('🧠 Frame Generation Time');
          if (frames.length < count) {
            console.warn(`⚠️ Only got ${frames.length} frames (expected ${count})`);
          }
          resolve(frames);
        }
      })
      .pipe();

    ffmpegProcess.on('data', chunk => {
      leftover = Buffer.concat([leftover, chunk]);

      while (leftover.length >= frameSize && frames.length < count) {
        const frameBuf = leftover.subarray(0, frameSize);
        leftover = leftover.subarray(frameSize);
        frames.push(frameBuf.toString('base64'));

        if (frames.length === count && !ended) {
          ended = true;
          console.timeEnd('🧠 Frame Generation Time');
          resolve(frames);

          try {
            ffmpegProcess.destroy(); // Soft close
          } catch (e) {
            console.warn('⚠️ Failed to destroy stream gracefully:', e);
          }
        }
      }
    });
  });
}

app.listen(port, () => {
  console.log(`Tempy API listening at http://localhost:${port}`);
});
