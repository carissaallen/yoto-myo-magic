#!/usr/bin/env python3
from PIL import Image
import os

def generate_static_ghost_icon(progress, total_segments, output_path):
    """Generate a static PNG with ghost at appropriate opacity."""

    # Load the ghost image
    ghost_path = "assets/timer/icons/ghost.png"
    try:
        ghost_base = Image.open(ghost_path).convert('RGBA')
    except FileNotFoundError:
        print(f"Error: Could not find {ghost_path}")
        return

    # If progress is 0, create a transparent image
    if progress == 0:
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        img.save(output_path, format='PNG')
        return

    # Create image with transparent background
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

    # Apply fading to the ghost
    ghost_copy = ghost_base.copy()
    if progress < 1.0:
        # Adjust the alpha channel of all pixels
        data = ghost_copy.getdata()
        new_data = []
        for item in data:
            # Scale the alpha channel
            new_alpha = int(item[3] * progress)
            new_data.append((item[0], item[1], item[2], new_alpha))
        ghost_copy.putdata(new_data)

    # Center the ghost
    x_pos = (16 - ghost_copy.width) // 2
    y_pos = (16 - ghost_copy.height) // 2

    # Paste ghost onto image
    img.paste(ghost_copy, (x_pos, y_pos), ghost_copy)

    # Save as PNG
    img.save(output_path, format='PNG')

def main():
    """Generate static ghost icons as fallback."""
    output_dir = "assets/icons/timer/ghost-static"
    os.makedirs(output_dir, exist_ok=True)

    print("Generating static ghost PNGs as fallback...")

    # Generate for various segment counts
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"ghost-{total_segments}-{i}.png"
            output_path = os.path.join(output_dir, filename)

            generate_static_ghost_icon(progress, total_segments, output_path)

        print(f"Generated {total_segments} segments")

if __name__ == "__main__":
    main()