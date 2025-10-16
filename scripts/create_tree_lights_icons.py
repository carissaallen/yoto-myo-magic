#!/usr/bin/env python3
from PIL import Image
import os
import random

def load_tree_template():
    """Load the existing tree.png as template"""
    tree_path = "assets/timer/icons/tree.png"
    if not os.path.exists(tree_path):
        print(f"Error: {tree_path} not found!")
        return None

    tree = Image.open(tree_path)
    if tree.mode != 'RGBA':
        tree = tree.convert('RGBA')
    return tree

def identify_special_pixels(tree_img):
    """Identify star, ornament, and gift positions"""
    pixels = tree_img.load()
    width, height = tree_img.size

    # Star color (light gold/beige at top)
    star_colors = [
        (216, 198, 131),  # #d8c683 - star color
        (232, 233, 215),  # #e8e9d7 - star highlight
    ]

    # Ornament colors to replace
    ornament_colors = [
        (254, 201, 0),    # #fec900 - gold (using closest match)
        (3, 155, 229),    # #039be5 - blue (using closest match)
        (2, 124, 221),    # #027cdd - darker blue variant
        (255, 81, 141),   # #ff518d - pink (using closest match)
        (255, 66, 120),   # #ff4278 - pink variant
        (245, 22, 22),    # #f51616 - red (using closest match)
    ]

    # Gift colors at bottom (keep these)
    gift_colors = [
        (253, 147, 0),    # #fd9300 - orange gift
        (175, 0, 0),      # #af0000 - dark red gift
        (187, 0, 0),      # #bb0000 - red gift
    ]

    # Tree green colors
    tree_greens = [
        (0, 108, 0),      # #006c00 - medium green (most common)
        (0, 77, 0),       # #004d00 - dark green
        (0, 138, 0),      # #008a00 - bright green
    ]

    star_positions = []
    ornament_positions = []
    gift_positions = []

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 0:
                color = (r, g, b)

                # Check if it's a star pixel
                if color in star_colors:
                    star_positions.append((x, y, color))

                # Check if it's an ornament
                elif color in ornament_colors:
                    ornament_positions.append((x, y, color))

                # Check if it's a gift
                elif color in gift_colors:
                    gift_positions.append((x, y, color))

    return star_positions, ornament_positions, gift_positions, tree_greens

def create_tree_lights_icons():
    """Create tree lights icons with progressive decoration"""

    print("Creating Tree Lights timer icons from exact template...")

    # Load the template
    template = load_tree_template()
    if not template:
        return

    # Identify special pixels
    star_positions, ornament_positions, gift_positions, tree_greens = identify_special_pixels(template)

    print(f"Found {len(star_positions)} star pixels")
    print(f"Found {len(ornament_positions)} ornament pixels")
    print(f"Found {len(gift_positions)} gift pixels (will keep these)")

    # Create output directory
    output_dir = "assets/icons/timer/tree-lights"
    os.makedirs(output_dir, exist_ok=True)

    print("\nGenerating tree decoration icons...")
    print("Using exact ornament colors: #fec901, #049be5, #ff528d, #f51615")
    print("Pattern: Green tree with gifts → Add ornaments → Star on final track")
    print()

    # Sort ornaments by position (top to bottom, left to right) for consistent ordering
    ornament_positions.sort(key=lambda p: (p[1], p[0]))

    # Process each segment count
    for num_segments in range(1, 21):  # 1 to 20 segments
        print(f"Processing {num_segments} segments...", end=' ')

        for track_index in range(num_segments + 1):  # 0 to num_segments (including final track)

            # Start with the template
            img = template.copy()
            pixels = img.load()

            # Handle star pixels
            if track_index < num_segments:  # Not the final track
                # Remove star pixels first
                for x, y, _ in star_positions:
                    pixels[x, y] = (0, 0, 0, 0)

                # Add connecting pixel between where star was and tree body
                # This fills the gap at position (8,2) so tree doesn't look cut off
                pixels[8, 2] = (0, 108, 0, 255)  # Medium green to connect

            # Handle ornament pixels
            if track_index < num_segments:  # Not the final track
                # Calculate how many ornaments to show
                if track_index == 0:
                    # First track: no ornaments (all green)
                    ornaments_to_show = 0
                else:
                    # Progressive ornaments
                    # Evenly distribute ornaments across tracks
                    ornaments_per_track = len(ornament_positions) / (num_segments - 1) if num_segments > 1 else 0
                    ornaments_to_show = int(ornaments_per_track * track_index)

                # Replace all ornaments with green first
                for x, y, color in ornament_positions:
                    # Choose green color based on position for variety
                    green_index = (x + y) % len(tree_greens)
                    pixels[x, y] = (*tree_greens[green_index], 255)

                # Add back the appropriate number of ornaments
                for i in range(min(ornaments_to_show, len(ornament_positions))):
                    x, y, original_color = ornament_positions[i]
                    pixels[x, y] = (*original_color, 255)

            # Final track (track_index == num_segments): leave everything as is (full decoration + star)

            # Gifts always stay (they're already in the template)

            # Save the icon
            output_filename = f"tree-{num_segments}-{track_index}.png"
            output_path = os.path.join(output_dir, output_filename)
            img.save(output_path, 'PNG')

        print("✓")

    print("\n✓ Created all Tree Lights icons")
    print(f"  Location: {output_dir}")
    print(f"  Pattern: tree-[segments]-[track].png")
    print("\nFeatures:")
    print("  • Uses exact tree.png template")
    print("  • Gifts always present at bottom")
    print("  • First track: fully green tree (no ornaments)")
    print("  • Progressive ornaments added each track")
    print("  • Final track: full decoration with star (Time's Up!)")

def create_preview_strip():
    """Create a preview strip showing the progression"""
    output_dir = "assets/icons/timer/tree-lights"

    from PIL import Image, ImageDraw

    # Load samples at different stages for a 5-track timer
    samples = []
    labels = []

    stages = [
        (0, "Track 1"),
        (1, "Track 2"),
        (3, "Track 4"),
        (5, "Time's Up!")
    ]

    for i, label in stages:
        img_path = os.path.join(output_dir, f"tree-5-{i}.png")
        if os.path.exists(img_path):
            img = Image.open(img_path)
            # Scale up for visibility
            img = img.resize((64, 64), Image.Resampling.NEAREST)
            samples.append(img)
            labels.append(label)

    if samples:
        # Create comparison strip
        strip_width = len(samples) * 80
        strip = Image.new('RGBA', (strip_width, 100), (40, 40, 40, 255))
        draw = ImageDraw.Draw(strip)

        for i, (sample, label) in enumerate(zip(samples, labels)):
            x_pos = i * 80 + 8
            strip.paste(sample, (x_pos, 8), sample)

            # Add label
            text_x = x_pos + 32 - len(label) * 3
            draw.text((text_x, 78), label, fill=(255, 255, 255))

        strip.save("tree-lights-final-preview.png")
        print("\n✓ Created preview image: tree-lights-final-preview.png")

if __name__ == "__main__":
    create_tree_lights_icons()
    create_preview_strip()