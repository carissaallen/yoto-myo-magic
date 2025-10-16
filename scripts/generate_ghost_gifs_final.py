#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os
import math

def generate_floating_ghost_gif(progress, total_segments, output_path):
    """Generate an animated GIF with a floating ghost that fades with progress."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_original = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # If progress is 0, create empty GIF
    if progress == 0:
        frame = Image.new('P', (16, 16), 0)
        frame.putpalette([0]*768)  # Black palette
        frame.info['transparency'] = 0
        frame.save(output_path, 'GIF', transparency=0)
        return

    # Create frames for animation
    frames = []
    num_frames = 8  # 8 frames for smooth animation

    for frame_idx in range(num_frames):
        # Create frame with BLACK background (important for Yoto display)
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 255))

        # Calculate vertical offset for floating (up and down movement)
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Process ghost with fading based on progress
        ghost = ghost_original.copy()
        pixels = ghost.load()

        # Apply fading by adjusting pixel brightness based on progress
        for y in range(ghost.height):
            for x in range(ghost.width):
                r, g, b, a = pixels[x, y]
                if a > 0:  # Only process non-transparent pixels
                    # For white/light pixels, maintain brightness relationship
                    # but scale down based on progress
                    if r > 200 and g > 200 and b > 200:
                        # White pixels - keep white but adjust alpha
                        new_a = int(a * progress)
                        pixels[x, y] = (255, 255, 255, new_a)
                    elif r > 0 or g > 0 or b > 0:
                        # Colored pixels - scale brightness
                        new_r = int(r * progress)
                        new_g = int(g * progress)
                        new_b = int(b * progress)
                        new_a = int(a * progress)
                        pixels[x, y] = (new_r, new_g, new_b, new_a)

        # Position ghost (centered with floating offset)
        x_pos = 0  # Ghost is already 16x16
        y_pos = y_offset

        # Composite ghost onto black background
        frame.paste(ghost, (x_pos, y_pos), ghost)

        # Convert to indexed color with specific palette
        # Use adaptive palette but limit colors for better GIF compatibility
        frame = frame.convert('P', palette=Image.ADAPTIVE, colors=32)
        frames.append(frame)

    # Save as animated GIF with settings that work on Yoto
    if frames:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=120,  # 120ms per frame
            loop=0,  # Loop forever
            disposal=2,  # Important: dispose between frames
            optimize=False  # Don't optimize - keep frames intact
        )

        # Verify the saved GIF
        verify = Image.open(output_path)
        if hasattr(verify, 'n_frames'):
            if verify.n_frames != num_frames:
                print(f"Warning: Expected {num_frames} frames but got {verify.n_frames}")

def main():
    """Generate all floating ghost GIF icons."""
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating ghost GIFs with proper white fill and animation...")
    print("=" * 60)

    # Common segment counts
    segment_configs = [
        (8, "8-segments"),
        (5, "5-segments"),
        (10, "10-segments"),
        (15, "15-segments"),
        (6, "6-segments"),
        (12, "12-segments"),
    ]

    # Generate specific segment configs first
    for total_segments, segment_name in segment_configs:
        print(f"\nGenerating {segment_name}:")
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"{segment_name}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)

            # Verify animation
            try:
                img = Image.open(output_path)
                frames = getattr(img, 'n_frames', 1)
                animated = getattr(img, 'is_animated', False)
                opacity_percent = int(progress * 100)
                print(f"  {filename}: {opacity_percent}% opacity, {frames} frames, animated={animated}")
            except Exception as e:
                print(f"  {filename}: Error - {e}")

    # Generate generic set (1-20 segments)
    print("\nGenerating generic set (1-20 segments)...")
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)

    print("\n" + "=" * 60)
    print("Ghost GIF generation complete!")

    # Test a sample to ensure it's working
    test_path = os.path.join(output_dir, "ghost-5-2.gif")
    if os.path.exists(test_path):
        test_img = Image.open(test_path)
        print(f"\nTest verification (ghost-5-2.gif):")
        print(f"  Frames: {getattr(test_img, 'n_frames', 1)}")
        print(f"  Animated: {getattr(test_img, 'is_animated', False)}")
        print(f"  Size: {test_img.size}")
        print(f"  Mode: {test_img.mode}")

if __name__ == "__main__":
    main()