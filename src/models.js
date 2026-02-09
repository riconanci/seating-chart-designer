// Data models matching the Python classes

export function createTable(id, x, y, opts = {}) {
  return {
    type: 'table',
    id,
    x, y,
    tableType: opts.tableType || 'round',
    name: opts.name || '',
    seats: opts.seats || 8,
    widthFt: opts.widthFt || 5,
    heightFt: opts.heightFt || 5,
    color: opts.color || '#8B4513',
    orientation: opts.orientation || 'horizontal',
    endSeats: opts.endSeats || 0,
    locked: opts.locked || false,
    assignments: opts.assignments || {},
  };
}

export function createChairBlock(id, x, y, opts = {}) {
  return {
    type: 'block',
    id,
    x, y,
    rows: opts.rows || 3,
    cols: opts.cols || 4,
    name: opts.name || '',
    color: opts.color || '#4A4A4A',
    spacing: opts.spacing || 'normal',
    locked: opts.locked || false,
    assignments: opts.assignments || {},
  };
}

export function createVenueElement(id, x, y, opts = {}) {
  return {
    type: 'venue',
    id,
    x, y,
    elementType: opts.elementType || 'dance_floor',
    name: opts.name || '',
    widthFt: opts.widthFt || 10,
    heightFt: opts.heightFt || 10,
    color: opts.color || '#D4AF37',
    locked: opts.locked || false,
  };
}

export function getTableTotalSeats(t) {
  if (t.tableType === 'round') return t.seats;
  return (t.seats * 2) + (t.endSeats * 2);
}

export function getBlockChairSpacing(b) {
  return { tight: 1.5, normal: 2, wide: 2.5 }[b.spacing] || 2;
}

export function getBlockDimensions(b) {
  const s = getBlockChairSpacing(b);
  return { widthFt: b.cols * s, heightFt: b.rows * s };
}

export function getBlockTotalSeats(b) {
  return b.rows * b.cols;
}

export function getTotalSeats(entity) {
  if (entity.type === 'table') return getTableTotalSeats(entity);
  if (entity.type === 'block') return getBlockTotalSeats(entity);
  return 0;
}

export const TABLE_COLORS = [
  '#8B4513', '#2E86AB', '#A23B72', '#F18F01',
  '#C73E1D', '#3B1F2B', '#95C623', '#5C4D7D'
];

export const COLOR_PALETTE = [
  '#FFFFFF', '#000000',
  '#8B4513', '#C73E1D', '#E74C3C', '#F18F01',
  '#D4AF37', '#95C623', '#48BB78', '#1ABC9C',
  '#2E86AB', '#4299E1', '#5C4D7D', '#A23B72',
  '#2C3E50', '#3B1F2B', '#4A4A4A', '#6B7A90',
];

export const VENUE_DEFAULTS = {
  dance_floor: { name: 'Dance Floor', widthFt: 15, heightFt: 15, color: '#D4AF37' },
  stage: { name: 'Stage', widthFt: 20, heightFt: 10, color: '#2C3E50' },
  bar: { name: 'Bar', widthFt: 12, heightFt: 4, color: '#8B4513' },
  dj_booth: { name: 'DJ Booth', widthFt: 6, heightFt: 4, color: '#1ABC9C' },
  buffet: { name: 'Buffet', widthFt: 16, heightFt: 3, color: '#E74C3C' },
};

export function formatName(first, last, mode = 'short', nameOrder = 'lastFirst') {
  if (mode === 'initials') {
    return nameOrder === 'firstLast'
      ? (first?.[0] || '') + (last?.[0] || '')
      : (last?.[0] || '') + (first?.[0] || '');
  }
  if (mode === 'full') {
    return nameOrder === 'firstLast' ? `${first}, ${last}` : `${last}, ${first}`;
  }
  // short — primary name (up to 6 chars), secondary initial
  if (nameOrder === 'firstLast') {
    if (first && last) return `${first.substring(0, 6)},${last[0]}`;
    return first || last || '?';
  }
  if (last && first) return `${last.substring(0, 6)},${first[0]}`;
  return last || first || '?';
}

