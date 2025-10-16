#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// Plaque color palette (browns from light to dark)
const plaqueColors = [
  '#FFF3E9',
  '#FFF2E4',
  '#FFF2DE',
  '#FDECDA',
  '#FDE8D5',
  '#FFEAD1',
  '#FFE4C8',
  '#FFE1C1',
  '#FDBB6',
  '#FFD6AC'
];

async function generateToothIcons() {
  // Load the happy-teeth.png as base
  const basePath = path.join(__dirname, '../assets/timer/icons/happy-teeth.png');
  const baseImage = await loadImage(basePath);

  const canvas = createCanvas(baseImage.width, baseImage.height);
  const ctx = canvas.getContext('2d');

  // Track configurations (tracks 2-8, index 1-7)
  const trackConfigs = [
    { trackNum: 2, plaqueCount: 28 }, // Top Left Back (1:45)
    { trackNum: 3, plaqueCount: 24 }, // Top Right Front (1:30)
    { trackNum: 4, plaqueCount: 20 }, // Top Right Back (1:15)
    { trackNum: 5, plaqueCount: 16 }, // Bottom Left Front (1:00)
    { trackNum: 6, plaqueCount: 12 }, // Bottom Left Back (0:45)
    { trackNum: 7, plaqueCount: 8 },  // Bottom Right Front (0:30)
    { trackNum: 8, plaqueCount: 2 }   // Bottom Right Back (0:15)
  ];

  for (const config of trackConfigs) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw base image
    ctx.drawImage(baseImage, 0, 0);

    // Get image data to modify pixels
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // First pass: Remove the happy face (make it white)
    // We'll look for non-white, non-transparent pixels in the face area
    // and replace them with white
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;

        // Check if this pixel is part of the face (darker pixels in center area)
        // Assuming face is in middle area of teeth
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const distFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));

        // If pixel is dark (likely face) and in center area, make it white
        if (distFromCenter < 30) { // Adjust radius as needed
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const alpha = data[idx + 3];

          // If it's a dark pixel (face), make it white
          if (alpha > 0 && (r < 200 || g < 200 || b < 200)) {
            data[idx] = 255;     // R
            data[idx + 1] = 255; // G
            data[idx + 2] = 255; // B
            // Keep alpha as is
          }
        }
      }
    }

    // Put modified image data back
    ctx.putImageData(imageData, 0, 0);

    // Second pass: Add plaque squares
    // We'll add them randomly on the tooth surface
    const plaqueSize = 3; // Size of each plaque square in pixels
    const teethBounds = {
      // Define approximate tooth area bounds
      minX: 10,
      maxX: canvas.width - 10,
      minY: 10,
      maxY: canvas.height - 10
    };

    // Generate random positions for plaque
    const plaquePositions = [];
    const attempts = 0;
    const maxAttempts = 1000;

    while (plaquePositions.length < config.plaqueCount && attempts < maxAttempts) {
      const x = Math.floor(Math.random() * (teethBounds.maxX - teethBounds.minX - plaqueSize) + teethBounds.minX);
      const y = Math.floor(Math.random() * (teethBounds.maxY - teethBounds.minY - plaqueSize) + teethBounds.minY);

      // Check if this position is on a white area (tooth)
      const pixelIdx = (y * canvas.width + x) * 4;
      const pixelData = ctx.getImageData(x, y, 1, 1).data;

      // If pixel is white or near-white (tooth surface)
      if (pixelData[0] > 240 && pixelData[1] > 240 && pixelData[2] > 240 && pixelData[3] > 0) {
        // Check for overlap with existing plaque
        let overlap = false;
        for (const pos of plaquePositions) {
          if (Math.abs(pos.x - x) < plaqueSize + 2 && Math.abs(pos.y - y) < plaqueSize + 2) {
            overlap = true;
            break;
          }
        }

        if (!overlap) {
          plaquePositions.push({ x, y });
        }
      }
    }

    // Draw plaque squares
    plaquePositions.forEach((pos, index) => {
      // Pick a color from the palette
      const colorIndex = index % plaqueColors.length;
      ctx.fillStyle = plaqueColors[colorIndex];

      // Draw a small square
      ctx.fillRect(pos.x, pos.y, plaqueSize, plaqueSize);

      // Add some variation with slightly different sizes
      if (Math.random() > 0.5) {
        ctx.fillRect(pos.x + 1, pos.y + 1, plaqueSize - 1, plaqueSize - 1);
      }
    });

    // Save the icon
    const outputPath = path.join(__dirname, `../assets/timer/icons/tooth-track-${config.trackNum}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Generated tooth-track-${config.trackNum}.png with ${config.plaqueCount} plaque squares`);
  }

  console.log('All tooth icons generated successfully!');
}

// Run the generation
generateToothIcons().catch(console.error);