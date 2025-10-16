#!/usr/bin/env python3
import shutil
import os

def main():
    """Copy the fixed ghost GIF to all track positions."""

    source_gif = "ghost_float_fixed.gif"
    output_dir = "assets/icons/timer/ghost"

    if not os.path.exists(source_gif):
        print(f"Error: {source_gif} not found!")
        return

    os.makedirs(output_dir, exist_ok=True)

    print(f"Copying {source_gif} to all track positions...")
    print("=" * 60)

    # Generate for all segment configurations
    for total_segments in range(1, 21):
        for i in range(total_segments + 1):
            # Standard naming
            filename = f"ghost-{total_segments}-{i}.gif"
            output_path = os.path.join(output_dir, filename)
            shutil.copy(source_gif, output_path)

            # Also create segment-specific names for common configs
            if total_segments in [5, 6, 8, 10, 12, 15]:
                alt_filename = f"{total_segments}-segments-{i}.gif"
                alt_path = os.path.join(output_dir, alt_filename)
                shutil.copy(source_gif, alt_path)

        print(f"Created files for {total_segments}-segment timer")

    print("\n" + "=" * 60)
    print("Done! All ghost track files now use the fixed animated GIF.")
    print("The same animated ghost will appear on all tracks.")

    # Verify one of them
    from PIL import Image
    test_path = os.path.join(output_dir, "ghost-5-2.gif")
    img = Image.open(test_path)
    print(f"\nVerification of {test_path}:")
    print(f"  Frames: {img.n_frames}")
    print(f"  Animated: {img.is_animated}")
    print(f"  Size: {os.path.getsize(test_path)} bytes")

if __name__ == "__main__":
    main()