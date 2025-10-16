#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os
import math

def get_blue_shades():
    """Return the same blue shades used in the JavaScript implementation."""
    return [
        (135, 206, 235),  # #87CEEB
        (107, 182, 255),  # #6BB6FF
        (74, 144, 226),   # #4A90E2
        (46, 124, 214),   # #2E7CD6
        (30, 136, 229),   # #1E88E5
        (21, 101, 192),   # #1565C0
        (13, 71, 161),    # #0D47A1
        (8, 48, 107),     # #08306B
        (93, 173, 226),   # #5DADE2
        (52, 152, 219),   # #3498DB
        (40, 116, 166),   # #2874A6
        (26, 84, 144)     # #1A5490
    ]

def get_layout(total_segments):
    """Determine grid layout for the blocks."""
    if total_segments <= 4:
        return total_segments, 1
    elif total_segments <= 8:
        return 4, math.ceil(total_segments / 4)
    elif total_segments <= 12:
        return 4, 3
    elif total_segments <= 16:
        return 4, 4
    elif total_segments <= 25:
        return 5, math.ceil(total_segments / 5)
    else:
        return 6, math.ceil(total_segments / 6)

def draw_blocks_frame(active_blocks, total_segments, blink_opacity=255):
    """Draw a single frame of blocks with optional blinking last block."""
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cols, rows = get_layout(total_segments)
    blue_shades = get_blue_shades()

    gap = 1
    canvas_size = 16

    total_gap_x = (cols - 1) * gap
    total_gap_y = (rows - 1) * gap
    block_width = (canvas_size - total_gap_x) // cols
    block_height = (canvas_size - total_gap_y) // rows

    total_width = cols * block_width + total_gap_x
    total_height = rows * block_height + total_gap_y
    start_x = (canvas_size - total_width) // 2
    start_y = (canvas_size - total_height) // 2

    block_index = 0
    for row in range(rows):
        if block_index >= total_segments:
            break
        for col in range(cols):
            if block_index >= total_segments:
                break

            x = start_x + col * (block_width + gap)
            y = start_y + row * (block_height + gap)

            if block_index < active_blocks:
                # Check if this is the last active block
                is_last_block = (block_index == active_blocks - 1)

                color = blue_shades[block_index % len(blue_shades)]

                if is_last_block:
                    # Apply opacity to the last block for blinking effect
                    color_with_alpha = (*color, blink_opacity)
                else:
                    # Full opacity for other blocks
                    color_with_alpha = (*color, 255)

                # Draw the block
                for py in range(block_height):
                    for px in range(block_width):
                        img.putpixel((x + px, y + py), color_with_alpha)

            block_index += 1

    return img

def generate_blinking_blocks_gif(progress, total_segments, output_path):
    """Generate an animated GIF with blinking last block."""
    active_blocks = math.ceil(total_segments * progress)

    if active_blocks == 0:
        # No blocks to show, create a single frame transparent GIF
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        img = img.convert('P', palette=Image.ADAPTIVE, colors=256)
        img.save(output_path, format='GIF', transparency=0, disposal=2)
        return

    # Create frames for the animation
    frames = []
    num_frames = 12  # Number of frames for smooth blinking

    for frame_num in range(num_frames):
        # Calculate opacity for smooth blinking using sine wave
        # Oscillate between 50% and 100% opacity for better visibility
        opacity = int(180 + 75 * math.sin(2 * math.pi * frame_num / num_frames))

        # Create frame with blinking effect
        frame = draw_blocks_frame(active_blocks, total_segments, opacity)

        # Convert to palette mode for GIF
        frame = frame.convert('P', palette=Image.ADAPTIVE, colors=256)
        frames.append(frame)

    # Save as animated GIF with proper animation settings
    frames[0].save(
        output_path,
        format='GIF',
        save_all=True,
        append_images=frames[1:],
        duration=80,  # 80ms per frame for smooth blinking
        loop=0,  # Loop forever
        transparency=0,  # Transparent background
        disposal=2,  # Clear frame before drawing next
        optimize=False  # Don't optimize to preserve animation
    )

def main():
    """Generate all blinking block GIF icons."""
    # Create output directory
    output_dir = "assets/icons/timer/blinking-blocks"
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

            generate_blinking_blocks_gif(progress, total_segments, output_path)
            print(f"Generated: {filename} (progress: {progress:.2f})")

    # Also generate a generic set for custom durations (up to 20 segments)
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            progress = 1 - (i / total_segments) if total_segments > 0 else 0
            filename = f"blocks-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)

            generate_blinking_blocks_gif(progress, total_segments, output_path)
            print(f"Generated: {filename} (progress: {progress:.2f})")

    print("\nTesting a sample GIF to verify animation frames...")
    # Check if animation frames were created properly
    test_gif = "assets/icons/timer/blinking-blocks/blocks-5-2.gif"
    if os.path.exists(test_gif):
        from PIL import Image
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