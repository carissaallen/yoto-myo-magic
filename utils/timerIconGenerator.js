function generateTimerIcon(progress, style = 'pie') {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  const centerX = 8;
  const centerY = 8;
  const radius = 6;

  if (style === 'pie') {
    const pizzaRadius = 7.5;

    if (progress > 0) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (2 * Math.PI * progress);
      ctx.arc(centerX, centerY, pizzaRadius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = '#D2691E';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, pizzaRadius - 1.2, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = '#FFD700';
      ctx.fill();

      const numDots = Math.ceil(progress * 6);
      for (let i = 0; i < numDots; i++) {
        const angle = startAngle + (i / 6) * 2 * Math.PI;
        const dotRadius = 0.7;
        const dotDistance = pizzaRadius - 3.5;
        const dotX = centerX + Math.cos(angle) * dotDistance;
        const dotY = centerY + Math.sin(angle) * dotDistance;

        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#DC143C';
        ctx.fill();
      }

      const totalSlices = 8;
      const remainingSlices = Math.ceil(progress * totalSlices);

      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 0.5;

      for (let i = 0; i <= remainingSlices; i++) {
        const angle = startAngle + (i / totalSlices) * 2 * Math.PI;
        if (angle <= endAngle) {
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(
            centerX + Math.cos(angle) * (pizzaRadius - 1.2),
            centerY + Math.sin(angle) * (pizzaRadius - 1.2)
          );
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, pizzaRadius, startAngle, endAngle);
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const endX = centerX + Math.cos(startAngle) * pizzaRadius;
      const endY = centerY + Math.sin(startAngle) * pizzaRadius;
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const endX2 = centerX + Math.cos(endAngle) * pizzaRadius;
      const endY2 = centerY + Math.sin(endAngle) * pizzaRadius;
      ctx.lineTo(endX2, endY2);
      ctx.stroke();
    }

  } else if (style === 'circle') {
    const largeRadius = 7;

    ctx.beginPath();
    ctx.arc(centerX, centerY, largeRadius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#D0D0D0';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (progress > 0) {
      ctx.beginPath();
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (2 * Math.PI * progress);
      ctx.arc(centerX, centerY, largeRadius, startAngle, endAngle);
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  } else if (style === 'dots') {
    const totalDots = 8;
    const activeDots = Math.ceil(totalDots * progress);

    for (let i = 0; i < activeDots; i++) {
      const angle = (i / totalDots) * 2 * Math.PI - Math.PI / 2;
      const dotX = centerX + Math.cos(angle) * (radius - 1);
      const dotY = centerY + Math.sin(angle) * (radius - 1);

      ctx.beginPath();
      ctx.arc(dotX, dotY, 1, 0, 2 * Math.PI);
      ctx.fillStyle = '#f75f40';
      ctx.fill();
    }
  } else if (style === 'blocks') {
    const totalSegments = 8;
    const iconDataUrl = generateBlocksTimerIcon(progress, totalSegments);
    const img = new Image();
    img.src = iconDataUrl;
    return iconDataUrl;
  }

  return canvas.toDataURL('image/png');
}

async function generateTimerIconSet(totalMinutes, style = 'pie') {
  const segments = getTimerSegments(totalMinutes);
  const icons = [];

  for (const segment of segments) {
    const iconDataUrl = generateTimerIcon(segment.iconProgress, style);
    icons.push({
      title: segment.title,
      icon: iconDataUrl,
      progress: segment.iconProgress
    });
  }

  return icons;
}

function getTimerSegments(totalMinutes) {
  const segments = [];
  let numSegments;

  switch(totalMinutes) {
    case 2:
      numSegments = 8; // 15-second increments
      break;
    case 5:
    case 10:
    case 15:
      numSegments = totalMinutes; // 1-minute increments
      break;
    case 30:
      numSegments = 6; // 5-minute increments
      break;
    case 60:
      numSegments = 6; // 10-minute increments
      break;
    default:
      numSegments = totalMinutes;
  }

  for (let i = 0; i < numSegments; i++) {
    segments.push({
      iconProgress: 1 - (i / numSegments)
    });
  }

  return segments;
}

function generateDotsTimerIcon(progress, totalSegments) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  const centerX = 8;
  const centerY = 8;

  const activeDots = Math.ceil(totalSegments * progress);

  let dotRadius, positions;

  if (totalSegments <= 12) {
    dotRadius = totalSegments <= 8 ? 1.5 : 1.2;
    const circleRadius = 5.5;
    positions = [];
    for (let i = 0; i < totalSegments; i++) {
      const angle = (i / totalSegments) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: centerX + Math.cos(angle) * circleRadius,
        y: centerY + Math.sin(angle) * circleRadius
      });
    }
  } else if (totalSegments <= 16) {
    dotRadius = 1;
    positions = [];
    const innerCount = Math.ceil(totalSegments / 2);
    const outerCount = totalSegments - innerCount;

    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: centerX + Math.cos(angle) * 6,
        y: centerY + Math.sin(angle) * 6
      });
    }

    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * 2 * Math.PI - Math.PI / 2;
      positions.push({
        x: centerX + Math.cos(angle) * 3,
        y: centerY + Math.sin(angle) * 3
      });
    }
  } else {
    dotRadius = 0.8;
    positions = [];
    const cols = Math.ceil(Math.sqrt(totalSegments));
    const rows = Math.ceil(totalSegments / cols);
    const spacing = 2.5;
    const startX = centerX - (cols - 1) * spacing / 2;
    const startY = centerY - (rows - 1) * spacing / 2;

    for (let i = 0; i < totalSegments; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.push({
        x: startX + col * spacing,
        y: startY + row * spacing
      });
    }
  }

  for (let i = 0; i < activeDots && i < positions.length; i++) {
    const pos = positions[i];

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, dotRadius, 0, 2 * Math.PI);
    ctx.fillStyle = '#f75f40';
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

