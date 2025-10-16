#!/bin/bash

# Generate silent audio files for timer segments
# Using sox or ffmpeg to create silent WAV files

# Create directory if it doesn't exist
cd assets/audio/timer/

# Function to generate silent audio
generate_silent() {
    duration=$1
    filename=$2

    echo "Generating $filename ($duration seconds)..."

    # Using ffmpeg to generate silent audio
    ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t $duration -acodec pcm_s16le -ar 44100 -ac 2 "$filename" -y 2>/dev/null

    if [ $? -eq 0 ]; then
        echo "✓ Generated $filename"
    else
        echo "✗ Failed to generate $filename"
    fi
}

# Generate new silent audio files needed for the updated timer segments

# 7.5 seconds (for 3-minute timer with 22.5s segments: 15s + 7.5s)
generate_silent 7.5 "silent-7.5s.wav"

# 12 seconds (for 1-minute timer with 5 segments)
generate_silent 12 "silent-12s.wav"

# 30 seconds (for 4-minute timer with 8 segments)
generate_silent 30 "silent-30s.wav"

# 2 minutes (for certain longer timers)
generate_silent 120 "silent-2m.wav"

echo ""
echo "Silent audio file generation complete!"
echo "Files in timer directory:"
ls -lh *.wav