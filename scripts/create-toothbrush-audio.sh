#!/bin/bash

# Create composite audio files for toothbrush timer tracks
# Each track will be: silence + boing (except the last one)

echo "Creating toothbrush timer audio tracks..."

# Track 2-7: 14 seconds silence + boing
for i in {2..7}; do
  echo "Creating track $i audio (14s silence + boing)..."
  ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 14 assets/audio/timer/temp-silence-14s.wav -y
  ffmpeg -i assets/audio/timer/temp-silence-14s.wav -i assets/timer/sounds/boing.m4a -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -map "[out]" assets/audio/timer/toothbrush-track-${i}.wav -y
  rm assets/audio/timer/temp-silence-14s.wav
done

# Track 8 (last before alarm): 15 seconds silence only (no boing, will transition to alarm or final track)
echo "Creating track 8 audio (15s silence only, no boing)..."
ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 15 assets/audio/timer/toothbrush-track-8.wav -y

echo "All toothbrush timer audio tracks created successfully!"