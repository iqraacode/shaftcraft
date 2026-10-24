// Container windows: player inventory (2x2 crafting, armor, offhand, live model preview),
// crafting table, furnace, chest, and the creative inventory (tabs, search, trash).
import * as THREE from 'three';
import { el } from './widgets.js';
import { getIconURL } from '../textures/icons.js';
import { ITEMS, ITEM_LIST, CREATIVE_TABS, maxStackOf } from '../../../shared/items.js';
import { recipesFor } from '../../../shared/recipes.js';
import { EntityView } from '../render/EntityRenderer.js';

const ARMOR_NAMES = ['helmet', 'chestplate', 'leggings', 'boots'];

export class PlayerPreview {
  constructor(app, name, skin) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 51 / 72, 0.1, 20);
    this.camera.position.set(0, 1.0, 4.2);
    this.camera.lookAt(0, 0.95, 0);
    this.view = new EntityView({ id: -2, type: 'player', name, skin, self: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, armor: [null, null, null, null] }, { atlas: app.renderer.atlas, chunkMaterials: app.renderer.chunks.materials });
    this.scene.add(this.view.group);
    this.angle = 0;
    this.fakeWorld = { getLight: () => 0xf0 };
  }
  resize(w, h) { this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); this.renderer.setSize(w, h, false); }
  render(dt, inv) {
    this.angle += dt * 0.6;
    const held = inv.main[inv.selected];
    this.view.setEquip({ held: held ? held.id : null, armor: inv.armor.map((a) => (a ? a.id : null)) });
    this.view.direct = { x: 0, y: 0, z: 0, yaw: this.angle, headYaw: this.angle + Math.sin(this.angle * 1.3) * 0.4, pitch: Math.sin(this.angle * 0.7) * 0.2, flags: 0 };
    this.view.update(dt, 0, this.fakeWorld, 1, 0);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.renderer.dispose(); }
}

