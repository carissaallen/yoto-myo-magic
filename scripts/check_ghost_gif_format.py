#!/usr/bin/env python3
from PIL import Image
import os
import sys

def check_gif_format(filepath):
    """Check if GIF meets Yoto's requirements"""
    print(f"\nAnalyzing: {filepath}")
    print("=" * 60)

    try:
        with Image.open(filepath) as img:
            print(f"Format: {img.format}")
            print(f"Mode: {img.mode}")
            print(f"Size: {img.size}")
            print(f"Info: {img.info}")

            # Check dimensions
            if img.size != (16, 16):
                print(f"❌ ERROR: Size is {img.size}, must be 16x16")
                return False
            else:
                print(f"✓ Size is correct: 16x16")

            # Check if animated
            try:
                img.seek(1)
                print(f"✓ Animated GIF with multiple frames")
                img.seek(0)
            except EOFError:
                print(f"⚠️  Static GIF (single frame)")

            # Check color mode
            print(f"\nColor Mode Analysis:")
            print(f"  Current mode: {img.mode}")

            if img.mode == 'P':
                print(f"  Palette mode with {len(img.getpalette())//3} colors")
                if 'transparency' in img.info:
                    print(f"  Has transparency index: {img.info['transparency']}")
            elif img.mode == 'RGBA':
                print(f"  ✓ Already in RGBA mode")
            elif img.mode == 'RGB':
                print(f"  ⚠️  RGB mode without alpha channel")

            # GIF limitations
            print(f"\n⚠️  IMPORTANT: GIF format limitations:")
            print(f"  - GIF only supports indexed color (256 colors max)")
            print(f"  - GIF only supports 1-bit transparency (on/off)")
            print(f"  - Cannot have true 32-bit RGBA with alpha gradients")

            print(f"\n📝 Yoto requires: 16x16 with 32-bit RGBA including alpha")
            print(f"  - Current GIF may not meet this requirement")
            print(f"  - Consider using PNG format for true RGBA support")

            return True

    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return False

def convert_gif_to_rgba_frames(gif_path, output_dir):
    """Extract GIF frames as RGBA PNGs"""
    print(f"\nExtracting frames as RGBA PNGs...")

    os.makedirs(output_dir, exist_ok=True)

    with Image.open(gif_path) as img:
        frame_count = 0
        durations = []

        try:
            while True:
                # Convert frame to RGBA
                frame_rgba = img.convert('RGBA')

                # Save as PNG
                frame_path = os.path.join(output_dir, f"frame_{frame_count:03d}.png")
                frame_rgba.save(frame_path, 'PNG')
                print(f"  Saved frame {frame_count} as RGBA PNG: {frame_path}")

                # Get frame duration
                duration = img.info.get('duration', 100)
                durations.append(duration)

                frame_count += 1
                img.seek(frame_count)

        except EOFError:
            pass

    print(f"\nExtracted {frame_count} frames")
    print(f"Frame durations (ms): {durations}")

    return frame_count, durations

def main():
    # Check a sample ghost GIF
    sample_gif = "assets/icons/timer/ghost/ghost-5-0.gif"

    if os.path.exists(sample_gif):
        check_gif_format(sample_gif)

        # Extract frames to see RGBA conversion
        output_dir = "temp_ghost_frames"
        convert_gif_to_rgba_frames(sample_gif, output_dir)

        # Check extracted frame
        frame_path = os.path.join(output_dir, "frame_000.png")
        if os.path.exists(frame_path):
            print(f"\nChecking extracted PNG frame:")
            with Image.open(frame_path) as img:
                print(f"  Format: {img.format}")
                print(f"  Mode: {img.mode}")
                print(f"  Size: {img.size}")
                print(f"  ✓ This PNG is in true RGBA format")
    else:
        print(f"File not found: {sample_gif}")

    # Also check the fixed ghost GIF if it exists
    fixed_gif = "ghost_float_fixed.gif"
    if os.path.exists(fixed_gif):
        print("\n" + "="*60)
        check_gif_format(fixed_gif)

if __name__ == "__main__":
    main()