#!/usr/bin/env python3
from PIL import Image
import os
import struct

def create_apng_from_gif(gif_path, output_path):
    """Convert animated GIF to animated PNG (APNG) with true RGBA"""
    print(f"Converting {gif_path} to APNG with 32-bit RGBA...")

    with Image.open(gif_path) as gif:
        frames = []
        durations = []

        # Extract all frames
        try:
            frame_num = 0
            while True:
                # Convert to RGBA with true alpha channel
                frame_rgba = gif.convert('RGBA')

                # Ensure 16x16
                if frame_rgba.size != (16, 16):
                    frame_rgba = frame_rgba.resize((16, 16), Image.Resampling.NEAREST)

                frames.append(frame_rgba)
                duration = gif.info.get('duration', 150)
                durations.append(duration)

                print(f"  Frame {frame_num}: {frame_rgba.mode} {frame_rgba.size}")

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
            print(f"✓ Saved as APNG: {output_path}")

            # Verify the output
            with Image.open(output_path) as img:
                print(f"  Format: {img.format}")
                print(f"  Mode: {img.mode}")
                print(f"  Size: {img.size}")

            return True

    return False

def create_webp_from_gif(gif_path, output_path):
    """Convert animated GIF to animated WebP with true RGBA"""
    print(f"Converting {gif_path} to WebP with 32-bit RGBA...")

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

        # Save as animated WebP
        if frames:
            frames[0].save(
                output_path,
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=0,
                lossless=True,
                format='WEBP'
            )
            print(f"✓ Saved as WebP: {output_path}")

            # Verify
            with Image.open(output_path) as img:
                print(f"  Format: {img.format}")
                print(f"  Mode: {img.mode}")
                print(f"  Size: {img.size}")

            return True

    return False

def create_single_rgba_png(gif_path, output_path):
    """Extract first frame as static RGBA PNG (fallback option)"""
    print(f"Extracting first frame as static RGBA PNG...")

    with Image.open(gif_path) as gif:
        # Convert first frame to RGBA
        frame_rgba = gif.convert('RGBA')

        # Ensure 16x16
        if frame_rgba.size != (16, 16):
            frame_rgba = frame_rgba.resize((16, 16), Image.Resampling.NEAREST)

        # Save as PNG
        frame_rgba.save(output_path, 'PNG')
        print(f"✓ Saved as static PNG: {output_path}")

        # Verify
        print(f"  Format: PNG")
        print(f"  Mode: {frame_rgba.mode}")
        print(f"  Size: {frame_rgba.size}")
        print(f"  ✓ True 32-bit RGBA with alpha channel")

        return True

def main():
    gif_path = "assets/icons/timer/ghost/ghost-5-0.gif"

    if not os.path.exists(gif_path):
        print(f"File not found: {gif_path}")
        return

    # Create output directory
    output_dir = "assets/icons/timer/ghost/rgba_versions"
    os.makedirs(output_dir, exist_ok=True)

    print("Converting ghost GIF to formats with true 32-bit RGBA...\n")

    # Try APNG (animated PNG)
    apng_path = os.path.join(output_dir, "ghost_rgba.apng")
    create_apng_from_gif(gif_path, apng_path)
    print()

    # Try WebP
    webp_path = os.path.join(output_dir, "ghost_rgba.webp")
    create_webp_from_gif(gif_path, webp_path)
    print()

    # Create static PNG as fallback
    png_path = os.path.join(output_dir, "ghost_rgba_static.png")
    create_single_rgba_png(gif_path, png_path)
    print()

    print("Conversion complete!")
    print("\nNOTE: Yoto may not support animated PNG or WebP.")
    print("If animation is required with 32-bit RGBA, you may need to:")
    print("1. Use multiple static PNG files (one per frame)")
    print("2. Check with Yoto if they accept the current GIF format")
    print("3. Use their streaming icon approach with iconUrl16x16")

if __name__ == "__main__":
    main()