export class InventoryUI {
  constructor(app) {
    this.app = app;
    this.root = null;
    this.slotEls = []; // [{ el, index }]
    this.hover = null;
    this.drag = null;
    this.lastClick = { slot: -1, time: 0 };
    this.creativeTab = 'building';
    this.search = '';
    this.cursorEl = el('div', 'cursor-item');
    this.tooltip = el('div', 'tooltip');
    this.mouse = { x: 0, y: 0 };
    this.onMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.positionFloating(); };
    this.onKey = (e) => this.handleKey(e);
    this.onUp = (e) => this.handleUp(e);
  }

  get game() { return this.app.game; }
  get isOpen() { return !!this.root; }

  open(type) {
    this.close(false);
    this.type = type;
    const root = el('div', 'inv-screen');
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) { e.preventDefault(); this.game.windowAction({ a: 'outside', button: e.button === 2 ? 1 : 0 }); }
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root = root;
    this.slotEls = [];
    if (type === 'creative') this.buildCreative(root);
    else this.buildWindow(root, type);
    root.append(this.cursorEl, this.tooltip);
    this.app.uiRoot.appendChild(root);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('mouseup', this.onUp);
    this.refresh();
  }

  close(notify = true) {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    if (this.preview) { this.preview.dispose(); this.preview = null; }
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('mouseup', this.onUp);
    this.drag = null; this.hover = null;
    if (notify && this.game) this.game.closeWindow();
  }

  // ---------- builders ----------
  slot(index, cls = '', ghost = null) {
    const s = el('div', 'slot ' + cls);
    s.dataset.index = index;
    if (ghost) { const g = el('div', 'ghost'); g.style.backgroundImage = `url(${getIconURL(ghost)})`; s.appendChild(g); s.ghost = g; }
    s.addEventListener('mousedown', (e) => this.slotDown(e, index));
    s.addEventListener('mouseenter', () => { this.hover = index; s.classList.add('hover'); this.dragEnter(index); this.updateTooltip(); });
    s.addEventListener('mouseleave', () => { if (this.hover === index) this.hover = null; s.classList.remove('hover'); this.updateTooltip(); });
    this.slotEls.push({ el: s, index });
    return s;
  }

  grid(cols, indexes, cls = '') {
    const g = el('div', 'slots');
    g.style.gridTemplateColumns = `repeat(${cols}, calc(18px * var(--s)))`;
    for (const i of indexes) g.appendChild(this.slot(i, cls));
    return g;
  }

  range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

  playerInvSection(storageStart, hotbarStart) {
    const wrap = el('div', 'col');
    wrap.style.gap = '0';
    wrap.style.alignItems = 'flex-start';
    const lbl = el('div', 'ptitle', 'Inventory');
    lbl.style.marginTop = 'calc(3px * var(--s))';
    wrap.append(lbl, this.grid(9, this.range(storageStart, storageStart + 26)));
    const hot = this.grid(9, this.range(hotbarStart, hotbarStart + 8));
    hot.style.marginTop = 'calc(4px * var(--s))';
    wrap.append(hot);
    return wrap;
  }

  buildWindow(root, type) {
    const panel = el('div', 'panel');
    const g = this.game;
    if (type === 'player') {
      const top = el('div', 'row');
      top.style.alignItems = 'flex-start';
      top.style.gap = 'calc(2px * var(--s))';
      const armor = el('div', 'col'); armor.style.gap = '0';
      for (let i = 0; i < 4; i++) armor.appendChild(this.slot(5 + i, '', ['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots'][i]));
      const prev = el('div', 'preview');
      this.preview = new PlayerPreview(this.app, g.name, this.app.options.get('skin'));
      prev.appendChild(this.preview.canvas);
      const offWrap = el('div', 'col'); offWrap.style.justifyContent = 'flex-end'; offWrap.style.height = 'calc(72px * var(--s))';
      offWrap.appendChild(this.slot(45, '', 'shears'));
      const craft = el('div', 'col');
      craft.style.gap = 'calc(2px * var(--s))';
      craft.style.marginLeft = 'calc(14px * var(--s))';
      const ct = el('div', 'ptitle', 'Crafting');
      const crow = el('div', 'row'); crow.style.gap = 'calc(5px * var(--s))';
      this.arrow = el('div', 'arrow-ico');
      crow.append(this.grid(2, [1, 2, 3, 4]), this.arrow, this.slot(0, 'big'));
      craft.append(ct, crow);
      top.append(armor, prev, offWrap, craft);
      panel.append(top, this.playerInvSection(9, 36));
      requestAnimationFrame(() => { const r = prev.getBoundingClientRect(); this.preview.resize(r.width, r.height); });
    } else if (type === 'crafting') {
      panel.append(el('div', 'ptitle', 'Crafting'));
      const row = el('div', 'row'); row.style.gap = 'calc(8px * var(--s))'; row.style.padding = `0 calc(22px * var(--s))`;
      this.arrow = el('div', 'arrow-ico');
      row.append(this.grid(3, this.range(1, 9)), this.arrow, this.slot(0, 'big'));
      panel.append(row, this.playerInvSection(10, 37));
    } else if (type === 'chest') {
      panel.append(el('div', 'ptitle', 'Chest'), this.grid(9, this.range(0, 26)), this.playerInvSection(27, 54));
    } else if (type === 'furnace') {
      panel.append(el('div', 'ptitle', 'Furnace'));
      const row = el('div', 'row'); row.style.gap = 'calc(10px * var(--s))'; row.style.padding = `calc(2px * var(--s)) calc(30px * var(--s))`;
      const left = el('div', 'col'); left.style.gap = 'calc(2px * var(--s))';
      this.flame = el('div', 'flame-ico'); this.flameFill = el('div', 'fill'); this.flame.appendChild(this.flameFill);
      left.append(this.slot(0), this.flame, this.slot(1, '', 'coal'));
      this.arrow = el('div', 'arrow-ico'); this.arrowFill = el('div', 'fill'); this.arrow.appendChild(this.arrowFill);
      row.append(left, this.arrow, this.slot(2, 'big'));
      panel.append(row, this.playerInvSection(3, 30));
    }
    root.appendChild(panel);
    this.panel = panel;
  }

  buildCreative(root) {
    const wrap = el('div', 'col');
    wrap.style.gap = '0';
    wrap.style.alignItems = 'flex-start';
    const tabs = el('div', 'tabs');
    const tabDefs = [...CREATIVE_TABS, { id: 'search', name: 'Search Items', icon: 'paper' }, { id: 'inventory', name: 'Survival Inventory', icon: 'chest' }];
    for (const t of tabDefs) {
      const b = el('div', 'tab' + (t.id === this.creativeTab ? ' active' : ''));
      b.tabIndex = 0;
      b.title = t.name;
      const img = el('img'); img.src = getIconURL(t.icon);
      b.appendChild(img);
      const go = () => { this.creativeTab = t.id; this.open('creative'); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      tabs.appendChild(b);
    }
    const panel = el('div', 'panel');
    const tabDef = tabDefs.find((t) => t.id === this.creativeTab);
    const head = el('div', 'row');
    head.style.justifyContent = 'space-between';
    head.append(el('div', 'ptitle', tabDef.name));
    if (this.creativeTab === 'search') {
      const s = el('input', 'search');
      s.value = this.search;
      s.placeholder = 'Search...';
      s.spellcheck = false;
      s.addEventListener('input', () => { this.search = s.value; this.fillPalette(); });
      s.addEventListener('keydown', (e) => e.stopPropagation());
      head.append(s);
      setTimeout(() => s.focus(), 0);
    }
    panel.append(head);
    if (this.creativeTab === 'inventory') {
      const top = el('div', 'row'); top.style.alignItems = 'flex-start'; top.style.justifyContent = 'flex-start';
      const armor = el('div', 'col'); armor.style.gap = '0';
      for (let i = 0; i < 4; i++) armor.appendChild(this.slot(5 + i, '', ['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots'][i]));
      const prev = el('div', 'preview');
      this.preview = new PlayerPreview(this.app, this.game.name, this.app.options.get('skin'));
      prev.appendChild(this.preview.canvas);
      requestAnimationFrame(() => { const r = prev.getBoundingClientRect(); this.preview.resize(r.width, r.height); });
      top.append(armor, prev, this.slot(45, '', 'shears'));
      panel.append(top, this.grid(9, this.range(9, 35)));
    } else {
      this.palette = el('div', 'creative-grid');
      panel.append(this.palette);
      this.fillPalette();
    }
    const bottom = el('div', 'row');
    bottom.style.marginTop = 'calc(4px * var(--s))';
    bottom.style.gap = 'calc(4px * var(--s))';
    bottom.append(this.grid(9, this.range(36, 44)));
    const trash = el('div', 'slot trash', 'X');
    trash.title = 'Destroy Item (shift-click: clear inventory)';
    trash.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.shiftKey) { this.game.creative({ act: 'clear' }); for (const a of [this.game.inv.main, this.game.inv.armor, this.game.inv.offhand]) a.fill(null); this.game.cursor = null; }
      else { this.game.creative({ act: 'trash' }); this.game.cursor = null; }
      this.app.audio.play('click');
      this.refresh();
    });
    bottom.append(trash);
    panel.append(bottom);
    wrap.append(tabs, panel);
    root.appendChild(wrap);
    this.panel = panel;
  }

  paletteItems() {
    if (this.creativeTab === 'search') {
      const q = this.search.trim().toLowerCase();
      return ITEM_LIST.filter((it) => !q || it.display.toLowerCase().includes(q) || it.id.includes(q));
    }
    return ITEM_LIST.filter((it) => it.tab === this.creativeTab);
  }

  fillPalette() {
    if (!this.palette) return;
    this.palette.innerHTML = '';
    for (const it of this.paletteItems()) {
      const s = el('div', 'slot');
      const img = el('img'); img.src = getIconURL(it.id);
      s.appendChild(img);
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const g = this.game;
        if (g.cursor) { g.creative({ act: 'trash' }); g.cursor = null; this.refresh(); return; }
        const count = e.button === 2 ? 1 : maxStackOf(it.id);
        if (e.shiftKey) {
          let idx = g.inv.main.findIndex((x, i) => i < 9 && !x);
          if (idx < 0) idx = g.inv.selected;
          g.inv.main[idx] = { id: it.id, count };
          g.creative({ act: 'set', area: 'main', i: idx, item: [it.id, count, 0] });
        } else {
          g.cursor = { id: it.id, count };
          g.creative({ act: 'cursor', item: [it.id, count, 0] });
        }
        this.app.audio.play('click');
        this.refresh();
      });
      s.addEventListener('mouseenter', () => { this.hoverItem = { id: it.id, count: 1 }; this.updateTooltip(); });
      s.addEventListener('mouseleave', () => { this.hoverItem = null; this.updateTooltip(); });
      this.palette.appendChild(s);
    }
  }

  // ---------- interaction ----------
  winSlot(index) { const w = this.game.activeWindow(); return w.slots[index]; }

  slotDown(e, index) {
    e.preventDefault();
    e.stopPropagation();
    const g = this.game;
    const button = e.button === 2 ? 1 : e.button === 0 ? 0 : -1;
    if (button < 0) return;
    const now = performance.now();
    if (e.shiftKey) { g.windowAction({ a: 'click', slot: index, button, shift: true }); this.lastClick = { slot: index, time: now }; return; }
    if (button === 0 && this.lastClick.slot === index && now - this.lastClick.time < 260 && g.cursor) {
      g.windowAction({ a: 'dbl', slot: index });
      this.lastClick = { slot: -1, time: 0 };
      return;
    }
    this.lastClick = { slot: index, time: now };
    if (!g.cursor) { g.windowAction({ a: 'click', slot: index, button, shift: false }); return; }
    this.drag = { button, slots: [index] };
  }

  dragEnter(index) {
    if (!this.drag) return;
    if (!this.drag.slots.includes(index)) {
      this.drag.slots.push(index);
      const e = this.slotEls.find((s) => s.index === index);
      if (e) e.el.classList.add('hover');
    }
  }

  handleUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    const button = e.button === 2 ? 1 : 0;
    if (button !== d.button) return;
    if (d.slots.length <= 1) this.game.windowAction({ a: 'click', slot: d.slots[0], button: d.button, shift: false });
    else this.game.windowAction({ a: 'drag', slots: d.slots, button: d.button });
  }

  handleKey(e) {
    const I = this.app.input;
    const code = e.code;
    if (code === 'Escape' || (I.is(code, 'inventory') && !(e.target && e.target.tagName === 'INPUT'))) {
      e.preventDefault(); e.stopPropagation();
      this.app.ui.closeInventory(true);
      return;
    }
    if (e.target && e.target.tagName === 'INPUT') return;
    if (this.hover === null) return;
    for (let i = 1; i <= 9; i++) {
      if (I.is(code, 'hotbar' + i)) { e.preventDefault(); e.stopPropagation(); this.game.windowAction({ a: 'swap', slot: this.hover, hotbar: i - 1 }); return; }
    }
    if (I.is(code, 'drop')) { e.preventDefault(); e.stopPropagation(); this.game.windowAction({ a: 'drop', slot: this.hover, all: e.ctrlKey || e.metaKey }); return; }
    if (I.is(code, 'swapHands')) { e.preventDefault(); e.stopPropagation(); this.game.windowAction({ a: 'swap', slot: this.hover, hotbar: 'offhand' }); }
  }

  // ---------- rendering ----------
  fillSlot(elm, stack) {
    for (const c of [...elm.children]) if (!c.classList.contains('ghost')) c.remove();
    if (elm.ghost) elm.ghost.style.display = stack ? 'none' : '';
    if (!stack) return;
    const img = el('img'); img.src = getIconURL(stack.id);
    elm.appendChild(img);
    const it = ITEMS[stack.id];
    if (it && it.durability && stack.dmg) {
      const k = Math.max(0, 1 - stack.dmg / it.durability);
      const bar = el('div', 'dur'); const f = el('div'); f.style.width = (k * 100) + '%'; f.style.background = `hsl(${Math.round(k * 120)},100%,50%)`; bar.appendChild(f);
      elm.appendChild(bar);
    }
    if (stack.count > 1) elm.appendChild(el('div', 'count', String(stack.count)));
  }

  refresh() {
    if (!this.root || !this.game) return;
    const win = this.game.activeWindow();
    for (const { el: e, index } of this.slotEls) {
      const s = win.slots[index];
      this.fillSlot(e, s ? s.arr[s.i] : null);
      if (!this.drag || !this.drag.slots.includes(index)) { if (this.hover !== index) e.classList.remove('hover'); }
    }
    // cursor
    this.cursorEl.innerHTML = '';
    const c = this.game.cursor;
    if (c) {
      const img = el('img'); img.src = getIconURL(c.id);
      this.cursorEl.appendChild(img);
      if (c.count > 1) this.cursorEl.appendChild(el('div', 'count', String(c.count)));
    }
    this.cursorEl.style.display = c ? '' : 'none';
    // furnace progress
    if (this.type === 'furnace' && this.game.window && this.game.window.container) {
      const ct = this.game.window.container;
      this.flameFill.style.height = (ct.burnMax ? Math.min(100, (ct.burn / ct.burnMax) * 100) : 0) + '%';
      this.arrowFill.style.width = `calc(${(ct.cook / (ct.cookMax || 200)) * 22}px * var(--s))`;
    }
    this.positionFloating();
    this.updateTooltip();
  }

  positionFloating() {
    this.cursorEl.style.left = this.mouse.x + 'px';
    this.cursorEl.style.top = this.mouse.y + 'px';
    const t = this.tooltip;
    t.style.left = (this.mouse.x + 14) + 'px';
    t.style.top = (this.mouse.y - 18) + 'px';
  }

  updateTooltip() {
    let stack = null;
    if (this.hover !== null && this.game) { const s = this.winSlot(this.hover); stack = s ? s.arr[s.i] : null; }
    if (!stack && this.hoverItem) stack = this.hoverItem;
    if (!stack || (this.game && this.game.cursor)) { this.tooltip.style.display = 'none'; return; }
    const it = ITEMS[stack.id];
    if (!it) { this.tooltip.style.display = 'none'; return; }
    const lines = [`<div>${it.display}</div>`];
    if (it.tool) {
      lines.push(`<div class="sub">When in Main Hand:</div><div class="blue"> ${it.tool.damage} Attack Damage</div><div class="blue"> ${it.tool.attackSpeed} Attack Speed</div>`);
      if (it.tool.type !== 'sword' && it.tool.type !== 'shears') lines.push(`<div class="sub">Mining speed x${it.tool.speed}</div>`);
    }
    if (it.armor && !it.armor.glider) lines.push(`<div class="sub">When on ${ARMOR_NAMES[it.armor.slot]}:</div><div class="blue"> +${it.armor.points} Armor</div>`);
    if (it.armor && it.armor.glider) lines.push('<div class="sub">Equip on chest. Jump while falling to glide.</div><div class="sub">Use firework rockets to boost.</div>');
    if (it.food) lines.push(`<div class="sub">Restores ${it.food.hunger} hunger</div>`);
    if (it.durability) lines.push(`<div class="sub">Durability: ${it.durability - (stack.dmg || 0)} / ${it.durability}</div>`);
    const rec = recipesFor(stack.id);
    if (rec.length && this.type === 'creative') lines.push(`<div class="sub">${rec[0].type === 'smelting' ? 'Smelted in a furnace' : 'Craftable'}</div>`);
    this.tooltip.innerHTML = lines.join('');
    this.tooltip.style.display = '';
  }

  frame(dt) {
    if (this.preview && this.game) this.preview.render(dt, this.game.inv);
  }
}
