const fs = require('fs');
const path = require('path');

function createWavHeader(sampleRate, numChannels, bitsPerSample, dataSize) {
  const buffer = Buffer.alloc(44);

  // "RIFF" chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(dataSize + 36, 4);
  buffer.write('WAVE', 8);

  // "fmt " sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // ByteRate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  // "data" sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40); // Subchunk2Size

  return buffer;
}

function generateSilentWav(durationSeconds, outputPath) {
  const sampleRate = 44100;
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const header = createWavHeader(sampleRate, numChannels, bitsPerSample, dataSize);
  const audioData = Buffer.alloc(dataSize);
  const wavBuffer = Buffer.concat([header, audioData]);

  fs.writeFileSync(outputPath, wavBuffer);

  console.log(`Created ${outputPath} - Duration: ${durationSeconds}s, Size: ${wavBuffer.length} bytes`);
}

const outputDir = path.join(__dirname, '..', 'assets', 'audio', 'timer');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const files = [
  { duration: 15, name: 'silent-15s.wav' },
  { duration: 60, name: 'silent-1m.wav' },
  { duration: 300, name: 'silent-5m.wav' },
  { duration: 600, name: 'silent-10m.wav' }
];

files.forEach(file => {
  const outputPath = path.join(outputDir, file.name);
  generateSilentWav(file.duration, outputPath);
});

console.log('\nAll silent audio files generated successfully!');
console.log(`Files saved to: ${outputDir}`);