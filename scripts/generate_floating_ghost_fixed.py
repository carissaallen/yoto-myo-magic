#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os
import math

def generate_floating_ghost_gif(progress, total_segments, output_path):
    """Generate an animated GIF with a floating ghost that fades with progress."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_base = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # If progress is 0, create a transparent single-frame GIF
    if progress == 0:
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        # For Yoto compatibility, we need to ensure it's a valid GIF
        img = img.convert('P', palette=Image.ADAPTIVE, colors=256)
        img.save(output_path, format='GIF', transparency=0)
        return

    # Create frames for the floating animation
    frames = []
    num_frames = 8  # Reduced frames for better compatibility

    for frame_idx in range(num_frames):
        # Create frame with BLACK background for Yoto display
        # The Yoto seems to display on a black background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 255))

        # Calculate vertical offset for floating effect (more pronounced)
        y_offset = int(3 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Process the ghost image
        ghost_copy = ghost_base.copy()

        # Apply fading by blending with black background
        if progress < 1.0:
            # Create a version of the ghost with adjusted opacity
            data = ghost_copy.getdata()
            new_data = []
            for item in data:
                if item[3] > 0:  # If pixel has any opacity
                    # For white/light pixels, reduce their brightness based on progress
                    r = int(item[0] * progress)
                    g = int(item[1] * progress)
                    b = int(item[2] * progress)
                    a = item[3]  # Keep original alpha
                    new_data.append((r, g, b, a))
                else:
                    new_data.append(item)
            ghost_copy.putdata(new_data)

        # Position ghost (centered with float offset)
        x_pos = (16 - ghost_copy.width) // 2
        y_pos = (16 - ghost_copy.height) // 2 + y_offset

        # Ensure within bounds
        y_pos = max(0, min(y_pos, 16 - ghost_copy.height))

        # Paste ghost onto frame
        frame.paste(ghost_copy, (x_pos, y_pos), ghost_copy)

        # Convert to indexed color mode for GIF
        # Use a specific palette to ensure consistency
        frame = frame.convert('P', palette=Image.ADAPTIVE, colors=64)
        frames.append(frame)

    # Save animated GIF with settings optimized for Yoto
    if frames:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=150,  # Slower animation for better visibility
            loop=0,  # Loop forever
            transparency=0,  # Black is transparent
            disposal=2,  # Clear between frames
            optimize=False  # Don't optimize to preserve animation
        )

def main():
    """Generate all floating ghost GIF icons."""
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    # Common segment counts
    segment_configs = [
        (8, "8-segments"),   # 2 minutes (15-second increments)
        (5, "5-segments"),   # 5 minutes
        (10, "10-segments"), # 10 minutes
        (15, "15-segments"), # 15 minutes
        (6, "6-segments"),   # 30 or 60 minutes
        (12, "12-segments"), # Alternative
    ]

    print("Generating ghost GIFs with black background for Yoto compatibility...")

    # Generate GIFs for different progress levels
    for total_segments, segment_name in segment_configs:
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"{segment_name}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)
            print(f"Generated: {filename} (progress: {progress:.2f}, brightness: {int(255*progress)})")

    # Also generate generic set
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)

    # Verify a sample
    print("\nVerifying sample GIF...")
    test_gif = "assets/icons/timer/ghost/ghost-5-0.gif"
    if os.path.exists(test_gif):
        img = Image.open(test_gif)
        print(f"Frames: {getattr(img, 'n_frames', 1)}")
        print(f"Animated: {getattr(img, 'is_animated', False)}")

        # Check first frame
        img.seek(0)
        img_rgba = img.convert('RGBA')
        # Sample center pixel
        center_pixel = img_rgba.getpixel((8, 8))
        print(f"Center pixel RGBA: {center_pixel}")

if __name__ == "__main__":
    main()