function generateBlocksTimerIcon(progress, totalSegments) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  const activeBlocks = Math.ceil(totalSegments * progress);

  const blueShades = [
    '#87CEEB',
    '#6BB6FF',
    '#4A90E2',
    '#2E7CD6',
    '#1E88E5',
    '#1565C0',
    '#0D47A1',
    '#08306B',
    '#5DADE2',
    '#3498DB',
    '#2874A6',
    '#1A5490'
  ];

  let cols, rows;

  if (totalSegments <= 4) {
    cols = totalSegments;
    rows = 1;
  } else if (totalSegments <= 8) {
    cols = 4;
    rows = Math.ceil(totalSegments / cols);
  } else if (totalSegments <= 12) {
    cols = 4;
    rows = 3;
  } else if (totalSegments <= 16) {
    cols = 4;
    rows = 4;
  } else if (totalSegments <= 25) {
    cols = 5;
    rows = Math.ceil(totalSegments / cols);
  } else {
    cols = 6;
    rows = Math.ceil(totalSegments / cols);
  }

  const gap = 1;
  const totalGapX = (cols - 1) * gap;
  const totalGapY = (rows - 1) * gap;
  const blockWidth = Math.floor((16 - totalGapX) / cols);
  const blockHeight = Math.floor((16 - totalGapY) / rows);

  const totalWidth = cols * blockWidth + totalGapX;
  const totalHeight = rows * blockHeight + totalGapY;
  const startX = Math.floor((16 - totalWidth) / 2);
  const startY = Math.floor((16 - totalHeight) / 2);

  let blockIndex = 0;
  for (let row = 0; row < rows && blockIndex < totalSegments; row++) {
    for (let col = 0; col < cols && blockIndex < totalSegments; col++) {
      const x = startX + col * (blockWidth + gap);
      const y = startY + row * (blockHeight + gap);

      if (blockIndex < activeBlocks) {
        ctx.fillStyle = blueShades[blockIndex % blueShades.length];
        ctx.fillRect(x, y, blockWidth, blockHeight);
      }

      blockIndex++;
    }
  }

  return canvas.toDataURL('image/png');
}

async function generateGhostTimerIcon(progress) {
  // Dynamically generate a ghost icon with appropriate opacity
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 16, 16);

  if (progress > 0) {
    // Try to load and draw the ghost image
    try {
      const img = new Image();
      img.src = chrome.runtime.getURL('assets/timer/icons/ghost.png');

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Set global alpha for fading effect
      ctx.globalAlpha = progress;
      ctx.drawImage(img, 0, 0, 16, 16);
    } catch (e) {
      // Fallback: draw a simple ghost shape
      ctx.globalAlpha = progress;
      ctx.fillStyle = 'white';

      // Simple ghost shape
      ctx.beginPath();
      ctx.arc(8, 7, 5, Math.PI, 0);
      ctx.lineTo(13, 13);
      ctx.lineTo(11, 11);
      ctx.lineTo(9, 13);
      ctx.lineTo(8, 11);
      ctx.lineTo(7, 13);
      ctx.lineTo(5, 11);
      ctx.lineTo(3, 13);
      ctx.closePath();
      ctx.fill();

      // Eyes
      ctx.fillStyle = 'black';
      ctx.globalAlpha = progress * 0.8;
      ctx.fillRect(5, 6, 2, 2);
      ctx.fillRect(9, 6, 2, 2);
    }
  }

  return canvas.toDataURL('image/png');
}

export { generateTimerIcon, generateTimerIconSet, generateDotsTimerIcon, generateBlocksTimerIcon, generateGhostTimerIcon };