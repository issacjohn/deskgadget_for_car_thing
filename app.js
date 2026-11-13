/* DeskGadget for Car Thing
   Talks to the DeskGadget server on /ws and renders up to four modules:
   System and Media have dedicated layouts, the rest use a compact generic one.
   Everything is updated in place: no innerHTML churn per tick, no animation
   loop, one canvas redraw per data change. */
(function () {
  'use strict';

  var MAX_MODULES = 4;
  var SKIP = { camera: 1 };

  var params = new URLSearchParams(location.search);
  var HOST = params.get('host') ||
    (location.protocol === 'http:' ? location.hostname : '127.0.0.1');
  var PORT = params.get('port') || '8787';
  var DEVICE_ID = localStorage.getItem('dg_carthing_id');
  if (!DEVICE_ID) {
    DEVICE_ID = 'carthing-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('dg_carthing_id', DEVICE_ID);
  }

  var el = {};
  var pages = {};
  var modules = [];
  var current = localStorage.getItem('dg_carthing_view') || 'system';
  if (params.get('view')) current = params.get('view');
  var socket = null;
  var retry = 800;
  var reconnectTimer = 0;
  var lastGraph = '';
  var dragging = false;
  var volTimer = 0;
  var otherKey = '';
  var playState = null;
  var outputsKey = '';
  var capRows = [];
  var netCells = null;
  var actionIds = '';

  function $(id) { return document.getElementById(id); }

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setText(node, text) {
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  }

  function tempColor(t) {
    if (t === null || t === undefined) return '';
    if (t < 70) return 'var(--ok)';
    if (t < 85) return 'var(--warn)';
    return 'var(--hot)';
  }

  function fmtTime(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------------------- connection ---------------------------- */

  function connect() {
    try {
      socket = new WebSocket('ws://' + HOST + ':' + PORT + '/ws');
    } catch (e) {
      schedule();
      return;
    }
    socket.onopen = function () {
      retry = 800;
      setConnected(true);
      send({
        v: 1,
        type: 'hello',
        device_id: DEVICE_ID,
        device: { name: 'Car Thing', model: 'Car Thing', app: 'deskgadget-carthing' }
      });
    };
    socket.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      handle(msg);
    };
    socket.onclose = function () {
      setConnected(false);
      schedule();
    };
    socket.onerror = function () {
      try { socket.close(); } catch (e) { /* ignore */ }
    };
  }

  function schedule() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retry);
    retry = Math.min(Math.round(retry * 1.6), 8000);
  }

  function send(msg) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  function act(module, action, payload) {
    send({ v: 1, type: 'action', module: module, action: action, payload: payload || {} });
  }

  function setConnected(on) {
    if (el.conn) el.conn.className = on ? 'dot is-on' : 'dot';
  }

  setInterval(function () { send({ v: 1, type: 'ping' }); }, 20000);

  /* ------------------------------ messages ---------------------------- */

  function handle(msg) {
    if (msg.type === 'welcome' || msg.type === 'layout') {
      pages = {};
      (msg.pages || []).forEach(function (page) { pages[page.id] = page; });
      if (msg.server && msg.server.name) setText(el.server, msg.server.name);
      modules = orderModules();
      renderRail();
      if (modules.indexOf(current) < 0) current = modules[0] || 'system';
      setView(current, true);
      renderAll();
    } else if (msg.type === 'page') {
      pages[msg.module] = msg.page;
      if (msg.module === 'system') renderSystem();
      else if (msg.module === 'media') renderMedia();
      else if (msg.module === current) renderOther(current, true);
    } else if (msg.type === 'toast') {
      toast(msg.text);
    }
  }

  function orderModules() {
    var ids = Object.keys(pages).filter(function (id) { return !SKIP[id]; });
    var preferred = ['system', 'media'].filter(function (id) {
      return ids.indexOf(id) >= 0;
    });
    var others = ids.filter(function (id) { return preferred.indexOf(id) < 0; });
    return preferred.concat(others).slice(0, MAX_MODULES);
  }

  function block(page, type) {
    if (!page || !page.blocks) return null;
    for (var i = 0; i < page.blocks.length; i++) {
      if (page.blocks[i].type === type) return page.blocks[i];
    }
    return null;
  }

  function renderAll() {
    renderSystem();
    renderMedia();
    if (current !== 'system' && current !== 'media') renderOther(current, true);
  }

  /* ------------------------------- rail ------------------------------- */

  var LABELS = {
    system: 'System',
    media: 'Media',
    weather: 'Weather',
    news: 'News',
    drives: 'Drives',
    shortcuts: 'Shortcuts',
    audiomesh: 'Audio',
    clipboard: 'Clipboard',
    windows: 'Windows',
    mouse: 'Mouse'
  };

  var ICONS = {
    system: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    media: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="3"/><circle cx="16.5" cy="16" r="3"/>',
    weather: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    news: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    drives: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M7 15h2M15 15h2"/>',
    shortcuts: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    audiomesh: '<path d="M4 12h3l2-5 3 10 2-6 2 3h4"/>',
    clipboard: '<path d="M9 5h6M9 5a2 2 0 0 0-2 2v12h10V7a2 2 0 0 0-2-2"/>'
  };

  function renderRail() {
    el.rail.textContent = '';
    modules.forEach(function (id) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'rail-btn';
      button.setAttribute('data-module', id);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        (ICONS[id] || '<circle cx="12" cy="12" r="6"/>') + '</svg><span></span>';
      button.querySelector('span').textContent = LABELS[id] || id;
      button.addEventListener('click', function () { setView(id); });
      el.rail.appendChild(button);
    });
  }

  function setView(id, quiet) {
    if (modules.length && modules.indexOf(id) < 0) id = modules[0];
    current = id;
    if (!quiet) localStorage.setItem('dg_carthing_view', id);
    document.body.setAttribute('data-view', id);
    el.rail.setAttribute('data-view', id);

    var isSystem = id === 'system';
    var isMedia = id === 'media';
    el.viewSystem.className = 'view' + (isSystem ? ' is-on' : '');
    el.viewMedia.className = 'view' + (isMedia ? ' is-on' : '');
    el.viewOther.className = 'view' + (!isSystem && !isMedia ? ' is-on' : '');

    Array.prototype.forEach.call(el.rail.children, function (button) {
      button.classList.toggle('is-on', button.getAttribute('data-module') === id);
    });

    if (!isSystem && !isMedia) renderOther(id, true);
  }

  function stepView(delta) {
    if (!modules.length) return;
    var index = modules.indexOf(current);
    index = (index + delta + modules.length) % modules.length;
    setView(modules[index]);
  }

  /* ------------------------------- system ----------------------------- */

  function renderSystem() {
    var page = pages.system;
    if (!page) return;

    var cpu = block(page, 'cpu');
    if (cpu) {
      setText(el.cpuUtil, (cpu.value || 0) + '%');
      setText(el.cpuThreads, (cpu.threads || '—') + ' threads');
      var temp = (cpu.temp === null || cpu.temp === undefined) ? null : cpu.temp;
      setText(el.cpuTemp, temp === null ? '—' : temp + '\u00b0C');
      el.cpuTemp.style.color = tempColor(temp);
      drawGraph(cpu.points || [], cpu.min || 0, cpu.max || 100);
    }

    var storage = block(page, 'storage');
    if (storage) renderCapacity(storage.items || []);

    var gpu = block(page, 'gpu');
    if (gpu) {
      var gt = (gpu.temp === null || gpu.temp === undefined) ? null : gpu.temp;
      setText(el.gpuTemp, gt === null ? '—' : gt + '\u00b0');
      el.gpuTemp.style.color = tempColor(gt);
      setText(el.gpuName, gpu.name || '');
      el.gpuMarker.style.left = 'calc(' + Math.max(0, Math.min(100, gt || 0)) + '% - 2px)';
      renderNet(gpu.net || []);
    }

    var kv = block(page, 'kv');
    if (kv) {
      (kv.items || []).forEach(function (item) {
        var label = (item.label || '').toLowerCase();
        if (label === 'power') setText(el.power, item.value);
        if (label === 'uptime') setText(el.uptime, item.value);
        if (label.indexOf('lan') === 0) setText(el.lan, item.value);
        if (label.indexOf('public') === 0) setText(el.pub, item.value);
      });
    }

    var controls = block(page, 'controls');
    if (controls) renderActions(controls.items || []);
  }

  function renderCapacity(items) {
    if (capRows.length !== items.length) {
      el.capList.textContent = '';
      capRows = items.map(function () {
        var row = h('div', 'cap-row');
        var top = h('div', 'cap-top');
        var k = h('span', 'cap-k');
        var pct = h('b');
        top.appendChild(k);
        top.appendChild(pct);
        var track = h('div', 'cap-track');
        var fill = h('div', 'cap-fill');
        track.appendChild(fill);
        var note = h('div', 'cap-note');
        row.appendChild(top);
        row.appendChild(track);
        row.appendChild(note);
        el.capList.appendChild(row);
        return { k: k, pct: pct, fill: fill, note: note };
      });
    }
    items.forEach(function (item, i) {
      var row = capRows[i];
      if (!row) return;
      setText(row.k, (item.label || '').toUpperCase());
      setText(row.pct, (item.value || 0) + '%');
      row.fill.style.width = Math.max(0, Math.min(100, item.value || 0)) + '%';
      row.fill.style.background = item.value >= 90 ? 'var(--warn)' : 'var(--accent)';
      setText(row.note, item.used + ' of ' + item.total + ' \u00b7 ' + item.free + ' free');
    });
  }

  function renderNet(items) {
    if (!netCells || netCells.length !== items.length) {
      el.net.textContent = '';
      netCells = items.map(function () {
        var cell = h('div');
        var label = h('span');
        var value = h('b');
        cell.appendChild(label);
        cell.appendChild(value);
        el.net.appendChild(cell);
        return { label: label, value: value };
      });
    }
    items.forEach(function (item, i) {
      setText(netCells[i].label, (item.label || '').toUpperCase());
      setText(netCells[i].value, item.value);
    });
  }

  function renderActions(items) {
    var ids = items.map(function (item) { return item.id; }).join(',');
    if (ids === actionIds) return;
    actionIds = ids;
    el.actions.textContent = '';
    items.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = actionIcon(item.id) + '<span></span>';
      button.querySelector('span').textContent = item.label;
      button.addEventListener('click', function () { act('system', item.id); });
      el.actions.appendChild(button);
    });
  }

  function actionIcon(id) {
    var icons = {
      lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
      monitor_off: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
      show_desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M3 9h18"/></svg>',
      screenshot: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v10H4z"/><circle cx="12" cy="13" r="3"/></svg>'
    };
    return icons[id] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>';
  }

  function drawGraph(points, min, max) {
    var canvas = el.graph;
    if (!canvas || points.length < 2) return;
    var key = points.join(',');
    if (key === lastGraph) return;
    lastGraph = key;

    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var range = Math.max(1, max - min);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(124,231,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    var step = w / (points.length - 1);
    ctx.beginPath();
    for (var i = 0; i < points.length; i++) {
      var x = i * step;
      var y = h - ((points[i] - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7ce7ff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.fillStyle = 'rgba(124,231,255,0.12)';
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  }

  /* -------------------------------- media ----------------------------- */

  function renderMedia() {
    var page = pages.media;
    if (!page) return;

    var now = block(page, 'nowplaying');
    if (now) {
      setText(el.mTitle, now.title || 'Nothing playing');
      setText(el.mArtist, now.artist || now.source || '');
      setText(el.mSource, (now.source || '').toUpperCase());
      var duration = now.duration || 0;
      var position = now.position || 0;
      var pct = duration > 0 ? Math.min(1, position / duration) : 0;
      el.mFill.style.width = (pct * 100) + '%';
      setText(el.mPos, fmtTime(position));
      setText(el.mDur, fmtTime(duration));
      el.mSeek.setAttribute('data-duration', String(duration));
      setPlayIcon(!!now.playing);
    } else {
      setText(el.mTitle, 'Nothing playing');
      setText(el.mArtist, 'Start something on the PC');
      setText(el.mSource, '');
      el.mFill.style.width = '0%';
      setText(el.mPos, '0:00');
      setText(el.mDur, '0:00');
      el.mSeek.setAttribute('data-duration', '0');
      setPlayIcon(false);
    }

    var hero = block(page, 'hero');
    if (hero && hero.slider) {
      var value = Math.round(hero.slider.value || 0);
      if (!dragging) {
        el.vol.value = String(value);
        setText(el.volVal, hero.value === 'MUTED' ? 'MUTED' : value + '%');
      }
    }

    var toggles = block(page, 'toggles');
    renderOutputs(toggles ? toggles.items || [] : []);
  }

  function setPlayIcon(playing) {
    if (playState === playing) return;
    playState = playing;
    el.playIcon.innerHTML = playing
      ? '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/>'
      : '<path d="M8 5l11 7-11 7z"/>';
  }

  function renderOutputs(items) {
    var key = items.map(function (item) { return item.id + ':' + item.on; }).join('|');
    if (key === outputsKey) return;
    outputsKey = key;
    el.outputs.textContent = '';
    if (!items.length) {
      el.outputs.appendChild(h('div', 'empty', 'No outputs reported'));
      return;
    }
    items.forEach(function (item) {
      var chip = h('button', 'chip' + (item.on ? ' is-on' : ''), item.label);
      chip.type = 'button';
      chip.addEventListener('click', function () {
        act('media', 'toggle_endpoint', { id: item.id });
      });
      el.outputs.appendChild(chip);
    });
  }

  function seek(event) {
    var duration = parseFloat(el.mSeek.getAttribute('data-duration') || '0');
    if (!duration) return;
    var track = el.mSeek.querySelector('.seek-track');
    var rect = track.getBoundingClientRect();
    var fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    act('media', 'seek', { value: Math.round(fraction * duration) });
  }

  /* ---------------------------- other modules ------------------------- */

  function renderOther(id, force) {
    var page = pages[id];
    if (!page) return;
    var key = id + '|' + JSON.stringify(page);
    if (!force && key === otherKey) return;
    otherKey = key;

    var body = el.other;
    body.textContent = '';

    var card = h('article', 'card');
    var head = h('div', 'other-head');
    head.appendChild(h('span', null, (LABELS[id] || id).toUpperCase()));
    head.appendChild(h('span', null, page.title || ''));
    card.appendChild(head);

    var scroll = h('div', 'other-scroll');
    card.appendChild(scroll);
    body.appendChild(card);

    (page.blocks || []).forEach(function (item) {
      renderBlock(id, scroll, item);
    });

    if (!page.blocks || !page.blocks.length) {
      scroll.appendChild(h('div', 'other-empty', 'Nothing to show yet'));
    }

    Array.prototype.forEach.call(scroll.querySelectorAll('input[type=range]'), function (input) {
      input.addEventListener('input', function () {
        var action = input.getAttribute('data-action');
        if (action) act(input.getAttribute('data-module'), action, { value: parseInt(input.value, 10) });
      });
    });
  }

  function renderBlock(moduleId, parent, item) {
    if (!item) return;
    if (item.type === 'hero') return heroBlock(moduleId, parent, item);
    if (item.type === 'slider') return sliderBlock(moduleId, parent, item);
    if (item.type === 'kv') return kvBlock(parent, item.items || []);
    if (item.type === 'gauges') return gaugesBlock(parent, item.items || []);
    if (item.type === 'meters') return metersBlock(parent, item.items || []);
    if (item.type === 'list') return listBlock(moduleId, parent, item);
    if (item.type === 'news') return newsBlock(moduleId, parent, item);
    if (item.type === 'controls') return controlsBlock(moduleId, parent, item);
    if (item.type === 'toggles') return togglesBlock(moduleId, parent, item);
    if (item.type === 'hours') return hoursBlock(parent, item.items || []);
    if (item.type === 'shortcuts') return shortcutsBlock(moduleId, parent, item);
  }

  function section(parent, title) {
    var wrap = h('section', 'sect');
    if (title) wrap.appendChild(h('h3', null, title));
    parent.appendChild(wrap);
    return wrap;
  }

  function heroBlock(moduleId, parent, item) {
    var wrap = section(parent, item.label);
    var line = h('div', 'hero-line');
    line.appendChild(h('b', null, item.value));
    if (item.unit) line.appendChild(h('i', null, item.unit));
    wrap.appendChild(line);
    if (item.sub) wrap.appendChild(h('div', 'hero-sub', item.sub));
    if (item.stats && item.stats.length) {
      var grid = h('div', 'grid3');
      item.stats.forEach(function (stat) {
        var cell = h('div', 'kv');
        cell.appendChild(h('span', null, stat.label));
        cell.appendChild(h('b', null, stat.value));
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
    }
  }

  function sliderBlock(moduleId, parent, item) {
    var wrap = section(parent, item.label);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = item.min || 0;
    input.max = item.max || 100;
    input.value = item.value || 0;
    input.className = 'other-slider';
    input.setAttribute('data-action', item.action || '');
    input.setAttribute('data-module', moduleId);
    wrap.appendChild(input);
  }

  function kvBlock(parent, items) {
    if (!items.length) return;
    var grid = h('div', 'grid2');
    items.forEach(function (item) {
      var cell = h('div', 'kv');
      cell.appendChild(h('span', null, item.label));
      cell.appendChild(h('b', null, item.value));
      grid.appendChild(cell);
    });
    parent.appendChild(grid);
  }

  function gaugesBlock(parent, items) {
    if (!items.length) return;
    var grid = h('div', 'grid3');
    items.forEach(function (item) {
      var cell = h('div', 'gauge');
      cell.appendChild(h('b', null, item.value + (item.suffix || '')));
      cell.appendChild(h('span', null, item.label));
      grid.appendChild(cell);
    });
    parent.appendChild(grid);
  }

  function metersBlock(parent, items) {
    var wrap = section(parent, null);
    items.forEach(function (item) {
      var row = h('div', 'meter');
      var top = h('div', 'meter-top');
      top.appendChild(h('span', null, item.label));
      top.appendChild(h('b', null, (item.value || 0) + '%'));
      row.appendChild(top);
      var track = h('div', 'meter-track');
      var fill = h('i');
      fill.style.width = Math.max(0, Math.min(100, item.value || 0)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
  }

  function listBlock(moduleId, parent, item) {
    if (!item.items || !item.items.length) return;
    var wrap = section(parent, item.title);
    var rows = h('div', 'rows');
    item.items.forEach(function (entry) {
      var row = h('div', 'row');
      var text = h('div', 'row-text');
      text.appendChild(h('b', null, entry.title || entry.label || ''));
      if (entry.sub) text.appendChild(h('span', null, entry.sub));
      row.appendChild(text);
      if (entry.value) row.appendChild(h('b', null, entry.value));
      if (entry.action) {
        row.setAttribute('data-act', entry.action);
        if (entry.id) row.setAttribute('data-id', entry.id);
        row.style.cursor = 'pointer';
      }
      rows.appendChild(row);
    });
    wrap.appendChild(rows);
  }

  function newsBlock(moduleId, parent, item) {
    if (!item.items || !item.items.length) return;
    var wrap = section(parent, item.title);
    var rows = h('div', 'rows');
    item.items.slice(0, 6).forEach(function (entry) {
      var row = h('div', 'row');
      var text = h('div', 'row-text');
      text.appendChild(h('b', null, entry.title || ''));
      text.appendChild(h('span', null, (entry.source || '') + (entry.ago ? ' \u00b7 ' + entry.ago : '')));
      row.appendChild(text);
      row.setAttribute('data-act', entry.action || 'open');
      if (entry.url) row.setAttribute('data-url', entry.url);
      rows.appendChild(row);
    });
    wrap.appendChild(rows);
  }

  function controlsBlock(moduleId, parent, item) {
    if (!item.items || !item.items.length) return;
    var wrap = section(parent, item.title);
    var grid = h('div', 'btns');
    item.items.forEach(function (entry) {
      var button = h('button', null, entry.label || entry.id);
      button.type = 'button';
      button.setAttribute('data-act', entry.id);
      grid.appendChild(button);
    });
    wrap.appendChild(grid);
  }

  function togglesBlock(moduleId, parent, item) {
    if (!item.items || !item.items.length) return;
    var wrap = section(parent, item.title);
    var chips = h('div', 'chips');
    item.items.forEach(function (entry) {
      var chip = h('button', 'chip' + (entry.on ? ' is-on' : ' is-off'), entry.label);
      chip.type = 'button';
      chip.setAttribute('data-act', item.action || 'toggle_endpoint');
      chip.setAttribute('data-id', entry.id);
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
  }

  function hoursBlock(parent, items) {
    if (!items.length) return;
    var wrap = section(parent, null);
    var line = h('div', 'hours');
    items.forEach(function (entry) {
      var cell = h('div');
      cell.appendChild(h('span', null, entry.label || entry.hour || ''));
      cell.appendChild(h('b', null, entry.value || entry.temp || ''));
      line.appendChild(cell);
    });
    wrap.appendChild(line);
  }

  function shortcutsBlock(moduleId, parent, item) {
    if (!item.items || !item.items.length) return;
    var wrap = section(parent, item.title);
    var grid = h('div', 'btns');
    item.items.forEach(function (entry) {
      var button = h('button', null, entry.label || entry.title || '');
      button.type = 'button';
      button.setAttribute('data-act', 'launch');
      button.setAttribute('data-id', entry.id);
      grid.appendChild(button);
    });
    wrap.appendChild(grid);
  }

  /* ------------------------------- chrome ----------------------------- */

  var toastTimer = 0;

  function toast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  function tickClock() {
    var now = new Date();
    var hh = now.getHours();
    var mm = now.getMinutes();
    setText(el.clock, (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm);
  }

  /* -------------------------------- boot ------------------------------ */

  function boot() {
    el = {
      rail: $('rail'),
      viewSystem: $('view-system'),
      viewMedia: $('view-media'),
      viewOther: $('view-other'),
      other: $('other-body'),
      conn: $('conn'),
      server: $('server'),
      clock: $('clock'),
      cpuUtil: $('cpu-util'),
      cpuTemp: $('cpu-temp'),
      cpuThreads: $('cpu-threads'),
      graph: $('cpu-graph'),
      gpuTemp: $('gpu-temp'),
      gpuName: $('gpu-name'),
      gpuMarker: $('gpu-marker'),
      net: $('net'),
      power: $('power'),
      uptime: $('uptime'),
      lan: $('lan'),
      pub: $('pub'),
      capList: $('cap-list'),
      actions: $('actions'),
      mTitle: $('m-title'),
      mArtist: $('m-artist'),
      mSource: $('m-source'),
      mFill: $('m-fill'),
      mPos: $('m-pos'),
      mDur: $('m-dur'),
      mSeek: $('m-seek'),
      playIcon: $('m-play-icon'),
      vol: $('vol'),
      volVal: $('vol-val'),
      volUp: $('vol-up'),
      volDown: $('vol-down'),
      outputs: $('outputs'),
      toast: $('toast')
    };

    Array.prototype.forEach.call(document.querySelectorAll('.tbtn'), function (button) {
      button.addEventListener('click', function () {
        act('media', button.getAttribute('data-action'));
      });
    });

    el.mSeek.addEventListener('click', seek);

    el.vol.addEventListener('input', function () {
      dragging = true;
      setText(el.volVal, el.vol.value + '%');
      clearTimeout(volTimer);
      volTimer = setTimeout(function () {
        act('media', 'set_volume', { value: parseInt(el.vol.value, 10) });
        dragging = false;
      }, 120);
    });

    el.volUp.addEventListener('click', function () { act('media', 'volume_up'); });
    el.volDown.addEventListener('click', function () { act('media', 'volume_down'); });

    el.other.addEventListener('click', function (event) {
      var target = event.target;
      while (target && target !== el.other && !target.getAttribute('data-act')) {
        target = target.parentNode;
      }
      if (!target || target === el.other) return;
      var payload = {};
      var id = target.getAttribute('data-id');
      var url = target.getAttribute('data-url');
      if (id) payload.id = id;
      if (url) payload.url = url;
      act(current, target.getAttribute('data-act'), payload);
    });

    document.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key >= '1' && key <= '4') {
        var pick = modules[parseInt(key, 10) - 1];
        if (pick) { setView(pick); event.preventDefault(); }
        return;
      }
      if (key === 'Escape' || key === 'Backspace') {
        stepView(-1);
        event.preventDefault();
        return;
      }
      if (key === 'ArrowRight') { stepView(1); event.preventDefault(); return; }
      if (key === 'ArrowLeft') { stepView(-1); event.preventDefault(); return; }
      if (key === 'ArrowUp') { act('media', 'volume_up'); event.preventDefault(); return; }
      if (key === 'ArrowDown') { act('media', 'volume_down'); event.preventDefault(); return; }
      if (key === 'Enter' || key === ' ') {
        if (current === 'media') act('media', 'play_pause');
        event.preventDefault();
      }
    });

    tickClock();
    setInterval(tickClock, 20000);
    connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
