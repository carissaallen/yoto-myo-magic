#!/usr/bin/env python3

from PIL import Image, ImageDraw
import random
import os

# Plaque color palette - using lighter browns from provided palette
plaque_colors = [
    (255, 234, 209),  # #FFEAD1
    (255, 228, 200),  # #FFE4C8
    (255, 225, 193),  # #FFE1C1
    (253, 187, 182),  # #FDBB6 (actually #FDBBB6)
    (255, 214, 172),  # #FFD6AC
]

def generate_tooth_icons():
    # Load the happy-teeth.png as base
    base_path = 'assets/timer/icons/happy-teeth.png'
    base_image = Image.open(base_path).convert('RGBA')
    width, height = base_image.size

    # Track configurations (tracks 2-8)
    # Increased plaque count for better visibility
    track_configs = [
        (2, 20),  # Top Left Back (1:45) - most plaque
        (3, 17),  # Top Right Front (1:30)
        (4, 14),  # Top Right Back (1:15)
        (5, 11),  # Bottom Left Front (1:00)
        (6, 8),   # Bottom Left Back (0:45)
        (7, 5),   # Bottom Right Front (0:30)
        (8, 2),   # Bottom Right Back (0:15) - least plaque
    ]

    for track_num, plaque_count in track_configs:
        # Create a copy of the base image
        img = base_image.copy()
        pixels = img.load()

        # First: Make EVERYTHING white except the tooth outline
        # We'll keep only the outer edge pixels and make everything else white
        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]

                # If pixel is visible
                if a > 0:
                    # Keep only if it's a very light gray or white (tooth edge/outline)
                    # Otherwise make it pure white
                    is_tooth_edge = False

                    # Check if it's on the very edge of the image
                    if x == 0 or x == width-1 or y == 0 or y == height-1:
                        # Keep transparent edge pixels as they are
                        if a < 255:
                            continue

                    # If it's a very light gray (tooth outline), keep it
                    if r > 250 and g > 250 and b > 250:
                        # Already white or near-white, keep as is
                        continue
                    elif r == g and g == b and r > 200 and r < 250:
                        # Light gray outline, keep it
                        continue

                    # Everything else becomes white (removes all blue, red, black pixels)
                    pixels[x, y] = (255, 255, 255, a)

        # Second: Find actual tooth pixels (white areas that are not transparent)
        # Build a map of valid tooth positions
        tooth_pixels = []
        for y in range(2, height - 2):  # Avoid very edge pixels
            for x in range(2, width - 2):
                r, g, b, a = pixels[x, y]
                # If it's a white pixel with full opacity (part of tooth)
                if a == 255 and r > 250 and g > 250 and b > 250:
                    # Check that it's not on the very edge of the tooth
                    # by ensuring neighboring pixels are also tooth pixels
                    neighbors_valid = True
                    for dx in [-1, 0, 1]:
                        for dy in [-1, 0, 1]:
                            if dx == 0 and dy == 0:
                                continue
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < width and 0 <= ny < height:
                                nr, ng, nb, na = pixels[nx, ny]
                                # If any neighbor is transparent, this is an edge pixel
                                if na < 255:
                                    neighbors_valid = False
                                    break
                        if not neighbors_valid:
                            break

                    if neighbors_valid:
                        tooth_pixels.append((x, y))

        # Third: Add plaque squares only on valid tooth pixels
        draw = ImageDraw.Draw(img)
        plaque_size = 1  # Single pixel for small image

        placed_plaque = 0
        attempts = 0
        max_attempts = 1000
        used_positions = []

        while placed_plaque < plaque_count and attempts < max_attempts and tooth_pixels:
            attempts += 1

            # Pick a random tooth pixel
            x, y = random.choice(tooth_pixels)

            # Check if position overlaps with existing plaque
            too_close = False
            for px, py in used_positions:
                if abs(px - x) < plaque_size + 1 and abs(py - y) < plaque_size + 1:
                    too_close = True
                    break

            if not too_close:
                # Draw plaque square using colors from the palette
                color = plaque_colors[placed_plaque % len(plaque_colors)]
                draw.rectangle([x, y, x + plaque_size, y + plaque_size], fill=color)

                used_positions.append((x, y))
                placed_plaque += 1

        # Save the icon
        output_path = f'assets/timer/icons/tooth-track-{track_num}.png'
        img.save(output_path, 'PNG')
        print(f'Generated tooth-track-{track_num}.png with {placed_plaque} plaque squares')

    print('All tooth icons generated successfully!')

if __name__ == '__main__':
    generate_tooth_icons()