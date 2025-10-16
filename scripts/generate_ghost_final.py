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
        # Create single transparent frame
        img = Image.new('P', (16, 16))
        # Set a simple palette with first color as transparent
        img.putpalette([0,0,0] + [255,255,255] + [128,128,128] * 85 + [0,0,0])
        img.info['transparency'] = 0
        img.save(output_path, 'GIF', transparency=0)
        return

    # Create frames for animation
    frames = []
    num_frames = 8  # 8 frames for smooth animation

    for frame_idx in range(num_frames):
        # Create frame with transparent background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate vertical offset for floating (up and down movement)
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))

        # Process ghost with fading based on progress
        ghost = ghost_original.copy()

        if progress < 1.0:
            # Apply opacity adjustment to all pixels
            pixels = ghost.load()
            for y in range(ghost.height):
                for x in range(ghost.width):
                    r, g, b, a = pixels[x, y]
                    if a > 0:  # Only process non-transparent pixels
                        # Scale alpha based on progress
                        new_a = int(a * progress)
                        pixels[x, y] = (r, g, b, new_a)

        # Position ghost (centered with floating offset)
        x_pos = 0  # Ghost is already 16x16
        y_pos = y_offset
        # Allow slight movement but keep within bounds
        y_pos = max(-2, min(y_pos, 2))

        # Paste ghost onto transparent frame
        frame.paste(ghost, (x_pos, y_pos), ghost)

        # Convert to palette mode for GIF
        # First create a palette that reserves index 0 for transparency
        # Use a simple approach: convert to P mode then set transparency

        # Create a version with a specific background color we'll make transparent
        frame_with_bg = Image.new('RGBA', (16, 16), (1, 1, 1, 255))  # Very dark gray background
        frame_with_bg.paste(frame, (0, 0), frame)

        # Convert to palette
        frame_p = frame_with_bg.convert('P', palette=Image.ADAPTIVE, colors=31)

        # Find the background color index (should be dark gray we set)
        # Get palette
        palette = frame_p.getpalette()

        # Find index of our background color (1,1,1)
        trans_index = 0
        for i in range(0, len(palette), 3):
            if palette[i] <= 1 and palette[i+1] <= 1 and palette[i+2] <= 1:
                trans_index = i // 3
                break

        # Set transparency
        frame_p.info['transparency'] = trans_index

        frames.append(frame_p)

    # Save as animated GIF with transparency
    if frames:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=120,  # 120ms per frame
            loop=0,  # Loop forever
            transparency=frames[0].info.get('transparency', 0),
            disposal=2,  # Dispose between frames
            optimize=False  # Don't optimize
        )

def main():
    """Generate all floating ghost GIF icons."""
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating ghost GIFs with proper transparency...")
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

    # Generate specific segment configs
    for total_segments, segment_name in segment_configs:
        print(f"\nGenerating {segment_name}:")
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"{segment_name}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_floating_ghost_gif(progress, total_segments, output_path)

            # Verify
            try:
                img = Image.open(output_path)
                print(f"  {filename}: {int(progress*100)}% opacity, {img.n_frames} frames")
            except Exception as e:
                print(f"  {filename}: Error - {e}")

    # Generate generic set
    print("\nGenerating generic set (1-20 segments)...")
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)
            generate_floating_ghost_gif(progress, total_segments, output_path)

    print("\n" + "=" * 60)
    print("Complete! Ghost GIFs generated with proper transparency.")

    # Final verification
    test_path = "assets/icons/timer/ghost/ghost-5-2.gif"
    if os.path.exists(test_path):
        img = Image.open(test_path)
        print(f"\nVerification of {test_path}:")
        print(f"  Animated: {img.is_animated}")
        print(f"  Frames: {img.n_frames}")
        print(f"  Has transparency info: {'transparency' in img.info}")

        # Check actual transparency
        img.seek(0)
        img_rgba = img.convert('RGBA')
        # Sample a corner pixel
        corner = img_rgba.getpixel((0, 0))
        print(f"  Corner pixel RGBA: {corner}")
        print(f"  Corner is {'transparent' if corner[3] < 128 else 'opaque'}")

if __name__ == "__main__":
    main()