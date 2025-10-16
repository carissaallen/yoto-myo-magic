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
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        img = img.convert('P', dither=None, colors=2)
        img.save(output_path, 'GIF', transparency=0)
        return

    # Create frames for animation
    frames = []
    num_frames = 8

    for frame_idx in range(num_frames):
        # Create transparent background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate floating offset
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Copy and fade ghost
        ghost = ghost_original.copy()

        if progress < 1.0:
            pixels = ghost.load()
            for y in range(ghost.height):
                for x in range(ghost.width):
                    r, g, b, a = pixels[x, y]
                    if a > 0:
                        # Only adjust alpha, keep colors intact
                        new_a = int(a * progress)
                        pixels[x, y] = (r, g, b, new_a)

        # Position ghost
        frame.paste(ghost, (0, y_offset), ghost)

        # Convert to palette mode preserving whites
        # First quantize to preserve important colors
        frame_p = frame.quantize(colors=64, method=Image.FASTOCTREE, dither=None)

        frames.append(frame_p)

    # Save animated GIF
    if frames:
        # Make sure first frame has transparency set
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=120,
            loop=0,
            transparency=0,  # Index 0 is transparent
            disposal=2,
            optimize=False
        )

def main():
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating ghost GIFs preserving white color...")

    # Generate all needed GIFs
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0

            # Standard naming
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)
            generate_floating_ghost_gif(progress, total_segments, output_path)

            # Also generate segment-specific names for common configs
            if total_segments in [5, 6, 8, 10, 12, 15]:
                alt_filename = f"{total_segments}-segments-{i}.gif"
                alt_path = os.path.join(output_dir, alt_filename)
                generate_floating_ghost_gif(progress, total_segments, alt_path)

    print("Complete!")

    # Verify
    test = Image.open("assets/icons/timer/ghost/ghost-5-0.gif")
    test_rgba = test.convert('RGBA')

    # Check for white pixels
    white_found = False
    for y in range(8):
        for x in range(8):
            p = test_rgba.getpixel((x+4, y+4))
            if p[0] > 240 and p[1] > 240 and p[2] > 240 and p[3] > 200:
                white_found = True
                break

    print(f"\nVerification: White pixels {'found' if white_found else 'NOT found'} in ghost")
    print(f"Frames: {test.n_frames}, Animated: {test.is_animated}")

if __name__ == "__main__":
    main()