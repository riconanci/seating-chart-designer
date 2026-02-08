import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { drawCanvas, hitTest, seatHitTest } from './canvasRenderer';
import {
  createTable, createChairBlock, createVenueElement,
  getTableTotalSeats, getBlockTotalSeats, getTotalSeats,
  getBlockDimensions, buildAssignedSet, parseCSV, formatName, displayName,
  serializeProject, deserializeProject, exportCSV,
  TABLE_COLORS, VENUE_DEFAULTS, COLOR_PALETTE,
} from './models';

export default function App() {
  // Core state
  const [roomWidth, setRoomWidth] = useState(60);
  const [roomHeight, setRoomHeight] = useState(40);
  const [tables, setTables] = useState([]);
  const [chairBlocks, setChairBlocks] = useState([]);
  const [venueElements, setVenueElements] = useState([]);
  const [attendees, setAttendees] = useState([]);
  const [disabledAttendees, setDisabledAttendees] = useState(new Set());
  const [nextTableId, setNextTableId] = useState(1);
  const [nextBlockId, setNextBlockId] = useState(1);
  const [nextElementId, setNextElementId] = useState(1);
  const [nextColorIdx, setNextColorIdx] = useState(0);

  // UI state
  const [currentView, setCurrentView] = useState('canvas');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [showPlacement, setShowPlacement] = useState(true);
  const [gridSize, setGridSize] = useState(1);
  const [hideGrid, setHideGrid] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [nameOrder, setNameOrder] = useState('last-first'); // 'last-first' or 'first-last'
  const [zoomLevel, setZoomLevel] = useState(100);
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [collapsedCards, setCollapsedCards] = useState(new Set());
  const [status, setStatus] = useState('Ready — add tables or load a CSV to get started');
  const [selectedAttendee, setSelectedAttendee] = useState(null);
  const [modal, setModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const [ghostEntity, setGhostEntity] = useState(null);
  const [ghostType, setGhostType] = useState(null);
  const [tablePopupOpen, setTablePopupOpen] = useState(true);
  const [popupDragSeat, setPopupDragSeat] = useState(null); // {entityType, entityId, seatKey, attIdx}
  const [attendeeListMode, setAttendeeListMode] = useState('all'); // 'all' | 'unassigned-first'

  // Drag state
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, entity: null, hasMoved: false });
  const [dragAttendee, setDragAttendee] = useState(null);
  const [dragGhostPos, setDragGhostPos] = useState(null);

  // Undo
  const undoStack = useRef([]);

  // Canvas refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const fileInputRef = useRef(null);
  const csvInputRef = useRef(null);

  // Compute scale
  const scale = useMemo(() => {
    const cw = canvasSize.w;
    const ch = canvasSize.h;
    if (cw < 10 || ch < 10) return 10;
    const base = Math.max(2, Math.min((cw - 80) / roomWidth, (ch - 80) / roomHeight));
    return zoomLevel === 100 ? base : base * zoomLevel / 100;
  }, [canvasSize, roomWidth, roomHeight, zoomLevel]);

  const offsetX = useMemo(() => (canvasSize.w - roomWidth * scale) / 2, [canvasSize.w, roomWidth, scale]);
  const offsetY = useMemo(() => (canvasSize.h - roomHeight * scale) / 2, [canvasSize.h, roomHeight, scale]);

  // Assigned set
  const assigned = useMemo(() => buildAssignedSet(tables, chairBlocks), [tables, chairBlocks]);

  const firstFirst = nameOrder === 'first-last';

  // Canvas state for renderer
  const canvasState = useMemo(() => ({
    roomWidth, roomHeight, tables, chairBlocks, venueElements, attendees,
    selectedItem, selectedItems, ghostEntity, ghostType,
    showPlacement, gridSize, hideGrid, firstFirst, scale, offsetX, offsetY,
  }), [roomWidth, roomHeight, tables, chairBlocks, venueElements, attendees,
    selectedItem, selectedItems, ghostEntity, ghostType,
    showPlacement, gridSize, hideGrid, firstFirst, scale, offsetX, offsetY]);

  // Save undo
  const saveUndo = useCallback(() => {
    undoStack.current.push(JSON.stringify({ tables, chairBlocks, venueElements, attendees: attendees.slice(), disabledAttendees: [...disabledAttendees] }));
    if (undoStack.current.length > 50) undoStack.current.shift();
  }, [tables, chairBlocks, venueElements, attendees, disabledAttendees]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const prev = JSON.parse(undoStack.current.pop());
    setTables(prev.tables.map(t => ({ ...t, type: 'table' })));
    setChairBlocks(prev.chairBlocks.map(b => ({ ...b, type: 'block' })));
    setVenueElements(prev.venueElements.map(e => ({ ...e, type: 'venue' })));
    setAttendees(prev.attendees);
    setDisabledAttendees(new Set(prev.disabledAttendees));
    setStatus('Undone');
  }, []);

  // Snap to grid
  const snap = useCallback((v) => snapEnabled && gridSize > 0 ? Math.round(v / gridSize) * gridSize : v, [gridSize, snapEnabled]);

  // Entity-aware snap: round tables snap center, blocks snap top-left, rect entities snap top-left corner
  const snapEntityPos = useCallback((rawX, rawY, entity, eType) => {
    if (!snapEnabled || gridSize <= 0) return { x: rawX, y: rawY };
    const isRound = eType === 'table' && entity.tableType === 'round';
    if (isRound) {
      // Round tables: snap center to grid
      return { x: snap(rawX), y: snap(rawY) };
    }
    if (eType === 'block') {
      // Blocks: x,y is already top-left, snap directly
      return { x: snap(rawX), y: snap(rawY) };
    }
    // Rect tables and venue elements: x,y is center, snap top-left corner
    const w = entity.widthFt;
    const h = entity.heightFt;
    const tlx = snap(rawX - w / 2);
    const tly = snap(rawY - h / 2);
    return { x: tlx + w / 2, y: tly + h / 2 };
  }, [gridSize, snapEnabled, snap]);
  const pxToFt = useCallback((px) => px / scale, [scale]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentView]);

  // Reopen table popup when selecting a new table/block
  useEffect(() => {
    if (selectedItem && (selectedItem[0] === 'table' || selectedItem[0] === 'block')) {
      setTablePopupOpen(true);
    }
  }, [selectedItem?.[0], selectedItem?.[1]?.id]);

  // Draw canvas
  useEffect(() => {
    if (currentView !== 'canvas') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    const ctx = canvas.getContext('2d');
    drawCanvas(ctx, canvasState, canvasSize.w, canvasSize.h);
  }, [canvasState, canvasSize, currentView]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (modal) return;
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'Delete') deleteSelected();
      if (e.key === 'Escape') cancelGhost();
      if (e.key === 'r' || e.key === 'R') { if (!e.ctrlKey) rotateSelected(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Close menus on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  // === ACTIONS ===

  function cancelGhost() {
    if (ghostEntity) {
      setGhostEntity(null);
      setGhostType(null);
      setStatus('Cancelled placement');
    } else {
      setSelectedItem(null);
      setSelectedItems([]);
    }
  }

  function deleteSelected() {
    if (!selectedItem) return;
    const [type, item] = selectedItem;
    const name = item.name || `${type === 'table' ? 'Table' : type === 'block' ? 'Block' : ''} ${item.id}`;
    setModal({ type: 'confirm', title: 'Delete Entity', message: `Are you sure you want to delete "${name}"?`,
      onConfirm: () => { performDelete(type, item.id); setModal(null); } });
  }

  function confirmDeleteEntity(entityType, entityId, entityName) {
    setModal({ type: 'confirm', title: 'Delete Entity', message: `Are you sure you want to delete "${entityName}"?`,
      onConfirm: () => { performDelete(entityType, entityId); setModal(null); } });
  }

  function performDelete(type, id) {
    saveUndo();
    if (type === 'table') setTables(prev => prev.filter(t => t.id !== id));
    else if (type === 'block') setChairBlocks(prev => prev.filter(b => b.id !== id));
    else setVenueElements(prev => prev.filter(e => e.id !== id));
    if (selectedItem && selectedItem[1].id === id) {
      setSelectedItem(null);
      setSelectedItems([]);
    }
    setStatus('Deleted');
  }

  function changeEntityColor(entityType, entityId, color) {
    if (entityType === 'table') setTables(prev => prev.map(t => t.id === entityId ? { ...t, color } : t));
    else if (entityType === 'block') setChairBlocks(prev => prev.map(b => b.id === entityId ? { ...b, color } : b));
  }

  function rotateSelected() {
    if (!selectedItem) return;
    const [type, item] = selectedItem;
    saveUndo();
    if (type === 'table' && item.tableType === 'rect') {
      setTables(prev => prev.map(t => t.id === item.id ? {
        ...t, widthFt: t.heightFt, heightFt: t.widthFt,
        orientation: t.orientation === 'horizontal' ? 'vertical' : 'horizontal'
      } : t));
      setStatus('Table rotated');
    } else if (type === 'table' && item.tableType === 'round') {
      const total = item.seats;
      if (total > 0 && Object.keys(item.assignments).length > 0) {
        const shift = total >= 4 ? Math.floor(total / 4) : 1;
        const newAssign = {};
        Object.entries(item.assignments).forEach(([k, v]) => {
          newAssign[(Number(k) + shift) % total] = v;
        });
        setTables(prev => prev.map(t => t.id === item.id ? { ...t, assignments: newAssign } : t));
      }
      setStatus('Seats rotated');
    } else if (type === 'block') {
      const oldRows = item.rows, oldCols = item.cols;
      const newAssign = {};
      Object.entries(item.assignments).forEach(([key, att]) => {
        const [r, c] = key.split('-').map(Number);
        const nr = c, nc = oldRows - 1 - r;
        if (nr >= 0 && nr < oldCols && nc >= 0 && nc < oldRows) {
          newAssign[`${nr}-${nc}`] = att;
        }
      });
      setChairBlocks(prev => prev.map(b => b.id === item.id ? { ...b, rows: oldCols, cols: oldRows, assignments: newAssign } : b));
      setStatus('Block rotated');
    } else if (type === 'venue') {
      setVenueElements(prev => prev.map(e => e.id === item.id ? { ...e, widthFt: e.heightFt, heightFt: e.widthFt } : e));
      setStatus('Element rotated');
    }
  }

  function copySelected() {
    if (!selectedItem) return;
    saveUndo();
    const [type, item] = selectedItem;
    if (type === 'table') {
      const newT = { ...item, id: nextTableId, x: item.x + 3, y: item.y + 3, name: item.name ? `${item.name} (copy)` : '', assignments: {}, type: 'table' };
      setTables(prev => [...prev, newT]);
      setNextTableId(prev => prev + 1);
      setSelectedItem(['table', newT]);
    } else if (type === 'block') {
      const newB = { ...item, id: nextBlockId, x: item.x + 3, y: item.y + 3, name: item.name ? `${item.name} (copy)` : '', assignments: {}, type: 'block' };
      setChairBlocks(prev => [...prev, newB]);
      setNextBlockId(prev => prev + 1);
      setSelectedItem(['block', newB]);
    } else {
      const newE = { ...item, id: nextElementId, x: item.x + 3, y: item.y + 3, name: item.name ? `${item.name} (copy)` : '', type: 'venue' };
      setVenueElements(prev => [...prev, newE]);
      setNextElementId(prev => prev + 1);
      setSelectedItem(['venue', newE]);
    }
    setStatus('Copied');
  }

  function toggleLock() {
    if (!selectedItem) return;
    saveUndo();
    const [type, item] = selectedItem;
    const newLocked = !item.locked;
    if (type === 'table') setTables(prev => prev.map(t => t.id === item.id ? { ...t, locked: newLocked } : t));
    else if (type === 'block') setChairBlocks(prev => prev.map(b => b.id === item.id ? { ...b, locked: newLocked } : b));
    else setVenueElements(prev => prev.map(e => e.id === item.id ? { ...e, locked: newLocked } : e));
    setSelectedItem([type, { ...item, locked: newLocked }]);
    setStatus(newLocked ? 'Locked' : 'Unlocked');
  }

  // Auto-assign
  function autoAssign(mode) {
    saveUndo();
    const unassigned = attendees.map((_, i) => i).filter(i => !assigned.has(i) && !disabledAttendees.has(i));
    if (!unassigned.length) { setStatus('No unassigned attendees'); return; }

    if (mode === 'alpha') {
      const [p, s] = firstFirst ? [1, 0] : [0, 1];
      unassigned.sort((a, b) => attendees[a][p].localeCompare(attendees[b][p]) || attendees[a][s].localeCompare(attendees[b][s]));
    }
    else if (mode === 'random') unassigned.sort(() => Math.random() - 0.5);

    const emptySeats = [];
    tables.forEach(t => {
      for (let i = 0; i < getTableTotalSeats(t); i++) {
        if (!(i in t.assignments)) emptySeats.push({ type: 'table', id: t.id, key: i });
      }
    });
    chairBlocks.forEach(b => {
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
        const key = `${r}-${c}`;
        if (!(key in b.assignments)) emptySeats.push({ type: 'block', id: b.id, key });
      }
    });

    let count = 0;
    const tAssign = {};
    tables.forEach(t => tAssign[t.id] = { ...t.assignments });
    const bAssign = {};
    chairBlocks.forEach(b => bAssign[b.id] = { ...b.assignments });

    for (const attIdx of unassigned) {
      if (!emptySeats.length) break;
      const seat = emptySeats.shift();
      if (seat.type === 'table') tAssign[seat.id][seat.key] = attIdx;
      else bAssign[seat.id][seat.key] = attIdx;
      count++;
    }

    setTables(prev => prev.map(t => ({ ...t, assignments: tAssign[t.id] || t.assignments })));
    setChairBlocks(prev => prev.map(b => ({ ...b, assignments: bAssign[b.id] || b.assignments })));
    setStatus(`Auto-assigned ${count} attendees`);
    setMenuOpen(null);
  }

  function clearAllAssignments() {
    saveUndo();
    setTables(prev => prev.map(t => ({ ...t, assignments: {} })));
    setChairBlocks(prev => prev.map(b => ({ ...b, assignments: {} })));
    setStatus('All assignments cleared');
    setMenuOpen(null);
  }

  // CSV
  function loadCSV(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      setAttendees(parsed);
      setDisabledAttendees(new Set());
      setStatus(`Loaded ${parsed.length} attendees from ${file.name}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Project save/load
  async function saveProject() {
    const data = serializeProject({
      roomWidth, roomHeight, tables, chairBlocks, venueElements,
      attendees, disabledAttendees, nextTableId, nextBlockId, nextElementId, nextColorIdx,
    });
    const blob = new Blob([data], { type: 'application/json' });

    // Use File System Access API if available (Chrome/Edge — lets user pick location + name)
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'seating_chart.json',
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(`Saved: ${handle.name}`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled
      }
    }

    // Fallback: auto-download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seating_chart.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Project saved');
  }

  async function exportImage(opts) {
    const { resolution, includeGrid, includeNames, content } = opts;
    const pxPerFt = resolution === 'ultra' ? 75 : resolution === 'high' ? 50 : 30;
    const padding = 40;

    // Canvas dimensions for room
    const roomW = roomWidth * pxPerFt;
    const roomH = roomHeight * pxPerFt;

    // Build summary data
    const allEntities = [
      ...tables.map(t => ({ entity: t, type: 'table', name: t.name || `Table ${t.id}`, total: getTableTotalSeats(t) })),
      ...chairBlocks.map(b => ({ entity: b, type: 'block', name: b.name || `Block ${b.id}`, total: getBlockTotalSeats(b) })),
    ];

    // Measure summary if needed
    const showCanvas = content !== 'summary';
    const showSummary = content !== 'canvas';

    const colWidth = Math.round(260 * pxPerFt / 15);
    const lineH = Math.round(20 * pxPerFt / 15);
    const headerH = Math.round(36 * pxPerFt / 15);
    const colGap = Math.round(20 * pxPerFt / 15);
    const summaryPadding = Math.round(40 * pxPerFt / 15);
    const titleH = showSummary ? Math.round(50 * pxPerFt / 15) : 0;
    const fontScale = pxPerFt / 15;

    // Calculate summary height
    let summaryH = 0;
    let summaryContentW = showCanvas ? roomW + padding * 2 : 0;
    if (showSummary && allEntities.length > 0) {
      if (!showCanvas) {
        // Summary-only: pick width to fit ~3 columns, or fewer if less entities
        const idealCols = Math.min(3, allEntities.length);
        summaryContentW = summaryPadding * 2 + idealCols * colWidth + (idealCols - 1) * colGap;
      }
      const cols = Math.max(1, Math.floor((summaryContentW - summaryPadding * 2 + colGap) / (colWidth + colGap)));

      // Pack entities into columns (greedy: add to shortest column)
      const colHeights = new Array(cols).fill(0);
      allEntities.forEach(e => {
        const h = headerH + e.total * lineH + 16; // 16 = gap after each table
        const minCol = colHeights.indexOf(Math.min(...colHeights));
        colHeights[minCol] += h;
      });
      summaryH = titleH + Math.max(...colHeights) + summaryPadding * 2;
    }

    const totalW = showCanvas ? Math.max(roomW + padding * 2, summaryContentW) : summaryContentW;
    const totalH = (showCanvas ? roomH + padding * 2 : 0) + summaryH;

    const offscreen = document.createElement('canvas');
    offscreen.width = totalW;
    offscreen.height = totalH;
    const ctx = offscreen.getContext('2d');

    // Ensure fonts are loaded before rendering
    await document.fonts.ready;

    // Dark background
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, totalW, totalH);

    // Draw canvas
    if (showCanvas) {
      const exportState = {
        roomWidth, roomHeight, tables, chairBlocks, venueElements, attendees,
        selectedItem: null, selectedItems: [],
        ghostEntity: null, ghostType: null,
        showPlacement: includeNames, gridSize,
        hideGrid: !includeGrid, firstFirst,
        scale: pxPerFt, offsetX: padding, offsetY: padding,
      };
      drawCanvas(ctx, exportState, totalW, showCanvas ? roomH + padding * 2 : 0);
    }

    // Draw summary
    if (showSummary && allEntities.length > 0) {
      const summaryTop = showCanvas ? roomH + padding * 2 : 0;
      const cols = Math.max(1, Math.floor((totalW - summaryPadding * 2 + colGap) / (colWidth + colGap)));

      // Separator line
      if (showCanvas) {
        ctx.strokeStyle = '#2d3a5a';
        ctx.lineWidth = Math.max(2, fontScale * 1.5);
        ctx.beginPath();
        ctx.moveTo(summaryPadding, summaryTop + Math.round(10 * fontScale));
        ctx.lineTo(totalW - summaryPadding, summaryTop + Math.round(10 * fontScale));
        ctx.stroke();
      }

      // Title
      ctx.fillStyle = '#e8e8e8';
      ctx.font = `bold ${Math.round(22 * fontScale)}px "DM Sans", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Seating Assignments', summaryPadding, summaryTop + Math.round(20 * fontScale));

      const startY = summaryTop + titleH + summaryPadding;

      // Pack entities into columns
      const colContents = Array.from({ length: cols }, () => []);
      const colHeights = new Array(cols).fill(0);
      allEntities.forEach(e => {
        const h = headerH + e.total * lineH + 16;
        const minCol = colHeights.indexOf(Math.min(...colHeights));
        colContents[minCol].push(e);
        colHeights[minCol] += h;
      });

      colContents.forEach((entities, colIdx) => {
        const colX = summaryPadding + colIdx * (colWidth + colGap);
        let curY = startY;

        entities.forEach(({ entity, type, name, total }) => {
          // Table header background
          ctx.fillStyle = entity.color || '#2E86AB';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(colX, curY, colWidth, headerH - 4, Math.round(6 * fontScale));
            ctx.fill();
          } else {
            ctx.fillRect(colX, curY, colWidth, headerH - 4);
          }

          // Header text
          const filled = type === 'table'
            ? Object.keys(entity.assignments).length
            : Object.keys(entity.assignments).length;
          // Light color check for text contrast
          const c = (entity.color || '').replace('#', '');
          const lum = c.length === 6 ? (parseInt(c.substring(0,2),16)*299 + parseInt(c.substring(2,4),16)*587 + parseInt(c.substring(4,6),16)*114) / 1000 : 0;
          ctx.fillStyle = lum > 160 ? '#000' : '#fff';
          ctx.font = `bold ${Math.round(14 * fontScale)}px "DM Sans", sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(name, colX + Math.round(10 * fontScale), curY + headerH / 2 - 2);
          ctx.font = `${Math.round(12 * fontScale)}px "DM Sans", sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText(`${filled}/${total}`, colX + colWidth - Math.round(10 * fontScale), curY + headerH / 2 - 2);
          curY += headerH;

          // Seats
          for (let s = 0; s < total; s++) {
            let seatKey, occ, attIdx;
            if (type === 'table') {
              seatKey = s;
              occ = s in entity.assignments;
              attIdx = occ ? entity.assignments[s] : null;
            } else {
              const r = Math.floor(s / entity.cols);
              const c = s % entity.cols;
              seatKey = `${r}-${c}`;
              occ = seatKey in entity.assignments;
              attIdx = occ ? entity.assignments[seatKey] : null;
            }

            const seatY = curY + s * lineH;

            // Alternating row bg
            if (s % 2 === 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.03)';
              ctx.fillRect(colX, seatY, colWidth, lineH);
            }

            // Seat number
            ctx.fillStyle = '#6b7a90';
            ctx.font = `${Math.round(11 * fontScale)}px "DM Sans", sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${s + 1}.`, colX + Math.round(10 * fontScale), seatY + lineH / 2);

            // Name or empty
            if (occ && attIdx != null && attIdx < attendees.length) {
              ctx.fillStyle = '#e8e8e8';
              ctx.font = `${Math.round(12 * fontScale)}px "DM Sans", sans-serif`;
              ctx.fillText(displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst), colX + Math.round(32 * fontScale), seatY + lineH / 2);
            } else {
              ctx.fillStyle = '#4a5568';
              ctx.font = `italic ${Math.round(11 * fontScale)}px "DM Sans", sans-serif`;
              ctx.fillText('— Empty —', colX + Math.round(32 * fontScale), seatY + lineH / 2);
            }
          }
          curY += total * lineH + 16;
        });
      });
    }

    // Export as PNG — small delay to let canvas rendering settle
    await new Promise(resolve => setTimeout(resolve, 100));
    offscreen.toBlob(async (blob) => {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'seating_chart.png',
            types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setStatus(`Exported: ${handle.name}`);
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seating_chart.png';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Image exported');
    }, 'image/png');
  }

  function loadProject(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = deserializeProject(ev.target.result);
        setRoomWidth(d.roomWidth);
        setRoomHeight(d.roomHeight);
        setTables(d.tables);
        setChairBlocks(d.chairBlocks);
        setVenueElements(d.venueElements);
        setAttendees(d.attendees);
        setDisabledAttendees(d.disabledAttendees);
        setNextTableId(d.nextTableId);
        setNextBlockId(d.nextBlockId);
        setNextElementId(d.nextElementId);
        setNextColorIdx(d.nextColorIdx);
        setSelectedItem(null);
        setSelectedItems([]);
        setStatus('Project loaded');
      } catch (err) {
        setStatus('Error loading project: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function newProject() {
    if (!confirm('Start a new project? All unsaved changes will be lost.')) return;
    setTables([]);
    setChairBlocks([]);
    setVenueElements([]);
    setAttendees([]);
    setDisabledAttendees(new Set());
    setNextTableId(1);
    setNextBlockId(1);
    setNextElementId(1);
    setNextColorIdx(0);
    setSelectedItem(null);
    setSelectedItems([]);
    setRoomWidth(60);
    setRoomHeight(40);
    setStatus('New project started');
  }

  function doExportCSV() {
    const csv = exportCSV(tables, chairBlocks, attendees, 'flat');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seating_chart.csv';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('CSV exported');
  }

  // Add entities
  function addEntity(entityType) {
    setMenuOpen(null);
    const color = TABLE_COLORS[nextColorIdx % TABLE_COLORS.length];
    let defaults;
    switch (entityType) {
      case 'round_table':
        defaults = { name: '', seats: 8, widthFt: 5, heightFt: 5, color };
        break;
      case 'rect_table':
        defaults = { name: '', seats: 3, widthFt: 6, heightFt: 3, color, orientation: 'horizontal', endSeats: 0 };
        break;
      case 'chair_block':
        defaults = { name: '', rows: 3, cols: 4, spacing: 'normal', color: '#4A4A4A' };
        break;
      default:
        defaults = { ...VENUE_DEFAULTS[entityType] };
    }
    setModal({ type: 'add', entityType, defaults });
  }

  function editEntity() {
    if (!selectedItem) return;
    const [type, item] = selectedItem;
    let entityType;
    if (type === 'table') entityType = item.tableType === 'round' ? 'round_table' : 'rect_table';
    else if (type === 'block') entityType = 'chair_block';
    else entityType = item.elementType;
    setModal({ type: 'edit', entityType, entity: item });
  }

  function confirmAdd(params) {
    saveUndo();
    const et = modal.entityType;
    const cx = roomWidth / 2;
    const cy = roomHeight / 2;

    if (et === 'round_table') {
      const t = createTable(nextTableId, cx, cy, {
        tableType: 'round', name: params.name, seats: Number(params.seats),
        widthFt: Number(params.diameter), heightFt: Number(params.diameter), color: params.color,
      });
      if (currentView === 'canvas') {
        setGhostEntity(t);
        setGhostType('table');
        setModal(null);
        setStatus('Click to place (Esc to cancel)');
        return;
      }
      setTables(prev => [...prev, t]);
      setNextTableId(prev => prev + 1);
      setNextColorIdx(prev => prev + 1);
    } else if (et === 'rect_table') {
      const orient = params.orientation;
      const w = orient === 'horizontal' ? Number(params.length) : Number(params.width);
      const h = orient === 'horizontal' ? Number(params.width) : Number(params.length);
      const t = createTable(nextTableId, cx, cy, {
        tableType: 'rect', name: params.name, seats: Number(params.seats),
        widthFt: w, heightFt: h, color: params.color, orientation: orient,
        endSeats: Number(params.endSeats),
      });
      if (currentView === 'canvas') {
        setGhostEntity(t);
        setGhostType('table');
        setModal(null);
        setStatus('Click to place (Esc to cancel)');
        return;
      }
      setTables(prev => [...prev, t]);
      setNextTableId(prev => prev + 1);
      setNextColorIdx(prev => prev + 1);
    } else if (et === 'chair_block') {
      const b = createChairBlock(nextBlockId, cx, cy, {
        name: params.name, rows: Number(params.rows), cols: Number(params.cols),
        spacing: params.spacing, color: params.color,
      });
      if (currentView === 'canvas') {
        setGhostEntity(b);
        setGhostType('block');
        setModal(null);
        setStatus('Click to place (Esc to cancel)');
        return;
      }
      setChairBlocks(prev => [...prev, b]);
      setNextBlockId(prev => prev + 1);
    } else {
      const e = createVenueElement(nextElementId, cx, cy, {
        elementType: et, name: params.name,
        widthFt: Number(params.widthFt), heightFt: Number(params.heightFt), color: params.color,
      });
      if (currentView === 'canvas') {
        setGhostEntity(e);
        setGhostType('venue');
        setModal(null);
        setStatus('Click to place (Esc to cancel)');
        return;
      }
      setVenueElements(prev => [...prev, e]);
      setNextElementId(prev => prev + 1);
    }
    setModal(null);
    setStatus('Added');
  }

  function confirmEdit(params) {
    if (!modal?.entity) return;
    saveUndo();
    const { entity, entityType } = modal;
    if (entityType === 'round_table') {
      setTables(prev => prev.map(t => t.id === entity.id ? {
        ...t, name: params.name, seats: Number(params.seats),
        widthFt: Number(params.diameter), heightFt: Number(params.diameter), color: params.color,
      } : t));
    } else if (entityType === 'rect_table') {
      const orient = params.orientation;
      setTables(prev => prev.map(t => t.id === entity.id ? {
        ...t, name: params.name, seats: Number(params.seats),
        widthFt: orient === 'horizontal' ? Number(params.length) : Number(params.width),
        heightFt: orient === 'horizontal' ? Number(params.width) : Number(params.length),
        color: params.color, orientation: orient, endSeats: Number(params.endSeats),
      } : t));
    } else if (entityType === 'chair_block') {
      setChairBlocks(prev => prev.map(b => b.id === entity.id ? {
        ...b, name: params.name, rows: Number(params.rows), cols: Number(params.cols),
        spacing: params.spacing, color: params.color,
      } : b));
    } else {
      setVenueElements(prev => prev.map(e => e.id === entity.id ? {
        ...e, name: params.name, widthFt: Number(params.widthFt), heightFt: Number(params.heightFt), color: params.color,
      } : e));
    }
    setSelectedItem(null);
    setModal(null);
    setStatus('Updated');
  }

  // Attendee management
  function addAttendee() {
    setModal({ type: 'addAttendee', defaults: { first: '', last: '' } });
  }

  function confirmAddAttendee(params) {
    if (params.first || params.last) {
      const newList = [...attendees, [params.last, params.first]];
      newList.sort((a, b) => {
        const [p1, s1] = firstFirst ? [1, 0] : [0, 1];
        return a[p1].toLowerCase().localeCompare(b[p1].toLowerCase()) || a[s1].toLowerCase().localeCompare(b[s1].toLowerCase());
      });
      setAttendees(newList);
      setStatus(`Added: ${displayName(params.last, params.first, firstFirst)}`);
    }
    setModal(null);
  }

  function toggleDisable(attIdx) {
    const newDisabled = new Set(disabledAttendees);
    if (newDisabled.has(attIdx)) {
      newDisabled.delete(attIdx);
      setStatus(`Enabled: ${displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst)}`);
    } else {
      // Remove from assignments first
      setTables(prev => prev.map(t => {
        const newA = { ...t.assignments };
        Object.entries(newA).forEach(([k, v]) => { if (v === attIdx) delete newA[k]; });
        return { ...t, assignments: newA };
      }));
      setChairBlocks(prev => prev.map(b => {
        const newA = { ...b.assignments };
        Object.entries(newA).forEach(([k, v]) => { if (v === attIdx) delete newA[k]; });
        return { ...b, assignments: newA };
      }));
      newDisabled.add(attIdx);
      setStatus(`Disabled: ${displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst)}`);
    }
    setDisabledAttendees(newDisabled);
  }

  function recallAttendee(attIdx) {
    saveUndo();
    let found = false;
    setTables(prev => prev.map(t => {
      const newA = { ...t.assignments };
      Object.entries(newA).forEach(([k, v]) => { if (v === attIdx) { delete newA[k]; found = true; } });
      return { ...t, assignments: newA };
    }));
    if (!found) {
      setChairBlocks(prev => prev.map(b => {
        const newA = { ...b.assignments };
        Object.entries(newA).forEach(([k, v]) => { if (v === attIdx) { delete newA[k]; found = true; } });
        return { ...b, assignments: newA };
      }));
    }
    setStatus(found ? `Recalled: ${displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst)}` : 'Not seated');
  }

  // Assign attendee to seat (from list view click or canvas drop)
  function assignAttendee(entityType, entityId, seatKey, attIdx) {
    if (disabledAttendees.has(attIdx)) return;
    if (assigned.has(attIdx)) { setStatus('Already assigned'); return; }
    saveUndo();
    if (entityType === 'table') {
      setTables(prev => prev.map(t => t.id === entityId ? { ...t, assignments: { ...t.assignments, [seatKey]: attIdx } } : t));
    } else {
      setChairBlocks(prev => prev.map(b => b.id === entityId ? { ...b, assignments: { ...b.assignments, [seatKey]: attIdx } } : b));
    }
    setStatus('Assigned');
  }

  function unassignSeat(entityType, entityId, seatKey) {
    saveUndo();
    if (entityType === 'table') {
      setTables(prev => prev.map(t => {
        if (t.id !== entityId) return t;
        const newA = { ...t.assignments };
        delete newA[seatKey];
        return { ...t, assignments: newA };
      }));
    } else {
      setChairBlocks(prev => prev.map(b => {
        if (b.id !== entityId) return b;
        const newA = { ...b.assignments };
        delete newA[seatKey];
        return { ...b, assignments: newA };
      }));
    }
    setStatus('Unassigned');
  }

  // Swap two seats within the same entity
  function swapSeats(entityType, entityId, seatKeyA, seatKeyB) {
    if (seatKeyA === seatKeyB) return;
    saveUndo();
    const updater = prev => prev.map(e => {
      if (e.id !== entityId) return e;
      const newA = { ...e.assignments };
      const aVal = newA[seatKeyA];
      const bVal = newA[seatKeyB];
      if (aVal !== undefined && bVal !== undefined) {
        newA[seatKeyA] = bVal;
        newA[seatKeyB] = aVal;
      } else if (aVal !== undefined) {
        newA[seatKeyB] = aVal;
        delete newA[seatKeyA];
      } else if (bVal !== undefined) {
        newA[seatKeyA] = bVal;
        delete newA[seatKeyB];
      }
      return { ...e, assignments: newA };
    });
    if (entityType === 'table') setTables(updater);
    else setChairBlocks(updater);
    setStatus('Seats swapped');
  }

  // Move attendee from one seat to another (potentially cross-entity)
  function moveSeatToSeat(srcType, srcId, srcKey, dstType, dstId, dstKey) {
    saveUndo();
    // Same entity = swap
    if (srcType === dstType && srcId === dstId) {
      swapSeats(srcType, srcId, srcKey, dstKey);
      return;
    }
    // Cross-entity: remove from src, add to dst
    let attIdx = null;
    const srcUpdater = prev => prev.map(e => {
      if (e.id !== srcId) return e;
      attIdx = e.assignments[srcKey];
      const newA = { ...e.assignments };
      delete newA[srcKey];
      return { ...e, assignments: newA };
    });
    if (srcType === 'table') setTables(srcUpdater);
    else setChairBlocks(srcUpdater);

    if (attIdx === null || attIdx === undefined) return;
    const dstUpdater = prev => prev.map(e => {
      if (e.id !== dstId) return e;
      return { ...e, assignments: { ...e.assignments, [dstKey]: attIdx } };
    });
    if (dstType === 'table') setTables(dstUpdater);
    else setChairBlocks(dstUpdater);
    setStatus('Moved');
  }

  // Force-assign attendee to specific seat (overrides "already assigned" check for popup drops)
  function forceAssignSeat(entityType, entityId, seatKey, attIdx) {
    if (disabledAttendees.has(attIdx)) return;
    saveUndo();
    if (entityType === 'table') {
      setTables(prev => prev.map(t => t.id === entityId ? { ...t, assignments: { ...t.assignments, [seatKey]: attIdx } } : t));
    } else {
      setChairBlocks(prev => prev.map(b => b.id === entityId ? { ...b, assignments: { ...b.assignments, [seatKey]: attIdx } } : b));
    }
    setStatus('Assigned');
  }

  // Rename a table or block
  function renameEntity(entityType, entityId, newName) {
    if (entityType === 'table') {
      setTables(prev => prev.map(t => t.id === entityId ? { ...t, name: newName } : t));
    } else {
      setChairBlocks(prev => prev.map(b => b.id === entityId ? { ...b, name: newName } : b));
    }
  }

  // Assign attendee to next available seat on an entity
  function assignNextAvailable(entityType, entityId, attIdx) {
    if (disabledAttendees.has(attIdx)) return;
    if (assigned.has(attIdx)) return;
    const entity = entityType === 'table'
      ? tables.find(t => t.id === entityId)
      : chairBlocks.find(b => b.id === entityId);
    if (!entity) return;
    let seatKeys = [];
    if (entityType === 'table') {
      const total = getTableTotalSeats(entity);
      for (let i = 0; i < total; i++) seatKeys.push(i);
    } else {
      for (let r = 0; r < entity.rows; r++)
        for (let c = 0; c < entity.cols; c++)
          seatKeys.push(`${r}-${c}`);
    }
    const openKey = seatKeys.find(k => !(k in entity.assignments));
    if (openKey === undefined) { setStatus('Table full'); return; }
    forceAssignSeat(entityType, entityId, openKey, attIdx);
  }

  // Canvas event handlers
  function handleCanvasMouseDown(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (ghostEntity) {
      // Place ghost
      const raw = { x: pxToFt(x - offsetX), y: pxToFt(y - offsetY) };
      const snapped = snapEntityPos(raw.x, raw.y, ghostEntity, ghostType);
      saveUndo();
      const placed = { ...ghostEntity, x: snapped.x, y: snapped.y };
      if (ghostType === 'table') {
        setTables(prev => [...prev, placed]);
        setNextTableId(prev => prev + 1);
        setNextColorIdx(prev => prev + 1);
      } else if (ghostType === 'block') {
        setChairBlocks(prev => [...prev, placed]);
        setNextBlockId(prev => prev + 1);
      } else {
        setVenueElements(prev => [...prev, placed]);
        setNextElementId(prev => prev + 1);
      }
      setGhostEntity(null);
      setGhostType(null);
      setStatus('Placed');
      return;
    }

    // Handle drag-drop of attendee onto canvas seat or table body
    if (dragAttendee !== null) {
      // Don't start a new action while dragging — drops are handled in mouseUp
      return;
    }

    // Handle drag from popup onto canvas — drops are handled in mouseUp
    if (popupDragSeat) {
      return;
    }

    // Try to select or start drag
    const hit = hitTest(x, y, canvasState);
    if (hit) {
      const [type, item] = hit;
      const ctrlHeld = e.ctrlKey || e.metaKey;
      if (ctrlHeld) {
        // Multi-select
        setSelectedItems(prev => {
          const exists = prev.find(([t, i]) => t === type && i.id === item.id);
          if (exists) return prev.filter(([t, i]) => !(t === type && i.id === item.id));
          return [...prev, [type, item]];
        });
      } else {
        setSelectedItem([type, item]);
        setSelectedItems([]);
      }
      dragRef.current = { startX: x, startY: y, entity: item, origX: item.x, origY: item.y, hasMoved: false };
      setDragging(true);
    } else {
      setSelectedItem(null);
      setSelectedItems([]);
    }
  }

  function handleCanvasMouseMove(e) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (ghostEntity) {
      const raw = { x: pxToFt(x - offsetX), y: pxToFt(y - offsetY) };
      const snapped = snapEntityPos(raw.x, raw.y, ghostEntity, ghostType);
      setGhostEntity(prev => ({ ...prev, x: snapped.x, y: snapped.y }));
      return;
    }

    if (dragging && dragRef.current.entity && selectedItem) {
      const item = dragRef.current.entity;
      if (item.locked) return;
      const dx = pxToFt(x - dragRef.current.startX);
      const dy = pxToFt(y - dragRef.current.startY);
      if (!dragRef.current.hasMoved && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        dragRef.current.hasMoved = true;
        saveUndo();
      }
      if (dragRef.current.hasMoved) {
        const rawX = Math.max(0, Math.min(roomWidth, dragRef.current.origX + dx));
        const rawY = Math.max(0, Math.min(roomHeight, dragRef.current.origY + dy));
        const [type] = selectedItem;
        const snapped = snapEntityPos(rawX, rawY, item, type);
        if (type === 'table') setTables(prev => prev.map(t => t.id === item.id ? { ...t, x: snapped.x, y: snapped.y } : t));
        else if (type === 'block') setChairBlocks(prev => prev.map(b => b.id === item.id ? { ...b, x: snapped.x, y: snapped.y } : b));
        else setVenueElements(prev => prev.map(el => el.id === item.id ? { ...el, x: snapped.x, y: snapped.y } : el));
      }
    }
  }

  function handleCanvasMouseUp(e) {
    // Handle drag-drop of attendee onto canvas seat or table body
    if (dragAttendee !== null) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const seatInfo = seatHitTest(x, y, canvasState);
      if (seatInfo && !(seatInfo.seatKey in seatInfo.entity.assignments)) {
        assignAttendee(seatInfo.entityType, seatInfo.entity.id, seatInfo.seatKey, dragAttendee);
      } else {
        const tableHit = hitTest(x, y, canvasState);
        if (tableHit && (tableHit[0] === 'table' || tableHit[0] === 'block')) {
          assignNextAvailable(tableHit[0], tableHit[1].id, dragAttendee);
        }
      }
      setDragAttendee(null);
      setDragGhostPos(null);
      setDragging(false);
      return;
    }

    // Handle drag from popup onto canvas seat (cross-table move)
    if (popupDragSeat) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const seatInfo = seatHitTest(x, y, canvasState);
      if (seatInfo && !(seatInfo.seatKey in seatInfo.entity.assignments)) {
        moveSeatToSeat(popupDragSeat.entityType, popupDragSeat.entityId, popupDragSeat.seatKey,
          seatInfo.entityType, seatInfo.entity.id, seatInfo.seatKey);
      }
      setPopupDragSeat(null);
      setDragGhostPos(null);
      setDragging(false);
      return;
    }

    setDragging(false);
    dragRef.current = { startX: 0, startY: 0, entity: null, hasMoved: false };
  }

  function handleCanvasDoubleClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(x, y, canvasState);
    if (hit) {
      setSelectedItem(hit);
      setSelectedItems([]);
      setTimeout(() => editEntity(), 50);
    }
  }

  function handleCanvasContextMenu(e) {
    e.preventDefault();
    if (ghostEntity) {
      cancelGhost();
    }
  }

  function handleWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      setZoomLevel(prev => e.deltaY < 0
        ? Math.min(400, prev === 100 ? 125 : prev + 25)
        : Math.max(25, prev > 100 ? prev - 25 : prev === 100 ? 75 : prev - 25));
    }
  }

  // Drag attendee from list
  function handleAttendeeDragStart(e, attIdx) {
    if (disabledAttendees.has(attIdx) || assigned.has(attIdx)) return;
    setDragAttendee(attIdx);
    setDragGhostPos({ x: e.clientX, y: e.clientY });
  }

  // Stats
  const totalSeats = tables.reduce((s, t) => s + getTableTotalSeats(t), 0) + chairBlocks.reduce((s, b) => s + getBlockTotalSeats(b), 0);
  const totalAssigned = assigned.size;
  const unassignedCount = attendees.length - totalAssigned;

  // Filtered attendee list
  // Live entity from current state (for toolbar display — avoids stale snapshots)
  const liveSelectedEntity = useMemo(() => {
    if (!selectedItem) return null;
    const [type, ref] = selectedItem;
    if (type === 'table') return tables.find(t => t.id === ref.id) || null;
    if (type === 'block') return chairBlocks.find(b => b.id === ref.id) || null;
    return venueElements.find(e => e.id === ref.id) || null;
  }, [selectedItem, tables, chairBlocks, venueElements]);

  const filteredAttendees = useMemo(() => {
    const term = search.toLowerCase();
    let list = attendees.map((a, i) => ({ last: a[0], first: a[1], idx: i }))
      .filter(a => !term || `${a.last} ${a.first}`.toLowerCase().includes(term));
    // Sort by display name order
    const [pk, sk] = firstFirst ? ['first', 'last'] : ['last', 'first'];
    list.sort((a, b) => a[pk].toLowerCase().localeCompare(b[pk].toLowerCase()) || a[sk].toLowerCase().localeCompare(b[sk].toLowerCase()));
    if (attendeeListMode === 'unassigned-first') {
      list.sort((a, b) => {
        const aActive = !assigned.has(a.idx) && !disabledAttendees.has(a.idx);
        const bActive = !assigned.has(b.idx) && !disabledAttendees.has(b.idx);
        if (aActive !== bActive) return aActive ? -1 : 1;
        return 0; // preserve alphabetical within group
      });
    }
    return list;
  }, [attendees, search, attendeeListMode, assigned, disabledAttendees, firstFirst]);

  // === RENDER ===
  return (
    <>
      {/* Global drag ghost */}
      {dragAttendee !== null && dragGhostPos && (
        <div className="drag-ghost" style={{ left: dragGhostPos?.x, top: dragGhostPos?.y }}>
          {displayName(attendees[dragAttendee][0], attendees[dragAttendee][1], firstFirst)}
        </div>
      )}
      {popupDragSeat && dragGhostPos && (
        <div className="drag-ghost" style={{ left: dragGhostPos?.x, top: dragGhostPos?.y }}>
          {displayName(attendees[popupDragSeat.attIdx]?.[0], attendees[popupDragSeat.attIdx]?.[1], firstFirst)}
        </div>
      )}

      {/* TOP BAR */}
      <div className="topbar">
        <div className="topbar-section" style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setMenuOpen(menuOpen === 'file' ? null : 'file')}>File ▾</button>
          {menuOpen === 'file' && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={newProject}>New Project</button>
              <button className="menu-item" onClick={saveProject}>Save Project</button>
              <button className="menu-item" onClick={() => fileInputRef.current?.click()}>Load Project</button>
              <div className="menu-divider" />
              <button className="menu-item" onClick={() => { setMenuOpen(null); setModal({ type: 'export' }); }}>Export Image</button>
            </div>
          )}
        </div>

        <div className="topbar-section" style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setMenuOpen(menuOpen === 'tools' ? null : 'tools')}>Tools ▾</button>
          {menuOpen === 'tools' && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={clearAllAssignments}>Clear All Assignments</button>
              <div className="menu-divider" />
              <div className="menu-label">Auto-Assign</div>
              <button className="menu-item" onClick={() => autoAssign('alpha')}>Alphabetical</button>
              <button className="menu-item" onClick={() => autoAssign('fill')}>Fill in Order</button>
              <button className="menu-item" onClick={() => autoAssign('random')}>Random</button>
            </div>
          )}
        </div>

        <div className="topbar-section" style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setMenuOpen(menuOpen === 'settings' ? null : 'settings')}>Settings ▾</button>
          {menuOpen === 'settings' && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <label className="menu-toggle">
                <input type="checkbox" checked={showPlacement} onChange={e => setShowPlacement(e.target.checked)} />
                Show Names
              </label>
              <label className="menu-toggle">
                <input type="checkbox" checked={hideGrid} onChange={e => setHideGrid(e.target.checked)} />
                Hide Grid
              </label>
              <label className="menu-toggle">
                <input type="checkbox" checked={snapEnabled} onChange={e => setSnapEnabled(e.target.checked)} />
                Snap to Grid
              </label>
              <div className="menu-divider" />
              <label className="menu-toggle">
                <input type="checkbox" checked={firstFirst} onChange={e => setNameOrder(e.target.checked ? 'first-last' : 'last-first')} />
                First Name First
              </label>
            </div>
          )}
        </div>

        <div className="topbar-divider" />

        <div className="topbar-section">
          <span className="topbar-label">Grid</span>
          <select value={gridSize} onChange={e => setGridSize(Number(e.target.value))} style={{ width: 65 }}>
            <option value={1}>1 ft</option>
            <option value={2}>2 ft</option>
            <option value={5}>5 ft</option>
          </select>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-section">
          <span className="topbar-label">Zoom</span>
          <button className="btn btn-icon btn-sm" onClick={() => setZoomLevel(prev => Math.max(25, prev > 100 ? prev - 25 : prev === 100 ? 75 : prev - 25))}>−</button>
          <span className="topbar-label" style={{ width: 36, textAlign: 'center' }}>{zoomLevel === 100 ? 'Fit' : `${zoomLevel}%`}</span>
          <button className="btn btn-icon btn-sm" onClick={() => setZoomLevel(prev => Math.min(400, prev === 100 ? 125 : prev + 25))}>+</button>
          <button className="btn btn-sm" onClick={() => setZoomLevel(100)}>Fit</button>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-section">
          <span className="topbar-label">Room</span>
          <input type="number" value={roomWidth} min={10} max={200} onChange={e => setRoomWidth(Number(e.target.value))} style={{ width: 50 }} />
          <span className="topbar-label">×</span>
          <input type="number" value={roomHeight} min={10} max={200} onChange={e => setRoomHeight(Number(e.target.value))} style={{ width: 50 }} />
          <span className="topbar-label">ft</span>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-section">
          <span className="topbar-label">View</span>
          <button className={`btn btn-sm ${currentView === 'canvas' ? 'btn-accent' : ''}`} onClick={() => setCurrentView('canvas')}>Canvas</button>
          <button className={`btn btn-sm ${currentView === 'list' ? 'btn-accent' : ''}`} onClick={() => setCurrentView('list')}>List</button>
        </div>

        <div style={{ flex: 1 }} />
      </div>

      {/* SELECTION TOOLBAR */}
      <div className="sel-toolbar">
        <span className="topbar-label">Selection:</span>
        <button className="btn btn-sm" disabled={!selectedItem} onClick={editEntity}>Edit</button>
        <button className="btn btn-sm" disabled={!selectedItem} onClick={rotateSelected}>Rotate</button>
        <button className={`btn btn-sm btn-lock ${liveSelectedEntity?.locked ? 'locked' : ''}`} disabled={!selectedItem} onClick={toggleLock}>
          {liveSelectedEntity?.locked ? 'Unlock' : 'Lock'}
        </button>
        <button className="btn btn-sm" disabled={!selectedItem} onClick={copySelected}>Copy</button>
        <button className="btn btn-sm btn-danger" disabled={!selectedItem} onClick={deleteSelected}>Delete</button>
        <span className="sel-info">
          {selectedItem ? (liveSelectedEntity?.name || `${selectedItem[0]} ${selectedItem[1].id}`) : 'None selected'}
        </span>

        <div className="topbar-divider" />

        <div className="topbar-section" style={{ position: 'relative' }}>
          <button className="btn btn-success btn-sm" onClick={() => setMenuOpen(menuOpen === 'addSeating' ? null : 'addSeating')}>+ Seating ▾</button>
          {menuOpen === 'addSeating' && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={() => addEntity('round_table')}>Round Table</button>
              <button className="menu-item" onClick={() => addEntity('rect_table')}>Rectangular Table</button>
              <button className="menu-item" onClick={() => addEntity('chair_block')}>Chair Block</button>
            </div>
          )}
        </div>
        <div className="topbar-section" style={{ position: 'relative' }}>
          <button className="btn btn-venue btn-sm" onClick={() => setMenuOpen(menuOpen === 'addVenue' ? null : 'addVenue')}>+ Venue ▾</button>
          {menuOpen === 'addVenue' && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={() => addEntity('dance_floor')}>Dance Floor</button>
              <button className="menu-item" onClick={() => addEntity('stage')}>Stage</button>
              <button className="menu-item" onClick={() => addEntity('bar')}>Bar</button>
              <button className="menu-item" onClick={() => addEntity('dj_booth')}>DJ Booth</button>
              <button className="menu-item" onClick={() => addEntity('buffet')}>Buffet</button>
            </div>
          )}
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="app-layout"
        onMouseMove={e => {
          if (dragAttendee !== null || popupDragSeat) setDragGhostPos({ x: e.clientX, y: e.clientY });
        }}
        onMouseUp={() => {
          if (dragAttendee !== null) {
            setDragAttendee(null);
            setDragGhostPos(null);
          }
          if (popupDragSeat) {
            setPopupDragSeat(null);
            setDragGhostPos(null);
          }
        }}>
        {/* LEFT PANEL */}
        <div className={`left-panel ${!panelOpen ? 'collapsed' : ''}`}>
          {!panelOpen ? (
            <div className="collapsed-strip">
              <button className="btn btn-icon btn-sm" onClick={() => setPanelOpen(true)}>►</button>
              {'ATTENDEES'.split('').map((c, i) => <span key={i}>{c}</span>)}
            </div>
          ) : (
            <>
              <div className="panel-header">
                <button className="btn btn-icon btn-sm" onClick={() => setPanelOpen(false)}>◄</button>
                <h3>Attendees</h3>
                <span className="count">({attendees.length})</span>
              </div>
              <div className="panel-content">
                <div className="search-box">
                  <span className="search-icon">🔍</span>
                  <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                  <button className={`btn btn-sm sort-mode-btn ${attendeeListMode === 'unassigned-first' ? 'active' : ''}`}
                    onClick={() => setAttendeeListMode(m => m === 'all' ? 'unassigned-first' : 'all')}
                    title={attendeeListMode === 'all' ? 'Sort: show unassigned first' : 'Sort: all alphabetical'}>
                    {attendeeListMode === 'all' ? 'A-Z' : '⬆ A-Z'}
                  </button>
                </div>
                <div className="attendee-list">
                  {filteredAttendees.map(a => {
                    const isAssigned = assigned.has(a.idx);
                    const isDisabled = disabledAttendees.has(a.idx);
                    const isSelected = selectedAttendee === a.idx;
                    return (
                      <div key={a.idx}
                        className={`attendee-item ${isAssigned ? 'assigned' : ''} ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
                        onMouseDown={e => {
                          if (e.button !== 0) return;
                          setSelectedAttendee(a.idx);
                          if (!isAssigned && !isDisabled) handleAttendeeDragStart(e, a.idx);
                        }}
                        onDragStart={e => e.preventDefault()}
                        title={isAssigned ? 'Assigned' : isDisabled ? 'Disabled' : 'Click to select, drag to seat'}>
                        {displayName(a.last, a.first, firstFirst)}
                      </div>
                    );
                  })}
                  {filteredAttendees.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                      {attendees.length ? 'No matches' : 'No attendees loaded'}
                    </div>
                  )}
                </div>
                <div className="panel-actions">
                  <button className="btn btn-sm" onClick={addAttendee} title="Add attendee">+</button>
                  <button className="btn btn-sm" onClick={() => selectedAttendee != null && toggleDisable(selectedAttendee)} title="Disable/Enable">⊘</button>
                  <button className="btn btn-sm" onClick={() => selectedAttendee != null && recallAttendee(selectedAttendee)} title="Recall (unassign)">↩</button>
                  <div style={{ flex: 1 }} />
                  <input type="file" accept=".csv" ref={csvInputRef} style={{ display: 'none' }} onChange={loadCSV} />
                  <button className="btn btn-success btn-sm" onClick={() => csvInputRef.current?.click()}>Load CSV</button>
                  <button className="btn btn-icon btn-sm" onClick={doExportCSV} title="Export CSV" style={{ width: 30, height: 30, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 1v8M4 6l3 3 3-3M2 10v2h10v-2" />
                    </svg>
                  </button>
                </div>
                <div className="panel-stats">
                  Seats: {totalAssigned}/{totalSeats} filled<br />
                  Attendees: {attendees.length} ({unassignedCount} unassigned)
                  {disabledAttendees.size > 0 && <>, {disabledAttendees.size} disabled</>}
                </div>
              </div>
            </>
          )}
        </div>

        {/* CANVAS VIEW */}
        {currentView === 'canvas' && (
          <div className="canvas-area" ref={containerRef}
            onWheel={handleWheel}>
            <canvas ref={canvasRef}
              style={{ cursor: ghostEntity ? 'crosshair' : dragging ? 'grabbing' : 'default' }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onDoubleClick={handleCanvasDoubleClick}
              onContextMenu={handleCanvasContextMenu} />
            {/* TABLE POPUP OVERLAY */}
            {tablePopupOpen && selectedItem && (selectedItem[0] === 'table' || selectedItem[0] === 'block') && (
              <TablePopup
                entity={selectedItem[0] === 'table'
                  ? tables.find(t => t.id === selectedItem[1].id)
                  : chairBlocks.find(b => b.id === selectedItem[1].id)}
                entityType={selectedItem[0]}
                attendees={attendees}
                disabledAttendees={disabledAttendees}
                assigned={assigned}
                dragAttendee={dragAttendee}
                popupDragSeat={popupDragSeat}
                onClose={() => setTablePopupOpen(false)}
                onUnassign={(seatKey) => unassignSeat(selectedItem[0], selectedItem[1].id, seatKey)}
                onRename={(newName) => renameEntity(selectedItem[0], selectedItem[1].id, newName)}
                onSeatDragStart={(seatKey, attIdx, e) => {
                  setPopupDragSeat({ entityType: selectedItem[0], entityId: selectedItem[1].id, seatKey, attIdx });
                  setDragGhostPos({ x: e.clientX, y: e.clientY });
                }}
                onSeatDrop={(seatKey) => {
                  if (dragAttendee !== null) {
                    forceAssignSeat(selectedItem[0], selectedItem[1].id, seatKey, dragAttendee);
                    setDragAttendee(null);
                    setDragGhostPos(null);
                  } else if (popupDragSeat) {
                    if (popupDragSeat.entityId === selectedItem[1].id && popupDragSeat.entityType === selectedItem[0]) {
                      swapSeats(selectedItem[0], selectedItem[1].id, popupDragSeat.seatKey, seatKey);
                    } else {
                      moveSeatToSeat(popupDragSeat.entityType, popupDragSeat.entityId, popupDragSeat.seatKey,
                        selectedItem[0], selectedItem[1].id, seatKey);
                    }
                    setPopupDragSeat(null);
                    setDragGhostPos(null);
                  }
                }}
                onDropNextAvailable={() => {
                  if (dragAttendee !== null) {
                    assignNextAvailable(selectedItem[0], selectedItem[1].id, dragAttendee);
                    setDragAttendee(null);
                    setDragGhostPos(null);
                  }
                }}
                firstFirst={firstFirst}
              />
            )}
          </div>
        )}

        {/* LIST VIEW */}
        {currentView === 'list' && (
          <ListView
            tables={tables} chairBlocks={chairBlocks} attendees={attendees}
            assigned={assigned} disabledAttendees={disabledAttendees}
            selectedAttendee={selectedAttendee} search={listSearch}
            collapsedCards={collapsedCards}
            onSearchChange={setListSearch}
            onToggleCollapse={(id) => setCollapsedCards(prev => {
              const n = new Set(prev);
              if (n.has(id)) n.delete(id); else n.add(id);
              return n;
            })}
            onExpandAll={() => setCollapsedCards(new Set())}
            onCollapseAll={() => {
              const all = new Set();
              tables.forEach(t => all.add(`table_${t.id}`));
              chairBlocks.forEach(b => all.add(`block_${b.id}`));
              setCollapsedCards(all);
            }}
            onAssign={assignAttendee}
            onUnassign={unassignSeat}
            onRename={renameEntity}
            onChangeColor={changeEntityColor}
            onDelete={confirmDeleteEntity}
            dragAttendee={dragAttendee}
            onDropNextAvailable={(et, eid, attIdx) => {
              assignNextAvailable(et, eid, attIdx);
              setDragAttendee(null);
              setDragGhostPos(null);
            }}
            onSelect={(type, entity) => { setSelectedItem([type, entity]); setSelectedItems([]); }}
            selectedItem={selectedItem}
            firstFirst={firstFirst}
          />
        )}
      </div>

      {/* STATUS BAR */}
      <div className="status-bar">
        <input type="file" accept=".json,.seating" ref={fileInputRef} style={{ display: 'none' }} onChange={loadProject} />
        <span className="status-text">{status}</span>
      </div>

      {/* MODAL */}
      {modal && <Modal modal={modal} onClose={() => setModal(null)} onConfirmAdd={confirmAdd} onConfirmEdit={confirmEdit} onConfirmAddAttendee={confirmAddAttendee} onExport={exportImage} />}
    </>
  );
}

// === TABLE POPUP ===
function TablePopup({ entity, entityType, attendees, disabledAttendees, assigned, dragAttendee, popupDragSeat,
  onClose, onUnassign, onRename, onSeatDragStart, onSeatDrop, onDropNextAvailable, firstFirst }) {
  const [dragOverSeat, setDragOverSeat] = useState(null);
  const [dragOverHeader, setDragOverHeader] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef(null);

  if (!entity) return null;

  // Build seat keys list
  let seatKeys = [];
  if (entityType === 'table') {
    const total = getTableTotalSeats(entity);
    for (let i = 0; i < total; i++) seatKeys.push(i);
  } else {
    for (let r = 0; r < entity.rows; r++) {
      for (let c = 0; c < entity.cols; c++) {
        seatKeys.push(`${r}-${c}`);
      }
    }
  }

  const defaultName = entityType === 'table' ? `Table ${entity.id}` : `Block ${entity.id}`;
  const displayName = entity.name || defaultName;
  const filledCount = Object.keys(entity.assignments).length;
  const isDragging = dragAttendee !== null || popupDragSeat !== null;

  function startEditing() {
    setEditingName(true);
    setNameValue(entity.name || '');
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  function commitName() {
    setEditingName(false);
    onRename(nameValue.trim());
  }

  function handleHeaderDrop() {
    if (isDragging) {
      onDropNextAvailable();
      setDragOverHeader(false);
    }
  }

  return (
    <div className={`table-popup ${isDragging ? 'is-dragging' : ''}`} onMouseDown={e => e.stopPropagation()}>
      <div className={`table-popup-header ${dragOverHeader ? 'drop-target' : ''}`}
        onMouseEnter={() => { if (isDragging) setDragOverHeader(true); }}
        onMouseLeave={() => setDragOverHeader(false)}
        onMouseUp={handleHeaderDrop}>
        {editingName && !isDragging ? (
          <input ref={nameInputRef} className="table-popup-name-input" value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
            autoFocus />
        ) : (
          <span className="table-popup-title" onClick={() => { if (!isDragging) startEditing(); }} title="Click to rename">
            {displayName}
          </span>
        )}
        <span className="table-popup-count">{filledCount}/{seatKeys.length}</span>
        <button className="btn btn-icon btn-sm table-popup-close" onClick={onClose}>✕</button>
      </div>
      <div className="table-popup-seats">
        {seatKeys.map(key => {
          const attIdx = entity.assignments[key];
          const isOccupied = attIdx !== undefined;
          const att = isOccupied ? attendees[attIdx] : null;
          const isDropTarget = dragOverSeat === key && isDragging;

          return (
            <div key={key}
              className={`table-popup-seat ${isOccupied ? 'occupied' : 'empty'} ${isDropTarget ? 'drop-target' : ''} ${key === 0 || key === '0-0' ? 'seat-one' : ''}`}
              onMouseEnter={() => { if (isDragging) setDragOverSeat(key); }}
              onMouseLeave={() => setDragOverSeat(null)}
              onMouseUp={() => {
                if (isDragging) {
                  onSeatDrop(key);
                  setDragOverSeat(null);
                }
              }}>
              <span className="seat-num">{entityType === 'table' ? Number(key) + 1 : key}</span>
              {isOccupied ? (
                <>
                  <span className="seat-name"
                    onMouseDown={e => { if (e.button === 0) onSeatDragStart(key, attIdx, e); }}
                    title="Drag to reorder or move to another table">
                    {displayName(att[0], att[1], firstFirst)}
                  </span>
                  <button className="seat-remove" onClick={() => onUnassign(key)} title="Remove from seat">✕</button>
                </>
              ) : (
                <span className="seat-empty-label">
                  {isDropTarget ? 'Drop here' : 'Empty'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === LIST VIEW ===
function ListView({ tables, chairBlocks, attendees, assigned, disabledAttendees, selectedAttendee, search, collapsedCards, onSearchChange, onToggleCollapse, onExpandAll, onCollapseAll, onAssign, onUnassign, onRename, onChangeColor, onDelete, dragAttendee, onDropNextAvailable, onSelect, selectedItem, firstFirst }) {
  const totalSeats = tables.reduce((s, t) => s + getTableTotalSeats(t), 0) + chairBlocks.reduce((s, b) => s + getBlockTotalSeats(b), 0);
  const totalAssigned = assigned.size;
  const unassigned = attendees.length - totalAssigned;
  const term = search.toLowerCase();

  return (
    <div className="list-view">
      <div className="list-header">
        <h2>Seating Breakdown</h2>
        <span className="badge">{totalAssigned}/{totalSeats} seated</span>
        {unassigned > 0 && <span className="warning">⚠ {unassigned} unassigned</span>}
      </div>
      <div className="list-controls">
        <span className="search-icon">🔍</span>
        <input type="text" placeholder="Filter tables..." value={search} onChange={e => onSearchChange(e.target.value)} style={{ width: 180 }} />
        <button className="btn btn-sm" onClick={onExpandAll}>▼ Expand</button>
        <button className="btn btn-sm" onClick={onCollapseAll}>▲ Collapse</button>
      </div>
      <div className="cards-grid">
        {tables.filter(t => !term || (t.name || `Table ${t.id}`).toLowerCase().includes(term)).map(t => (
          <EntityCard key={`t${t.id}`} entity={t} entityType="table" attendees={attendees}
            collapsed={collapsedCards.has(`table_${t.id}`)}
            onToggle={() => onToggleCollapse(`table_${t.id}`)}
            selectedAttendee={selectedAttendee} assigned={assigned} disabledAttendees={disabledAttendees}
            onAssign={onAssign} onUnassign={onUnassign}
            onRename={onRename} onChangeColor={onChangeColor} onDelete={onDelete}
            dragAttendee={dragAttendee} onDropNextAvailable={onDropNextAvailable}
            onSelect={onSelect} isSelected={selectedItem?.[0] === 'table' && selectedItem?.[1]?.id === t.id} firstFirst={firstFirst} />
        ))}
        {chairBlocks.filter(b => !term || (b.name || `Block ${b.id}`).toLowerCase().includes(term)).map(b => (
          <EntityCard key={`b${b.id}`} entity={b} entityType="block" attendees={attendees}
            collapsed={collapsedCards.has(`block_${b.id}`)}
            onToggle={() => onToggleCollapse(`block_${b.id}`)}
            selectedAttendee={selectedAttendee} assigned={assigned} disabledAttendees={disabledAttendees}
            onAssign={onAssign} onUnassign={onUnassign}
            onRename={onRename} onChangeColor={onChangeColor} onDelete={onDelete}
            dragAttendee={dragAttendee} onDropNextAvailable={onDropNextAvailable}
            onSelect={onSelect} isSelected={selectedItem?.[0] === 'block' && selectedItem?.[1]?.id === b.id} firstFirst={firstFirst} />
        ))}
      </div>
      {!tables.length && !chairBlocks.length && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          No tables or chair blocks yet. Switch to Canvas to add seating.
        </div>
      )}
    </div>
  );
}

function EntityCard({ entity, entityType, attendees, collapsed, onToggle, selectedAttendee, assigned, disabledAttendees, onAssign, onUnassign, onRename, onChangeColor, onDelete, dragAttendee, onDropNextAvailable, onSelect, isSelected, firstFirst }) {
  const total = getTotalSeats(entity);
  const filled = Object.keys(entity.assignments).length;
  const defaultName = `${entityType === 'table' ? 'Table' : 'Block'} ${entity.id}`;
  const displayName = entity.name || defaultName;
  const badgeClass = filled === total ? 'full' : filled > 0 ? 'partial' : '';
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const nameInputRef = useRef(null);

  function startEditing(e) {
    e.stopPropagation();
    setEditingName(true);
    setNameValue(entity.name || '');
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  function commitName() {
    setEditingName(false);
    onRename(entityType, entity.id, nameValue.trim());
  }

  return (
    <div className={`entity-card ${isDragOver ? 'drag-over' : ''} ${isSelected ? 'selected' : ''}`}
      onMouseEnter={() => { if (dragAttendee !== null) setIsDragOver(true); }}
      onMouseLeave={() => setIsDragOver(false)}
      onMouseUp={() => {
        if (dragAttendee !== null && isDragOver) {
          onDropNextAvailable(entityType, entity.id, dragAttendee);
          setIsDragOver(false);
        }
      }}>
      <div className="card-header" onClick={() => { onSelect(entityType, entity); onToggle(); }}>
        <span className="card-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className={`card-color ${entityType !== 'table' || entity.tableType !== 'round' ? 'rect' : ''} ${showColorPicker ? 'editing' : ''}`}
          style={{ background: entity.color, cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
          title="Change color" />
        {editingName ? (
          <input ref={nameInputRef} className="card-name-input"
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
            onClick={e => e.stopPropagation()}
            autoFocus />
        ) : (
          <span className="card-name" onDoubleClick={startEditing} title="Double-click to rename">{displayName}</span>
        )}
        <span className={`card-badge ${badgeClass}`}>{filled}/{total}</span>
        <button className="card-delete-btn" onClick={e => { e.stopPropagation(); onDelete(entityType, entity.id, displayName); }} title="Delete">✕</button>
      </div>
      <div className="card-body-wrapper">
        {showColorPicker && (
          <div className="card-color-overlay" onClick={e => { e.stopPropagation(); setShowColorPicker(false); }}>
            <div className="card-color-picker" onClick={e => e.stopPropagation()}>
              {COLOR_PALETTE.map(c => (
                <button key={c} className={`color-swatch ${entity.color === c ? 'active' : ''} ${c === '#FFFFFF' ? 'white-swatch' : ''}`}
                  style={{ background: c }}
                  onClick={() => { onChangeColor(entityType, entity.id, c); setShowColorPicker(false); }} />
              ))}
            </div>
          </div>
        )}
        {!collapsed && (
        <div className="card-seats">
          {entityType === 'table' ? (
            Array.from({ length: total }, (_, i) => (
              <SeatRow key={i} seatIdx={i} seatKey={i}
                entity={entity} entityType={entityType}
                attendees={attendees} selectedAttendee={selectedAttendee}
                assigned={assigned} disabledAttendees={disabledAttendees}
                onAssign={onAssign} onUnassign={onUnassign}
                dragAttendee={dragAttendee} firstFirst={firstFirst} />
            ))
          ) : (
            Array.from({ length: entity.rows }, (_, r) => (
              <div className="block-row" key={r}>
                <span className="block-row-label">R{r + 1}</span>
                {Array.from({ length: entity.cols }, (_, c) => {
                  const key = `${r}-${c}`;
                  const occ = key in entity.assignments;
                  const attIdx = occ ? entity.assignments[key] : null;
                  return (
                    <span key={c}
                      className={`block-seat ${occ ? 'filled' : 'empty'}`}
                      onClick={() => {
                        if (occ) onUnassign(entityType, entity.id, key);
                        else if (selectedAttendee != null && !assigned.has(selectedAttendee) && !disabledAttendees.has(selectedAttendee))
                          onAssign(entityType, entity.id, key, selectedAttendee);
                      }}
                      title={occ && attIdx < attendees.length ? displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst) : 'Empty — select an attendee and click'}>
                      {occ && attIdx < attendees.length ? formatName(attendees[attIdx][1], attendees[attIdx][0], 'initials', firstFirst) : '—'}
                    </span>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function SeatRow({ seatIdx, seatKey, entity, entityType, attendees, selectedAttendee, assigned, disabledAttendees, onAssign, onUnassign, dragAttendee, firstFirst }) {
  const occ = seatKey in entity.assignments;
  const attIdx = occ ? entity.assignments[seatKey] : null;
  const name = occ && attIdx < attendees.length ? displayName(attendees[attIdx][0], attendees[attIdx][1], firstFirst) : null;
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className={`seat-row ${isDragOver && !occ ? 'drag-over' : ''}`}
      onMouseEnter={() => { if (dragAttendee !== null && !occ) setIsDragOver(true); }}
      onMouseLeave={() => setIsDragOver(false)}
      onMouseUp={e => {
        if (dragAttendee !== null && !occ) {
          e.stopPropagation();
          onAssign(entityType, entity.id, seatKey, dragAttendee);
          setIsDragOver(false);
        }
      }}>
      <span className={`seat-num ${seatIdx === 0 ? 'star' : ''}`}>
        {seatIdx === 0 ? '★1' : `${seatIdx + 1}`}
      </span>
      <span className={`seat-name ${occ ? 'filled' : 'empty'}`}
        onClick={() => {
          if (!occ && selectedAttendee != null && !assigned.has(selectedAttendee) && !disabledAttendees.has(selectedAttendee)) {
            onAssign(entityType, entity.id, seatKey, selectedAttendee);
          }
        }}>
        {isDragOver && !occ ? '— drop here —' : name || '— empty —'}
      </span>
      {occ && (
        <div className="seat-actions">
          <button className="seat-action remove" onClick={() => onUnassign(entityType, entity.id, seatKey)} title="Remove">✕</button>
        </div>
      )}
    </div>
  );
}

// === MODAL ===
function Modal({ modal, onClose, onConfirmAdd, onConfirmEdit, onConfirmAddAttendee, onExport }) {
  const isAdd = modal.type === 'add';
  const isEdit = modal.type === 'edit';
  const isAddAttendee = modal.type === 'addAttendee';
  const isConfirm = modal.type === 'confirm';
  const isExport = modal.type === 'export';
  const et = modal.entityType;
  const defaults = modal.defaults || {};
  const entity = modal.entity;

  const [params, setParams] = useState(() => {
    if (isExport) return { resolution: 'high', includeGrid: true, includeNames: true, content: 'both' };
    if (isConfirm || isAddAttendee) return isAddAttendee ? { first: '', last: '' } : {};
    if (isAdd) {
      if (et === 'round_table') return { name: defaults.name || '', seats: defaults.seats || 8, diameter: defaults.widthFt || 5, color: defaults.color || '#8B4513' };
      if (et === 'rect_table') return { name: defaults.name || '', length: defaults.widthFt || 6, width: defaults.heightFt || 3, seats: defaults.seats || 3, endSeats: defaults.endSeats || 0, orientation: defaults.orientation || 'horizontal', color: defaults.color || '#8B4513' };
      if (et === 'chair_block') return { name: defaults.name || '', rows: defaults.rows || 3, cols: defaults.cols || 4, spacing: defaults.spacing || 'normal', color: defaults.color || '#4A4A4A' };
      return { name: defaults.name || '', widthFt: defaults.widthFt || 10, heightFt: defaults.heightFt || 10, color: defaults.color || '#D4AF37' };
    }
    if (isEdit && entity) {
      if (et === 'round_table') return { name: entity.name, seats: entity.seats, diameter: entity.widthFt, color: entity.color };
      if (et === 'rect_table') return { name: entity.name, length: entity.orientation === 'horizontal' ? entity.widthFt : entity.heightFt, width: entity.orientation === 'horizontal' ? entity.heightFt : entity.widthFt, seats: entity.seats, endSeats: entity.endSeats, orientation: entity.orientation, color: entity.color };
      if (et === 'chair_block') return { name: entity.name, rows: entity.rows, cols: entity.cols, spacing: entity.spacing, color: entity.color };
      return { name: entity.name, widthFt: entity.widthFt, heightFt: entity.heightFt, color: entity.color };
    }
    return {};
  });

  const set = (k, v) => setParams(p => ({ ...p, [k]: v }));

  if (isConfirm) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h3>{modal.title}</h3>
          <p style={{ margin: '12px 0', fontSize: 13, color: 'var(--text-secondary)' }}>{modal.message}</p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={modal.onConfirm}>Delete</button>
          </div>
        </div>
      </div>
    );
  }

  if (isExport) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 340 }}>
          <h3>Export Image</h3>

          <div className="modal-field">
            <label>Resolution</label>
            <div className="export-options">
              {[['standard', 'Standard', '30 px/ft'], ['high', 'High', '50 px/ft'], ['ultra', 'Ultra', '75 px/ft']].map(([val, lbl, desc]) => (
                <button key={val} className={`export-option ${params.resolution === val ? 'active' : ''}`}
                  onClick={() => set('resolution', val)}>
                  <strong>{lbl}</strong><span>{desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="modal-field">
            <label>Content</label>
            <div className="export-options">
              {[['canvas', 'Canvas Only'], ['both', 'Canvas + Summary'], ['summary', 'Summary Only']].map(([val, lbl]) => (
                <button key={val} className={`export-option ${params.content === val ? 'active' : ''}`}
                  onClick={() => set('content', val)}>
                  <strong>{lbl}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="modal-field">
            <label>Options</label>
            <label className="menu-toggle" style={{ padding: '4px 0' }}>
              <input type="checkbox" checked={params.includeGrid} onChange={e => set('includeGrid', e.target.checked)} />
              Include grid lines
            </label>
            <label className="menu-toggle" style={{ padding: '4px 0' }}>
              <input type="checkbox" checked={params.includeNames} onChange={e => set('includeNames', e.target.checked)} />
              Show seat names
            </label>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-success" onClick={() => { onExport(params); onClose(); }}>Export PNG</button>
          </div>
        </div>
      </div>
    );
  }

  const title = isAddAttendee ? 'Add Attendee'
    : `${isAdd ? 'Add' : 'Edit'} ${et?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>

        {isAddAttendee ? (
          <>
            <div className="modal-field">
              <label>Last Name</label>
              <input type="text" value={params.last} onChange={e => set('last', e.target.value)} autoFocus />
            </div>
            <div className="modal-field">
              <label>First Name</label>
              <input type="text" value={params.first} onChange={e => set('first', e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div className="modal-field">
              <label>Name</label>
              <input type="text" value={params.name || ''} onChange={e => set('name', e.target.value)} autoFocus />
            </div>

            {et === 'round_table' && (
              <>
                <div className="modal-row">
                  <div className="modal-field">
                    <label>Seats</label>
                    <input type="number" value={params.seats} min={4} max={16} onChange={e => set('seats', e.target.value)} />
                  </div>
                  <div className="modal-field">
                    <label>Diameter (ft)</label>
                    <input type="number" value={params.diameter} min={3} max={12} step={0.5} onChange={e => set('diameter', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {et === 'rect_table' && (
              <>
                <div className="modal-row">
                  <div className="modal-field">
                    <label>Length (ft)</label>
                    <input type="number" value={params.length} min={3} max={20} step={0.5} onChange={e => set('length', e.target.value)} />
                  </div>
                  <div className="modal-field">
                    <label>Width (ft)</label>
                    <input type="number" value={params.width} min={2} max={10} step={0.5} onChange={e => set('width', e.target.value)} />
                  </div>
                </div>
                <div className="modal-field">
                  <label>Orientation</label>
                  <select value={params.orientation} onChange={e => set('orientation', e.target.value)}>
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                </div>
                <div className="modal-row">
                  <div className="modal-field">
                    <label>Seats per side</label>
                    <input type="number" value={params.seats} min={1} max={10} onChange={e => set('seats', e.target.value)} />
                  </div>
                  <div className="modal-field">
                    <label>End seats</label>
                    <input type="number" value={params.endSeats} min={0} max={3} onChange={e => set('endSeats', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {et === 'chair_block' && (
              <>
                <div className="modal-row">
                  <div className="modal-field">
                    <label>Rows</label>
                    <input type="number" value={params.rows} min={1} max={20} onChange={e => set('rows', e.target.value)} />
                  </div>
                  <div className="modal-field">
                    <label>Columns</label>
                    <input type="number" value={params.cols} min={1} max={20} onChange={e => set('cols', e.target.value)} />
                  </div>
                </div>
                <div className="modal-field">
                  <label>Spacing</label>
                  <select value={params.spacing} onChange={e => set('spacing', e.target.value)}>
                    <option value="tight">Tight</option>
                    <option value="normal">Normal</option>
                    <option value="wide">Wide</option>
                  </select>
                </div>
              </>
            )}

            {!['round_table', 'rect_table', 'chair_block'].includes(et) && (
              <div className="modal-row">
                <div className="modal-field">
                  <label>Width (ft)</label>
                  <input type="number" value={params.widthFt} min={2} max={50} onChange={e => set('widthFt', e.target.value)} />
                </div>
                <div className="modal-field">
                  <label>Height (ft)</label>
                  <input type="number" value={params.heightFt} min={2} max={50} onChange={e => set('heightFt', e.target.value)} />
                </div>
              </div>
            )}

            <div className="modal-field">
              <label>Color</label>
              <div className="color-palette">
                {COLOR_PALETTE.map(c => (
                  <button key={c} className={`color-swatch ${params.color === c ? 'active' : ''} ${c === '#FFFFFF' ? 'white-swatch' : ''}`}
                    style={{ background: c }}
                    onClick={() => set('color', c)} />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={() => {
            if (isAddAttendee) onConfirmAddAttendee(params);
            else if (isAdd) onConfirmAdd(params);
            else onConfirmEdit(params);
          }}>
            {isAdd || isAddAttendee ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
