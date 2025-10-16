#!/usr/bin/env python3
from PIL import Image, ImagePalette
import os
import math

def create_custom_palette():
    """Create a palette that ensures white is preserved."""
    palette = []

    # IMPORTANT: Reserve specific indices for key colors
    # Index 0: Transparent (will be set as transparency index)
    palette.extend([0, 0, 0])

    # Index 1: Pure white (for the ghost body)
    palette.extend([255, 255, 255])

    # Index 2-5: Near-white shades for antialiasing
    palette.extend([250, 250, 250])
    palette.extend([245, 245, 245])
    palette.extend([240, 240, 240])
    palette.extend([235, 235, 235])

    # Index 6-10: Light blues (for ghost details if any)
    palette.extend([185, 229, 245])
    palette.extend([170, 220, 240])
    palette.extend([155, 210, 235])
    palette.extend([140, 200, 230])
    palette.extend([125, 190, 225])

    # Index 11-15: Other colors from the original ghost
    palette.extend([251, 191, 169])  # Peachy color
    palette.extend([50, 49, 49])     # Dark gray
    palette.extend([100, 100, 100])  # Medium gray
    palette.extend([150, 150, 150])  # Light gray
    palette.extend([200, 200, 200])  # Very light gray

    # Fill rest with gradient
    while len(palette) < 768:  # 256 * 3
        palette.extend([128, 128, 128])

    return palette

def generate_floating_ghost_gif(progress, total_segments, output_path):
    """Generate an animated GIF with a floating WHITE ghost that fades with progress."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_original = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # Adjust progress to never go below 20% opacity (so ghost is always visible)
    # Map progress from [0, 1] to [0.2, 1.0]
    # This ensures even on the last track, ghost is at 20% opacity
    adjusted_progress = 0.2 + (progress * 0.8)

    # Special case: if this is truly the last segment (progress = 0),
    # still show ghost at minimum visibility
    if progress == 0 and total_segments > 0:
        adjusted_progress = 0.2  # 20% minimum visibility

    # Create frames for animation
    frames = []
    num_frames = 8
    custom_palette = create_custom_palette()

    for frame_idx in range(num_frames):
        # Create frame with transparent background
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Calculate floating offset
        y_offset = int(2.5 * math.sin(2 * math.pi * frame_idx / num_frames))
        y_pos = max(-2, min(y_offset, 2))

        # Process ghost
        ghost = ghost_original.copy()

        # Apply fading using adjusted_progress (never goes below 20%)
        if adjusted_progress < 1.0:
            pixels = ghost.load()
            for y in range(ghost.height):
                for x in range(ghost.width):
                    r, g, b, a = pixels[x, y]
                    if a > 0:
                        # Preserve white pixels!
                        if r > 250 and g > 250 and b > 250:
                            # Keep white pixels white, just adjust alpha
                            new_a = int(a * adjusted_progress)
                            pixels[x, y] = (255, 255, 255, new_a)
                        else:
                            # For non-white pixels, adjust alpha
                            new_a = int(a * adjusted_progress)
                            pixels[x, y] = (r, g, b, new_a)

        # Paste ghost onto frame
        frame.paste(ghost, (0, y_pos), ghost)

        # Convert to palette mode with our custom palette
        # Create a new P mode image with our palette
        frame_p = Image.new('P', (16, 16), 0)
        frame_p.putpalette(custom_palette)

        # Convert RGBA frame to RGB for pasting (handling transparency manually)
        frame_rgb = Image.new('RGB', (16, 16), (0, 0, 0))

        # Manually copy pixels, mapping to nearest palette color
        for y in range(16):
            for x in range(16):
                r, g, b, a = frame.getpixel((x, y))
                if a < 10:  # Only truly transparent pixels (lowered threshold)
                    frame_p.putpixel((x, y), 0)  # Index 0 = transparent
                elif r > 250 and g > 250 and b > 250:  # White (even if faded)
                    frame_p.putpixel((x, y), 1)  # Index 1 = white
                elif r > 180 and g > 220 and b > 240:  # Light blue
                    frame_p.putpixel((x, y), 6)  # Index 6 = light blue
                elif r > 240 and g > 180 and b > 160:  # Peachy
                    frame_p.putpixel((x, y), 11)  # Index 11 = peach
                elif r < 60 and g < 60 and b < 60:  # Dark
                    frame_p.putpixel((x, y), 12)  # Index 12 = dark gray
                else:
                    # Find nearest color in palette
                    if a > 10:  # If it has any opacity, show it
                        if r > 200:
                            frame_p.putpixel((x, y), 2)  # Near white
                        else:
                            frame_p.putpixel((x, y), 14)  # Light gray
                    else:
                        frame_p.putpixel((x, y), 0)  # Transparent

        # Set transparency
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

    print("Generating WHITE ghost GIFs with proper transparency...")
    print("=" * 60)

    # Test with a few first
    test_configs = [(5, 0), (5, 2), (5, 4)]

    for total_segments, i in test_configs:
        progress = 1 - (i / total_segments) if total_segments > 0 else 0
        actual_opacity = 0.2 + (progress * 0.8)  # Show actual opacity used
        filename = f"ghost-{total_segments}-{i}.gif"
        output_path = os.path.join(output_dir, filename)

        generate_floating_ghost_gif(progress, total_segments, output_path)

        # Verify the result
        img = Image.open(output_path)
        img.seek(0)

        # Check palette for white
        palette = img.getpalette()
        has_white = False
        if palette:
            # Check if white (255,255,255) is in palette
            for j in range(0, len(palette)-2, 3):
                if palette[j] == 255 and palette[j+1] == 255 and palette[j+2] == 255:
                    has_white = True
                    break

        print(f"{filename}: progress={progress:.1f} (actual opacity={actual_opacity:.0%}), frames={img.n_frames}, has_white={has_white}")

        # Check actual pixels
        white_pixels = 0
        for y in range(16):
            for x in range(16):
                pixel_index = img.getpixel((x, y))
                if pixel_index == 1:  # Index 1 should be white
                    white_pixels += 1

        print(f"  White pixels (index 1): {white_pixels}")

    # If test successful, generate all
    print("\nGenerating all ghost GIFs...")

    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0

            # Standard naming
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)
            generate_floating_ghost_gif(progress, total_segments, output_path)

            # Also generate segment-specific names
            if total_segments in [5, 6, 8, 10, 12, 15]:
                alt_filename = f"{total_segments}-segments-{i}.gif"
                alt_path = os.path.join(output_dir, alt_filename)
                generate_floating_ghost_gif(progress, total_segments, alt_path)

    print("\n" + "=" * 60)
    print("Complete! Ghost should now appear as filled WHITE, not outline!")

if __name__ == "__main__":
    main()