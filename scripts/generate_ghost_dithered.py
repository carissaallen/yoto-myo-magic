#!/usr/bin/env python3
from PIL import Image
import os
import math
import random

def generate_floating_ghost_gif(progress, total_segments, output_path):
    """Generate an animated GIF with a floating ghost that fades using dithering."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_original = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # Adjust progress to never go below 15% visibility
    adjusted_progress = 0.15 + (progress * 0.85)

    # Create frames for animation
    frames = []
    num_frames = 8

    for frame_idx in range(num_frames):
        # Create frame with transparent background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate floating offset
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))
        y_pos = max(-2, min(y_offset, 2))

        # Copy ghost
        ghost = ghost_original.copy()

        # Apply dithering for fading effect
        # Instead of changing alpha, we'll randomly hide pixels based on progress
        if adjusted_progress < 1.0:
            pixels = ghost.load()

            # Use ordered dithering pattern for consistent appearance
            # Create a dither matrix
            dither_matrix = [
                [0, 8, 2, 10],
                [12, 4, 14, 6],
                [3, 11, 1, 9],
                [15, 7, 13, 5]
            ]

            for y in range(ghost.height):
                for x in range(ghost.width):
                    r, g, b, a = pixels[x, y]
                    if a > 0:
                        # Calculate dither threshold based on position
                        dither_x = x % 4
                        dither_y = y % 4
                        threshold = dither_matrix[dither_y][dither_x] / 16.0

                        # Determine if this pixel should be visible based on progress
                        if adjusted_progress < threshold:
                            # Make pixel transparent
                            pixels[x, y] = (0, 0, 0, 0)
                        # Otherwise keep the pixel as-is (white remains white)

        # Paste ghost onto frame
        frame.paste(ghost, (0, y_pos), ghost)

        # Convert to palette mode
        # Create a simple palette with white and transparent
        frame_p = Image.new('P', (16, 16), 0)

        # Create palette: index 0 = transparent, index 1 = white, rest = various colors
        palette = []
        palette.extend([0, 0, 0])        # Index 0: transparent (black)
        palette.extend([255, 255, 255])  # Index 1: white
        palette.extend([50, 49, 49])     # Index 2: dark gray
        palette.extend([185, 229, 245])  # Index 3: light blue
        palette.extend([251, 191, 169])  # Index 4: peach

        # Fill rest with grays
        while len(palette) < 768:
            palette.extend([128, 128, 128])

        frame_p.putpalette(palette)

        # Map pixels to palette
        for y in range(16):
            for x in range(16):
                r, g, b, a = frame.getpixel((x, y))
                if a < 10:
                    frame_p.putpixel((x, y), 0)  # Transparent
                elif r > 250 and g > 250 and b > 250:
                    frame_p.putpixel((x, y), 1)  # White
                elif r < 60 and g < 60 and b < 60:
                    frame_p.putpixel((x, y), 2)  # Dark gray
                elif b > 200:
                    frame_p.putpixel((x, y), 3)  # Light blue
                else:
                    frame_p.putpixel((x, y), 4)  # Other colors

        frame_p.info['transparency'] = 0
        frames.append(frame_p)

    # Save animated GIF
    if frames:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=120,
            loop=0,
            transparency=0,
            disposal=2,
            optimize=False
        )

def main():
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating ghost GIFs with dithered transparency...")
    print("=" * 60)

    # Test with a few examples
    test_configs = [(5, 0), (5, 2), (5, 4), (5, 5)]

    for total_segments, i in test_configs:
        progress = 1 - (i / total_segments) if total_segments > 0 else 0
        adjusted = 0.15 + (progress * 0.85)
        filename = f"ghost-{total_segments}-{i}.gif"
        output_path = os.path.join(output_dir, filename)

        generate_floating_ghost_gif(progress, total_segments, output_path)

        # Verify
        img = Image.open(output_path)
        img_rgba = img.convert('RGBA')

        white_pixels = sum(1 for y in range(16) for x in range(16)
                          if img_rgba.getpixel((x,y))[:3] == (255, 255, 255))

        print(f"{filename}: progress={progress:.0%}, adjusted={adjusted:.0%}, white pixels={white_pixels}")

    print("\nGenerating all ghost GIFs...")

    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0

            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)
            generate_floating_ghost_gif(progress, total_segments, output_path)

            if total_segments in [5, 6, 8, 10, 12, 15]:
                alt_filename = f"{total_segments}-segments-{i}.gif"
                alt_path = os.path.join(output_dir, alt_filename)
                generate_floating_ghost_gif(progress, total_segments, alt_path)

    print("\nComplete! Ghost uses dithering to fade while staying white.")

if __name__ == "__main__":
    main()