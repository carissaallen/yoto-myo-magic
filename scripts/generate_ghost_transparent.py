#!/usr/bin/env python3
from PIL import Image
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

    # If progress is 0, create empty transparent GIF
    if progress == 0:
        # Create a single transparent frame
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        # Convert to palette mode with transparency
        frame = frame.convert('P', palette=Image.ADAPTIVE, colors=2)
        frame.save(output_path, 'GIF', transparency=0, disposal=2)
        return

    # Create frames for animation
    frames = []
    num_frames = 8  # 8 frames for smooth animation

    # Pre-process: Create a color palette that includes transparency
    # We'll use a consistent palette across all frames
    palette_image = Image.new('P', (1, 1))
    palette_colors = []

    # Add key colors to palette (white and various opacity levels)
    for i in range(32):
        gray_level = int(255 * (1 - i/31))
        palette_colors.extend([gray_level, gray_level, gray_level])

    # Pad palette to 256 colors
    while len(palette_colors) < 768:
        palette_colors.extend([0, 0, 0])

    for frame_idx in range(num_frames):
        # Create frame with TRANSPARENT background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate vertical offset for floating (up and down movement)
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Process ghost with fading based on progress
        ghost = ghost_original.copy()

        # Apply opacity adjustment
        if progress < 1.0:
            # Get pixel data
            pixels = ghost.load()

            for y in range(ghost.height):
                for x in range(ghost.width):
                    r, g, b, a = pixels[x, y]
                    if a > 0:  # Only process non-transparent pixels
                        # Scale the alpha channel based on progress
                        new_a = int(a * progress)
                        # Keep colors intact, just adjust alpha
                        pixels[x, y] = (r, g, b, new_a)

        # Position ghost (centered with floating offset)
        x_pos = 0  # Ghost is already 16x16
        y_pos = y_offset

        # Ensure within bounds
        y_pos = max(-2, min(y_pos, 2))  # Allow slight movement off edge

        # Paste ghost onto transparent frame
        frame.paste(ghost, (x_pos, y_pos), ghost)

        # Convert to indexed color with transparency
        # Use quantize for better color preservation
        frame_indexed = frame.quantize(colors=32, method=2)  # Method 2 = Fast octree

        # Ensure transparency is preserved
        # Get the transparency from the original RGBA image
        alpha = frame.split()[-1]
        mask = alpha.point(lambda p: 255 if p > 128 else 0)
        frame_indexed.paste(255, None, mask)  # Set transparent pixels

        frames.append(frame_indexed)

    # Save as animated GIF with transparency
    if frames:
        # Set transparency index for first frame
        frames[0].info['transparency'] = 255

        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=120,  # 120ms per frame
            loop=0,  # Loop forever
            transparency=255,  # Transparency index
            disposal=2,  # Dispose between frames (important for transparency)
            optimize=False  # Don't optimize - preserve transparency
        )

def main():
    """Generate all floating ghost GIF icons with transparent backgrounds."""
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating ghost GIFs with TRANSPARENT background...")
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

                # Check for transparency
                has_transparency = 'transparency' in img.info or img.mode == 'P'

                print(f"  {filename}: {opacity_percent}% opacity, {frames} frames, animated={animated}, transparent={has_transparency}")
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
    print("Ghost GIF generation complete with transparent backgrounds!")

    # Test a sample to ensure it's working
    test_path = os.path.join(output_dir, "ghost-5-2.gif")
    if os.path.exists(test_path):
        test_img = Image.open(test_path)
        print(f"\nTest verification (ghost-5-2.gif):")
        print(f"  Frames: {getattr(test_img, 'n_frames', 1)}")
        print(f"  Animated: {getattr(test_img, 'is_animated', False)}")
        print(f"  Size: {test_img.size}")
        print(f"  Mode: {test_img.mode}")
        print(f"  Has transparency: {'transparency' in test_img.info}")

        # Check actual pixel values
        test_img.seek(0)
        test_rgba = test_img.convert('RGBA')
        # Check corners for transparency
        corners = [
            test_rgba.getpixel((0, 0)),
            test_rgba.getpixel((15, 0)),
            test_rgba.getpixel((0, 15)),
            test_rgba.getpixel((15, 15))
        ]
        print(f"  Corner pixels (should be transparent): {corners[0]}")

if __name__ == "__main__":
    main()