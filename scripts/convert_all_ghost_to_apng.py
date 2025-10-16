#!/usr/bin/env python3
from PIL import Image
import os
import glob

def convert_gif_to_apng(gif_path, output_path):
    """Convert a GIF to APNG with true 32-bit RGBA"""
    with Image.open(gif_path) as gif:
        frames = []
        durations = []

        # Extract all frames
        try:
            frame_num = 0
            while True:
                # Convert to RGBA
                frame_rgba = gif.convert('RGBA')

                # Ensure 16x16
                if frame_rgba.size != (16, 16):
                    frame_rgba = frame_rgba.resize((16, 16), Image.Resampling.NEAREST)

                frames.append(frame_rgba)
                duration = gif.info.get('duration', 150)
                durations.append(duration)

                frame_num += 1
                gif.seek(frame_num)
        except EOFError:
            pass

        # Save as animated PNG
        if frames:
            frames[0].save(
                output_path,
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=0,
                format='PNG'
            )
            return True
    return False

def main():
    # Get all ghost GIF files
    gif_files = glob.glob("assets/icons/timer/ghost/*.gif")

    print(f"Found {len(gif_files)} ghost GIF files to convert")
    print("=" * 60)

    converted_count = 0
    failed_files = []

    for gif_path in gif_files:
        # Create APNG filename (replace .gif with .png)
        base_name = os.path.basename(gif_path)
        apng_name = base_name.replace('.gif', '.png')
        apng_path = os.path.join(os.path.dirname(gif_path), apng_name)

        print(f"\nConverting: {base_name}")
        print(f"  From: {gif_path}")
        print(f"  To:   {apng_path}")

        try:
            if convert_gif_to_apng(gif_path, apng_path):
                print(f"  ✓ Success")
                converted_count += 1

                # Verify the converted file
                with Image.open(apng_path) as img:
                    print(f"  Verified: {img.format}, {img.mode}, {img.size}")
            else:
                print(f"  ✗ Failed")
                failed_files.append(gif_path)
        except Exception as e:
            print(f"  ✗ Error: {e}")
            failed_files.append(gif_path)

    print("\n" + "=" * 60)
    print(f"Conversion Summary:")
    print(f"  ✓ Successfully converted: {converted_count}/{len(gif_files)}")

    if failed_files:
        print(f"  ✗ Failed files:")
        for f in failed_files:
            print(f"    - {f}")

    print("\nAll APNG files have:")
    print("  • 16x16 dimensions")
    print("  • 32-bit RGBA color format")
    print("  • True alpha channel support")
    print("  • Animation preserved from original GIF")

if __name__ == "__main__":
    main()