// Splits audio files into chapters based on silence detection

class AudioSplitter {
  constructor() {
    this.silenceThreshold = 0.01; // Amplitude threshold for silence
    this.minSilenceDuration = 3.0; // Minimum 3 seconds of silence to split
    this.minChapterDuration = 10.0; // Minimum chapter length in seconds
  }

  async processAudioFile(file) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const silencePeriods = this.detectSilencePeriods(audioBuffer);
      const chapters = this.createChaptersFromSilence(audioBuffer, silencePeriods);

      return chapters;
    } finally {
      audioContext.close();
    }
  }

  detectSilencePeriods(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const windowSize = Math.floor(sampleRate * 0.1);

    const silencePeriods = [];
    let inSilence = false;
    let silenceStart = 0;

    for (let i = 0; i < channelData.length; i += windowSize) {
      const windowEnd = Math.min(i + windowSize, channelData.length);
      let maxAmplitude = 0;

      for (let j = i; j < windowEnd; j++) {
        maxAmplitude = Math.max(maxAmplitude, Math.abs(channelData[j]));
      }

      const currentTime = i / sampleRate;

      if (maxAmplitude < this.silenceThreshold) {
        if (!inSilence) {
          inSilence = true;
          silenceStart = currentTime;
        }
      } else {
        if (inSilence) {
          const silenceDuration = currentTime - silenceStart;
          if (silenceDuration >= this.minSilenceDuration) {
            silencePeriods.push({
              start: silenceStart,
              end: currentTime,
              duration: silenceDuration
            });
          }
          inSilence = false;
        }
      }
    }

    if (inSilence) {
      const finalTime = channelData.length / sampleRate;
      const silenceDuration = finalTime - silenceStart;
      if (silenceDuration >= this.minSilenceDuration) {
        silencePeriods.push({
          start: silenceStart,
          end: finalTime,
          duration: silenceDuration
        });
      }
    }

    return silencePeriods;
  }

  createChaptersFromSilence(audioBuffer, silencePeriods) {
    const chapters = [];
    let chapterStart = 0;
    let chapterIndex = 1;

    for (const silence of silencePeriods) {
      const chapterDuration = silence.start - chapterStart;

      if (chapterDuration >= this.minChapterDuration) {
        chapters.push({
          index: chapterIndex,
          start: chapterStart,
          end: silence.start,
          duration: chapterDuration,
          name: `Chapter ${chapterIndex}`,
          audioBuffer: this.extractAudioSegment(audioBuffer, chapterStart, silence.start)
        });
        chapterIndex++;
        chapterStart = silence.end;
      }
    }

    const finalDuration = audioBuffer.duration - chapterStart;
    if (finalDuration >= this.minChapterDuration) {
      chapters.push({
        index: chapterIndex,
        start: chapterStart,
        end: audioBuffer.duration,
        duration: finalDuration,
        name: `Chapter ${chapterIndex}`,
        audioBuffer: this.extractAudioSegment(audioBuffer, chapterStart, audioBuffer.duration)
      });
    }

    return chapters;
  }

  extractAudioSegment(audioBuffer, startTime, endTime) {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const length = endSample - startSample;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const newBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      length,
      sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        targetData[i] = sourceData[startSample + i];
      }
    }

    return newBuffer;
  }

  async audioBufferToWav(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    const wavBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * numberOfChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true); // byte rate
    view.setUint16(32, numberOfChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, length * numberOfChannels * 2, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  previewChapter(chapter) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createBufferSource();
    source.buffer = chapter.audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);

    // Stop after 5 seconds or chapter end
    const previewDuration = Math.min(5, chapter.duration);
    setTimeout(() => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
      audioContext.close();
    }, previewDuration * 1000);

    return source;
  }

  async chaptersToAudioFiles(chapters) {
    const audioFiles = await Promise.all(chapters.map(async (chapter) => {
      const blob = await this.audioBufferToWav(chapter.audioBuffer);
      const fileName = `${chapter.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`;
      return new File([blob], fileName, { type: 'audio/wav' });
    }));

    return audioFiles;
  }
}

window.AudioSplitter = AudioSplitter;