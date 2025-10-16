#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os
import math

def generate_floating_ghost_gif(progress, total_segments, output_path):
    """Generate an animated GIF with a floating ghost that fades with progress."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_img = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # If progress is 0, create a transparent single-frame GIF
    if progress == 0:
        img = Image.new('P', (16, 16), 0)
        img.putpalette([0,0,0] * 256)
        img.save(output_path, format='GIF', transparency=0)
        return

    # Create frames for the floating animation
    frames = []
    num_frames = 10  # Number of frames for animation

    for frame_idx in range(num_frames):
        # Create frame with transparent background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate vertical offset for floating effect
        y_offset = int(2 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Apply opacity to ghost
        ghost_copy = ghost_img.copy()
        if progress < 1.0:
            # Adjust alpha channel
            data = ghost_copy.getdata()
            new_data = []
            for item in data:
                # Preserve RGB, scale alpha
                new_data.append((item[0], item[1], item[2], int(item[3] * progress)))
            ghost_copy.putdata(new_data)

        # Position ghost (centered with float offset)
        x_pos = (16 - ghost_copy.width) // 2
        y_pos = (16 - ghost_copy.height) // 2 + y_offset

        # Paste ghost onto frame
        frame.paste(ghost_copy, (x_pos, y_pos), ghost_copy)

        # Convert to indexed color for GIF
        frame = frame.convert('P', palette=Image.ADAPTIVE, dither=None)
        frames.append(frame)

    # Save animated GIF
    if frames:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:] if len(frames) > 1 else [],
            duration=100,
            loop=0,
            transparency=0,
            disposal=2
        )

def main():
    """Generate all floating ghost GIF icons."""
    # Create output directory
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    # Common segment counts based on timer durations
    segment_configs = [
        (8, "8-segments"),   # 2 minutes (15-second increments)
        (5, "5-segments"),   # 5 minutes
        (10, "10-segments"), # 10 minutes
        (15, "15-segments"), # 15 minutes
        (6, "6-segments"),   # 30 or 60 minutes
        (12, "12-segments"), # Alternative
    ]

    # Generate GIFs for different progress levels
    for total_segments, segment_name in segment_configs:
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"{segment_name}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)
            print(f"Generated: {filename} (progress: {progress:.2f}, opacity: {int(255*progress)})")

    # Also generate a generic set for custom durations (up to 20 segments)
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)
            print(f"Generated: {filename} (progress: {progress:.2f}, opacity: {int(255*progress)})")

    print("\nTesting a sample GIF to verify animation frames...")
    # Check if animation frames were created properly
    test_gif = "assets/icons/timer/ghost/ghost-5-0.gif"
    if os.path.exists(test_gif):
        test_img = Image.open(test_gif)
        try:
            frame_count = 0
            while True:
                frame_count += 1
                test_img.seek(test_img.tell() + 1)
        except EOFError:
            print(f"Sample GIF has {frame_count} frames (expected: 12)")

if __name__ == "__main__":
    main()