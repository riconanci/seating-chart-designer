import { getTableTotalSeats, getBlockChairSpacing, getBlockDimensions, formatName } from './models';

// Shared helper: compute rect table seat positions relative to center
function getRectSeatPositions(t, scale) {
  const hw = (t.widthFt * scale) / 2;
  const hh = (t.heightFt * scale) / 2;
  const sr = 0.75 * scale;
  const gap = Math.max(3, scale * 0.2);
  const positions = [];

  // Distribute n seats edge-to-edge along a half-length dimension
  function spread(n, halfLen) {
    if (n <= 0) return [];
    if (n === 1) return [0];
    const pad = Math.min(sr + gap * 0.7, halfLen * 0.25);
    const span = 2 * halfLen - 2 * pad;
    return Array.from({ length: n }, (_, i) => -halfLen + pad + i * span / (n - 1));
  }

  if (t.orientation === 'horizontal') {
    const xs = spread(t.seats, hw);
    for (const dx of xs) {
      positions.push([dx, -hh - sr - gap]);
      positions.push([dx, hh + sr + gap]);
    }
    const ys = spread(t.endSeats, hh);
    for (const dy of ys) {
      positions.push([-hw - sr - gap, dy]);
      positions.push([hw + sr + gap, dy]);
    }
  } else {
    const ys = spread(t.seats, hh);
    for (const dy of ys) {
      positions.push([-hw - sr - gap, dy]);
      positions.push([hw + sr + gap, dy]);
    }
    const xs = spread(t.endSeats, hw);
    for (const dx of xs) {
      positions.push([dx, -hh - sr - gap]);
      positions.push([dx, hh + sr + gap]);
    }
  }
  return positions; // each [dx, dy] relative to center
}

