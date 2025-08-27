#!/bin/bash

# Script to add rounded corners to PNG icons using ImageMagick-like effect with sips
# We'll create a mask and apply it to round the corners

for size in 16 32 48 128; do
    input="icon-${size}.png"
    
    # Check if original exists in originals folder
    if [ -f "originals/${input}" ]; then
        echo "Processing ${input}..."
        
        # Calculate corner radius (approximately 20% of the size for nice rounding)
        radius=$((size * 20 / 100))
        
        # Since sips doesn't have direct rounded corner support, we'll use a workaround
        # Create a temporary Python script to add rounded corners
        cat > temp_round.py << EOF
from PIL import Image, ImageDraw
import sys

size = ${size}
radius = ${radius}

# Open the image
img = Image.open('originals/${input}').convert("RGBA")

# Create a mask for rounded corners
mask = Image.new('L', (size, size), 0)
draw = ImageDraw.Draw(mask)
draw.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=255)

# Apply the mask
output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
output.paste(img, (0, 0))
output.putalpha(mask)

# Save the result
output.save('${input}')
print(f"Saved rounded ${input}")
EOF
        
        # Run the Python script
        python3 temp_round.py
        
        # Clean up
        rm temp_round.py
    else
        echo "Warning: originals/${input} not found"
    fi
done

echo "All icons have been rounded!"