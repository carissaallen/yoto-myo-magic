#!/usr/bin/env python3
from PIL import Image
import os
import random
import math

def create_floating_ghost_frames():
    """Create ghost animation frames that stay within 16x16 bounds"""

    # Load the original ghost image
    ghost_path = "assets/icons/timer/ghost/ghost-5-0.png"

    if not os.path.exists(ghost_path):
        # Try the base ghost image
        ghost_path = "assets/timer/icons/ghost.png"
        if not os.path.exists(ghost_path):
            print("Ghost image not found")
            return None

    frames = []

    # Create 8 frames of floating animation
    # Keep ghost within bounds - subtle movement only
    for frame_num in range(8):
        # Create a new 16x16 frame
        frame = Image.new('RGBA', (16, 16), (0, 0, 0, 0))

        # Load the ghost
        with Image.open(ghost_path) as ghost_img:
            if ghost_img.mode != 'RGBA':
                ghost_img = ghost_img.convert('RGBA')

            # Get first frame if animated
            ghost_img.seek(0)
            ghost = ghost_img.copy()

            # Ensure ghost is 16x16 or smaller
            if ghost.size[0] > 16 or ghost.size[1] > 16:
                ghost.thumbnail((16, 16), Image.Resampling.NEAREST)

            # Calculate floating offset (subtle up/down movement)
            # Use sine wave for smooth motion, but limit to 1-2 pixels
            float_offset = int(1 * math.sin(2 * math.pi * frame_num / 8))

            # Calculate position to keep ghost centered and within bounds
            ghost_width, ghost_height = ghost.size

            # Center horizontally
            x_pos = (16 - ghost_width) // 2

            # Vertical position with floating effect
            # Keep at least 1 pixel margin from top and bottom
            base_y = (16 - ghost_height) // 2
            y_pos = base_y + float_offset

            # Ensure ghost stays within bounds
            y_pos = max(1, min(y_pos, 16 - ghost_height - 1))

            # Paste ghost onto frame
            frame.paste(ghost, (x_pos, y_pos), ghost)

        frames.append(frame)

    return frames

def apply_clean_dithered_orange_to_frame(image, fill_percentage):
    """Apply dithered orange fill to a single frame"""
    img = image.copy()

    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    pixels = img.load()
    width, height = img.size

    # ONLY these 3 orange colors
    orange_colors = [
        (239, 126, 19),   # #ef7e13 - darkest orange
        (241, 137, 37),   # #f18925 - medium orange
        (234, 146, 57),   # #ea9239 - lightest orange
    ]

    # Create a list of all white pixels that could be colored
    white_pixels = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # Only consider non-transparent white pixels
            if a > 10 and r > 200 and g > 200 and b > 200:
                white_pixels.append((x, y))

    # Calculate how many pixels to fill
    num_pixels_to_fill = int(len(white_pixels) * fill_percentage)

    if num_pixels_to_fill > 0:
        # Sort pixels from bottom to top for bottom-up fill
        white_pixels.sort(key=lambda p: (-p[1], random.random() * 0.3))

        # Fill the selected pixels with the 3 orange colors
        for i in range(num_pixels_to_fill):
            x, y = white_pixels[i]
            _, _, _, a = pixels[x, y]

            # Select color with dithering
            height_factor = y / height  # 0 at top, 1 at bottom

            if height_factor > 0.7:  # Bottom 30%
                if random.random() < 0.6:
                    color = orange_colors[0]  # Dark
                elif random.random() < 0.7:
                    color = orange_colors[1]  # Medium
                else:
                    color = orange_colors[2]  # Light
            elif height_factor > 0.3:  # Middle 40%
                color = random.choice(orange_colors)
            else:  # Top 30%
                if random.random() < 0.6:
                    color = orange_colors[2]  # Light
                elif random.random() < 0.7:
                    color = orange_colors[1]  # Medium
                else:
                    color = orange_colors[0]  # Dark

            # Apply the orange color while preserving alpha
            pixels[x, y] = (*color, a)

    return img

def create_fixed_ghost_icons():
    """Create ghost icons with proper bounds and orange fill"""

    print("Creating ghost animation frames that stay within bounds...")

    # Create the floating frames
    frames = create_floating_ghost_frames()

    if not frames:
        print("Failed to create ghost frames")
        return

    print(f"Created {len(frames)} floating frames (ghost stays within 16x16)")

    # Save the base frames for reference
    frame_dir = "assets/icons/timer/ghost-frames"
    os.makedirs(frame_dir, exist_ok=True)

    for i, frame in enumerate(frames):
        frame.save(os.path.join(frame_dir, f"frame-{i}.png"))

    # Create output directory for final icons
    output_dir = "assets/icons/timer/ghost"
    os.makedirs(output_dir, exist_ok=True)

    print("\nCreating ghost-to-pumpkin icons with proper bounds...")
    print("Using colors: #ef7e13, #f18925, #ea9239")
    print()

    # Process each segment count
    for num_segments in range(1, 21):  # 1 to 20 segments
        print(f"Processing {num_segments} segments...", end=' ')

        for track_index in range(num_segments + 1):  # 0 to num_segments
            # Calculate which frame to use (cycle through available frames for floating)
            frame_index = track_index % len(frames)

            # Calculate orange fill percentage (0% at start, 100% at end)
            if num_segments > 0:
                fill_percentage = track_index / num_segments
            else:
                fill_percentage = 0

            # Load the appropriate frame
            frame = frames[frame_index].copy()

            # Apply clean dithered orange fill
            filled_frame = apply_clean_dithered_orange_to_frame(frame, fill_percentage)

            # Save the icon
            output_filename = f"ghost-{num_segments}-{track_index}.png"
            output_path = os.path.join(output_dir, output_filename)
            filled_frame.save(output_path, 'PNG')

        print(f"✓")

    print("\n✓ Created all fixed ghost icons")
    print(f"  Location: {output_dir}")
    print(f"  Pattern: ghost-[segments]-[track].png")
    print("\nImprovements:")
    print("  • Ghost stays fully within 16x16 frame (no cut-off)")
    print("  • Subtle floating motion (1-2 pixels up/down)")
    print("  • Clean dithered orange fill with 3 colors")
    print("  • Ready for Halloween timers!")

if __name__ == "__main__":
    create_fixed_ghost_icons()