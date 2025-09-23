export async function generateSilentAudio(durationSeconds) {
  const sampleRate = 44100;
  const numberOfChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numberOfChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize; // 44 bytes for WAV header
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numberOfChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

export function getTimerSegments(totalMinutes) {
  const segments = [];
  let segmentDuration, numSegments;

  switch(totalMinutes) {
    case 2:
      segmentDuration = 15; // seconds
      numSegments = 8;
      break;
    case 5:
    case 10:
    case 15:
      segmentDuration = 60;
      numSegments = totalMinutes;
      break;
    case 30:
      segmentDuration = 300;
      numSegments = 6;
      break;
    case 60:
      segmentDuration = 600;
      numSegments = 6;
      break;
    default:
      segmentDuration = 60;
      numSegments = totalMinutes;
  }

  for (let i = 0; i < numSegments; i++) {
    const remainingTime = totalMinutes * 60 - (i * segmentDuration);
    const displayMinutes = Math.floor(remainingTime / 60);
    const displaySeconds = remainingTime % 60;

    let title;
    if (displayMinutes === 0) {
      title = `${displaySeconds} seconds left`;
    } else if (displaySeconds === 0) {
      title = displayMinutes === 1 ? '1 minute left' : `${displayMinutes} minutes left`;
    } else {
      title = `${displayMinutes}:${displaySeconds.toString().padStart(2, '0')} left`;
    }

    segments.push({
      duration: segmentDuration,
      title: title,
      iconProgress: 1 - (i / numSegments)
    });
  }

  return segments;
}