// Build assigned set
export function buildAssignedSet(tables, blocks) {
  const assigned = new Set();
  tables.forEach(t => Object.values(t.assignments).forEach(v => assigned.add(v)));
  blocks.forEach(b => Object.values(b.assignments).forEach(v => assigned.add(v)));
  return assigned;
}

// Parse CSV text
export function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const attendees = [];
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (parts.length >= 2 && (parts[0] || parts[1])) {
      attendees.push([parts[0] || '', parts[1] || '']);
    }
  }
  attendees.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()) || a[1].toLowerCase().localeCompare(b[1].toLowerCase()));
  return attendees;
}

// Serialize / deserialize project
export function serializeProject(state) {
  return JSON.stringify({
    roomWidth: state.roomWidth,
    roomHeight: state.roomHeight,
    tables: state.tables,
    chairBlocks: state.chairBlocks,
    venueElements: state.venueElements,
    attendees: state.attendees,
    disabledAttendees: [...state.disabledAttendees],
    nextTableId: state.nextTableId,
    nextBlockId: state.nextBlockId,
    nextElementId: state.nextElementId,
    nextColorIdx: state.nextColorIdx,
  }, null, 2);
}

export function deserializeProject(json) {
  const d = JSON.parse(json);
  return {
    roomWidth: d.roomWidth || 60,
    roomHeight: d.roomHeight || 40,
    tables: (d.tables || []).map(t => ({ ...t, type: 'table' })),
    chairBlocks: (d.chairBlocks || []).map(b => ({ ...b, type: 'block' })),
    venueElements: (d.venueElements || []).map(e => ({ ...e, type: 'venue' })),
    attendees: d.attendees || [],
    disabledAttendees: new Set(d.disabledAttendees || []),
    nextTableId: d.nextTableId || 1,
    nextBlockId: d.nextBlockId || 1,
    nextElementId: d.nextElementId || 1,
    nextColorIdx: d.nextColorIdx || 0,
  };
}

// Export to CSV
export function exportCSV(tables, blocks, attendees, format = 'flat') {
  const assignedMap = {};
  tables.forEach(t => {
    const name = t.name || `Table ${t.id}`;
    Object.entries(t.assignments).forEach(([seat, idx]) => {
      assignedMap[idx] = [name, Number(seat) + 1];
    });
  });
  blocks.forEach(b => {
    const name = b.name || `Section ${b.id}`;
    Object.entries(b.assignments).forEach(([key, idx]) => {
      const [r, c] = key.split('-');
      assignedMap[idx] = [name, `R${Number(r)+1}C${Number(c)+1}`];
    });
  });

  const rows = [];
  if (format === 'flat' || format === 'checkin') {
    rows.push(['Last Name', 'First Name', 'Table/Block', 'Seat']);
    Object.entries(assignedMap).forEach(([idx, [table, seat]]) => {
      const i = Number(idx);
      if (i < attendees.length) rows.push([attendees[i][0], attendees[i][1], table, seat]);
    });
    attendees.forEach(([last, first], i) => {
      if (!(i in assignedMap)) rows.push([last, first, '', '']);
    });
    if (format === 'checkin') {
      const hdr = rows.shift();
      rows.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
      rows.unshift(hdr);
    }
  } else {
    rows.push(['Table/Block', 'Seat', 'Last Name', 'First Name']);
    tables.forEach(t => {
      const name = t.name || `Table ${t.id}`;
      const total = getTableTotalSeats(t);
      for (let i = 0; i < total; i++) {
        if (i in t.assignments && t.assignments[i] < attendees.length) {
          const [last, first] = attendees[t.assignments[i]];
          rows.push([name, i + 1, last, first]);
        } else {
          rows.push([name, i + 1, '(empty)', '']);
        }
      }
    });
  }
  return rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
}