// Determine if a hex color is light (for text contrast)
function isLightColor(hex) {
  if (!hex) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

export function drawCanvas(ctx, state, canvasW, canvasH) {
  const { roomWidth, roomHeight, tables, chairBlocks, venueElements,
    attendees, selectedItem, selectedItems, ghostEntity, ghostType,
    showPlacement, gridSize, hideGrid, scale, offsetX, offsetY, nameOrder, smartGuides, showSeatNumbers } = state;

  // Convenience flag for name ordering
  const firstFirst = nameOrder === 'firstLast';

  ctx.clearRect(0, 0, canvasW, canvasH);

  // Background
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Room floor
  const rw = roomWidth * scale;
  const rh = roomHeight * scale;
  ctx.fillStyle = '#162035';
  ctx.fillRect(offsetX, offsetY, rw, rh);
  ctx.strokeStyle = '#2d3a5a';
  ctx.lineWidth = Math.max(2, scale * 0.1);
  ctx.strokeRect(offsetX, offsetY, rw, rh);

  // Floorplan background image
  if (state.floorplanImg && state.showFloorplan !== false) {
    ctx.save();
    ctx.globalAlpha = state.floorplanOpacity ?? 0.3;
    // Clip to room bounds
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, rw, rh);
    ctx.clip();

    const img = state.floorplanImg;
    const fit = state.floorplanFit || 'stretch';

    if (fit === 'contain') {
      // Maintain aspect ratio, centered within room
      const imgAspect = img.width / img.height;
      const roomAspect = rw / rh;
      let drawW, drawH;
      if (imgAspect > roomAspect) {
        drawW = rw;
        drawH = rw / imgAspect;
      } else {
        drawH = rh;
        drawW = rh * imgAspect;
      }
      const dx = offsetX + (rw - drawW) / 2;
      const dy = offsetY + (rh - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
    } else {
      // Stretch to fill room exactly
      ctx.drawImage(img, offsetX, offsetY, rw, rh);
    }

    ctx.restore();
  }

  // Grid — visual grid size: use gridSize if set, otherwise default to 1ft; hidden if hideGrid is on
  if (!hideGrid) {
    const visualGrid = gridSize > 0 ? gridSize : 1;
    ctx.strokeStyle = 'rgba(45,58,90,0.5)';
    ctx.lineWidth = Math.max(0.5, scale * 0.03);
    for (let x = visualGrid; x < roomWidth; x += visualGrid) {
      const px = offsetX + x * scale;
      ctx.beginPath(); ctx.moveTo(px, offsetY); ctx.lineTo(px, offsetY + rh); ctx.stroke();
    }
    for (let y = visualGrid; y < roomHeight; y += visualGrid) {
      const py = offsetY + y * scale;
      ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + rw, py); ctx.stroke();
    }
  }

  // Create a local state with firstFirst for sub-functions
  const renderState = { ...state, firstFirst };

  // Venue elements (draw first, behind tables)
  venueElements.forEach(e => drawVenueElement(ctx, e, renderState));

  // Chair blocks
  chairBlocks.forEach(b => drawBlock(ctx, b, renderState));

  // Tables
  tables.forEach(t => drawTable(ctx, t, renderState));

  // Ghost placement
  if (ghostEntity) drawGhost(ctx, ghostEntity, ghostType, renderState);

  // Smart guides
  if (smartGuides && smartGuides.length > 0) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    for (const guide of smartGuides) {
      if (guide.axis === 'vertical') {
        const px = offsetX + guide.pos * scale;
        ctx.beginPath();
        ctx.moveTo(px, offsetY);
        ctx.lineTo(px, offsetY + rh);
        ctx.stroke();
      } else {
        const py = offsetY + guide.pos * scale;
        ctx.beginPath();
        ctx.moveTo(offsetX, py);
        ctx.lineTo(offsetX + rw, py);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function isSelected(entity, state) {
  if (state.selectedItems?.length > 0) {
    return state.selectedItems.some(([t, i]) => t === entity.type && i.id === entity.id);
  }
  if (state.selectedItem) {
    const [t, i] = state.selectedItem;
    return t === entity.type && i.id === entity.id;
  }
  return false;
}

function drawTable(ctx, t, state) {
  const { scale, offsetX, offsetY, attendees, showPlacement, firstFirst, showSeatNumbers } = state;
  const cx = offsetX + t.x * scale;
  const cy = offsetY + t.y * scale;
  const sel = isSelected(t, state);

  if (t.tableType === 'round') {
    const r = (t.widthFt * scale) / 2;
    // Table circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.strokeStyle = sel ? '#e2b340' : '#333';
    ctx.lineWidth = sel ? Math.max(2, scale * 0.15) : Math.max(1, scale * 0.06);
    ctx.stroke();

    // Seats
    const sr = 0.75 * scale;
    const seatGap = Math.max(3, scale * 0.2);
    for (let i = 0; i < t.seats; i++) {
      const a = (2 * Math.PI * i / t.seats) - Math.PI / 2;
      const d = r + sr + seatGap;
      const sx = cx + d * Math.cos(a);
      const sy = cy + d * Math.sin(a);
      const occ = i in t.assignments;

      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = occ ? '#48bb78' : '#3a4a6a';
      ctx.fill();
      ctx.strokeStyle = i === 0 ? '#e2b340' : '#555';
      ctx.lineWidth = i === 0 ? Math.max(2, scale * 0.12) : Math.max(1, scale * 0.06);
      ctx.stroke();

      // Seat text
      if (occ && showPlacement && t.assignments[i] < attendees.length) {
        const [last, first] = attendees[t.assignments[i]];
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, sr * 0.65)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatName(first, last, 'short', firstFirst), sx, sy);
      } else if ((i === 0 || showSeatNumbers) && (!occ || !showPlacement)) {
        ctx.fillStyle = i === 0 ? '#e2b340' : '#aaa';
        ctx.font = `${i === 0 ? 'bold ' : ''}${Math.max(8, sr * 1.43)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), sx, sy);
      }
    }
  } else {
    // Rectangular table
    const hw = (t.widthFt * scale) / 2;
    const hh = (t.heightFt * scale) / 2;

    ctx.fillStyle = t.color;
    ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.strokeStyle = sel ? '#e2b340' : '#333';
    ctx.lineWidth = sel ? Math.max(2, scale * 0.15) : Math.max(1, scale * 0.06);
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);

    // Seat positions (shared helper)
    const sr = 0.75 * scale;
    const positions = getRectSeatPositions(t, scale);

    const totalSeats = getTableTotalSeats(t);
    positions.slice(0, totalSeats).forEach(([dx, dy], i) => {
      const sx = cx + dx;
      const sy = cy + dy;
      const occ = i in t.assignments;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = occ ? '#48bb78' : '#3a4a6a';
      ctx.fill();
      ctx.strokeStyle = i === 0 ? '#e2b340' : '#555';
      ctx.lineWidth = i === 0 ? Math.max(2, scale * 0.12) : Math.max(1, scale * 0.06);
      ctx.stroke();

      if (occ && showPlacement && t.assignments[i] < attendees.length) {
        const [last, first] = attendees[t.assignments[i]];
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, sr * 0.65)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatName(first, last, 'short', firstFirst), sx, sy);
      } else if ((i === 0 || showSeatNumbers) && (!occ || !showPlacement)) {
        ctx.fillStyle = i === 0 ? '#e2b340' : '#aaa';
        ctx.font = `${i === 0 ? 'bold ' : ''}${Math.max(8, sr * 1.43)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), sx, sy);
      }
    });
  }

  // Table name
  const name = t.name || `Table ${t.id}`;
  const isLight = isLightColor(t.color);
  ctx.font = `bold ${Math.max(10, scale * 0.9)}px "DM Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLight ? '#000' : '#fff';
  ctx.fillText(name, cx, cy);

  if (t.locked) {
    ctx.fillStyle = '#e2b340';
    ctx.font = `${Math.max(12, scale * 0.8)}px sans-serif`;
    ctx.fillText('🔒', cx, cy + Math.max(14, scale * 1));
  }
}

function drawBlock(ctx, b, state) {
  const { scale, offsetX, offsetY, attendees, showPlacement, firstFirst, showSeatNumbers } = state;
  const dims = getBlockDimensions(b);
  const x = offsetX + b.x * scale;
  const y = offsetY + b.y * scale;
  const w = dims.widthFt * scale;
  const h = dims.heightFt * scale;
  const sel = isSelected(b, state);

  // Dashed border
  ctx.setLineDash([Math.max(6, scale * 0.4), Math.max(4, scale * 0.25)]);
  ctx.strokeStyle = sel ? '#e2b340' : '#555';
  ctx.lineWidth = sel ? Math.max(2, scale * 0.12) : Math.max(1, scale * 0.06);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Label
  if (b.name) {
    ctx.fillStyle = '#aaa';
    ctx.font = `${Math.max(11, scale * 0.7)}px "DM Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(b.name, x + w / 2, y - Math.max(4, scale * 0.25));
  }

  // Chairs
  const cs = getBlockChairSpacing(b) * scale;
  const chairSize = 1.2 * scale;
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cx2 = x + (c + 0.5) * cs;
      const cy2 = y + (r + 0.5) * cs;
      const key = `${r}-${c}`;
      const occ = key in b.assignments;

      ctx.fillStyle = occ ? '#48bb78' : b.color;
      ctx.fillRect(cx2 - chairSize / 2, cy2 - chairSize / 2, chairSize, chairSize);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = Math.max(1, scale * 0.06);
      ctx.strokeRect(cx2 - chairSize / 2, cy2 - chairSize / 2, chairSize, chairSize);

      if (occ && showPlacement && b.assignments[key] < attendees.length) {
        const [last, first] = attendees[b.assignments[key]];
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(7, chairSize * 0.4)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatName(first, last, 'initials', firstFirst), cx2, cy2);
      } else if (showSeatNumbers && (!occ || !showPlacement)) {
        ctx.fillStyle = '#aaa';
        ctx.font = `${Math.max(6, chairSize * 0.78)}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key, cx2, cy2);
      }
    }
  }

  if (b.locked) {
    ctx.fillStyle = '#e2b340';
    ctx.font = `${Math.max(12, scale * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒', x + w / 2, y + h / 2);
  }
}

function drawVenueElement(ctx, e, state) {
  const { scale, offsetX, offsetY } = state;
  const cx = offsetX + e.x * scale;
  const cy = offsetY + e.y * scale;
  const hw = (e.widthFt * scale) / 2;
  const hh = (e.heightFt * scale) / 2;
  const sel = isSelected(e, state);

  ctx.fillStyle = e.color;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = sel ? '#e2b340' : '#333';
  ctx.lineWidth = sel ? Math.max(2, scale * 0.15) : Math.max(1, scale * 0.06);
  ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);

  // Dance floor hatch pattern
  if (e.elementType === 'dance_floor') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = Math.max(1, scale * 0.05);
    const step = Math.max(8, scale * 0.6);
    for (let d = -hw * 2 - hh * 2; d < hw * 2 + hh * 2; d += step) {
      ctx.beginPath();
      ctx.moveTo(cx - hw + d, cy - hh);
      ctx.lineTo(cx - hw + d + hh * 2, cy + hh);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Name label
  const name = e.name || e.elementType;
  const isLight = isLightColor(e.color);
  ctx.font = `bold ${Math.max(10, scale * 0.8)}px "DM Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLight ? '#000' : '#fff';
  ctx.fillText(name, cx, cy);

  if (e.locked) {
    ctx.fillStyle = isLight ? '#000' : '#fff';
    ctx.fillText('🔒', cx, cy + Math.max(15, scale * 1));
  }

  // Resize handles
  if (sel && !e.locked) {
    const hs = Math.max(6, scale * 0.35);
    const corners = [
      [cx - hw, cy - hh], [cx + hw, cy - hh],
      [cx - hw, cy + hh], [cx + hw, cy + hh],
    ];
    corners.forEach(([hx, hy]) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeStyle = '#e2b340';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    });
  }
}

function drawGhost(ctx, entity, type, state) {
  const { scale, offsetX, offsetY } = state;
  const cx = offsetX + entity.x * scale;
  const cy = offsetY + entity.y * scale;

  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = entity.color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;

  if (type === 'table') {
    if (entity.tableType === 'round') {
      const r = (entity.widthFt * scale) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const hw = (entity.widthFt * scale) / 2;
      const hh = (entity.heightFt * scale) / 2;
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    }
  } else if (type === 'block') {
    const dims = getBlockDimensions(entity);
    ctx.strokeRect(cx, cy, dims.widthFt * scale, dims.heightFt * scale);
  } else {
    const hw = (entity.widthFt * scale) / 2;
    const hh = (entity.heightFt * scale) / 2;
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Hit test for venue element resize handles
// Returns { entity, corner } or null
// corner: 0=TL, 1=TR, 2=BL, 3=BR
export function resizeHandleHitTest(x, y, state) {
  const { venueElements, scale, offsetX, offsetY, selectedItem, selectedItems } = state;
  const hs = Math.max(6, scale * 0.35);
  const hitR = hs / 2 + 4; // generous hit area

  for (let i = venueElements.length - 1; i >= 0; i--) {
    const e = venueElements[i];
    if (e.locked) continue;
    if (!isSelected(e, state)) continue;

    const cx = offsetX + e.x * scale;
    const cy = offsetY + e.y * scale;
    const hw = (e.widthFt * scale) / 2;
    const hh = (e.heightFt * scale) / 2;
    const corners = [
      [cx - hw, cy - hh], // 0: TL
      [cx + hw, cy - hh], // 1: TR
      [cx - hw, cy + hh], // 2: BL
      [cx + hw, cy + hh], // 3: BR
    ];
    for (let c = 0; c < 4; c++) {
      const [hx, hy] = corners[c];
      if (x >= hx - hitR && x <= hx + hitR && y >= hy - hitR && y <= hy + hitR) {
        return { entity: e, corner: c };
      }
    }
  }
  return null;
}

// Hit testing - find entity at canvas coords
export function hitTest(x, y, state) {
  const { tables, chairBlocks, venueElements, scale, offsetX, offsetY } = state;

  // Check tables (on top)
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    const cx = offsetX + t.x * scale;
    const cy = offsetY + t.y * scale;
    if (t.tableType === 'round') {
      const r = (t.widthFt * scale) / 2 + 0.75 * scale + 5;
      if (Math.hypot(x - cx, y - cy) < r) return ['table', t];
    } else {
      const hw = (t.widthFt * scale) / 2 + 0.75 * scale + 5;
      const hh = (t.heightFt * scale) / 2 + 0.75 * scale + 5;
      if (x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh) return ['table', t];
    }
  }

  // Check blocks
  for (let i = chairBlocks.length - 1; i >= 0; i--) {
    const b = chairBlocks[i];
    const dims = getBlockDimensions(b);
    const bx = offsetX + b.x * scale;
    const by = offsetY + b.y * scale;
    const bw = dims.widthFt * scale;
    const bh = dims.heightFt * scale;
    if (x >= bx - 5 && x <= bx + bw + 5 && y >= by - 15 && y <= by + bh + 5) return ['block', b];
  }

  // Check venue elements
  for (let i = venueElements.length - 1; i >= 0; i--) {
    const e = venueElements[i];
    const ex = offsetX + e.x * scale;
    const ey = offsetY + e.y * scale;
    const hw = (e.widthFt * scale) / 2;
    const hh = (e.heightFt * scale) / 2;
    if (x >= ex - hw && x <= ex + hw && y >= ey - hh && y <= ey + hh) return ['venue', e];
  }

  return null;
}

// Hit test for seats on canvas
export function seatHitTest(x, y, state) {
  const { tables, chairBlocks, scale, offsetX, offsetY } = state;

  // Check table seats
  for (let i = tables.length - 1; i >= 0; i--) {
    const t = tables[i];
    const cx = offsetX + t.x * scale;
    const cy = offsetY + t.y * scale;
    const sr = 0.75 * scale;

    if (t.tableType === 'round') {
      const r = (t.widthFt * scale) / 2;
      const seatGap = Math.max(3, scale * 0.2);
      for (let si = 0; si < t.seats; si++) {
        const a = (2 * Math.PI * si / t.seats) - Math.PI / 2;
        const d = r + sr + seatGap;
        const sx = cx + d * Math.cos(a);
        const sy = cy + d * Math.sin(a);
        if (Math.hypot(x - sx, y - sy) < sr + 2) return { entityType: 'table', entity: t, seatKey: si };
      }
    } else {
      const positions = getRectSeatPositions(t, scale);
      const total = getTableTotalSeats(t);
      for (let si = 0; si < Math.min(positions.length, total); si++) {
        const [dx, dy] = positions[si];
        const sx = cx + dx;
        const sy = cy + dy;
        if (Math.hypot(x - sx, y - sy) < sr + 2) return { entityType: 'table', entity: t, seatKey: si };
      }
    }
  }

  // Check block seats
  for (let i = chairBlocks.length - 1; i >= 0; i--) {
    const b = chairBlocks[i];
    const bx = offsetX + b.x * scale;
    const by = offsetY + b.y * scale;
    const cs = getBlockChairSpacing(b) * scale;
    const chairSize = 1.2 * scale;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const cx2 = bx + (c + 0.5) * cs;
        const cy2 = by + (r + 0.5) * cs;
        if (Math.abs(x - cx2) < chairSize / 2 + 2 && Math.abs(y - cy2) < chairSize / 2 + 2) {
          return { entityType: 'block', entity: b, seatKey: `${r}-${c}` };
        }
      }
    }
  }

  return null;
}
