/* DeskGadget for Car Thing
   Talks to the DeskGadget server on /ws and renders only the System and Media
   modules. Everything is updated in place: no innerHTML churn per tick, no
   requestAnimationFrame loop, one canvas redraw per data change. */
(function () {
  'use strict';

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
  var view = localStorage.getItem('dg_carthing_view') === 'media' ? 'media' : 'system';
  if (params.get('view') === 'media' || params.get('view') === 'system') {
    view = params.get('view');
  }
  var socket = null;
  var retry = 800;
  var reconnectTimer = 0;
  var lastGraph = '';
  var dragging = false;
  var volTimer = 0;

  function $(id) { return document.getElementById(id); }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
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
      renderAll();
    } else if (msg.type === 'page') {
      pages[msg.module] = msg.page;
      if (msg.module === 'system') renderSystem();
      if (msg.module === 'media') renderMedia();
    } else if (msg.type === 'toast') {
      toast(msg.text);
    }
  }

  function block(page, type) {
    if (!page || !page.blocks) return null;
    for (var i = 0; i < page.blocks.length; i++) {
      if (page.blocks[i].type === type) return page.blocks[i];
    }
    return null;
  }

  /* ------------------------------- system ----------------------------- */

  function renderAll() {
    renderSystem();
    renderMedia();
  }

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

  var capRows = [];

  function renderCapacity(items) {
    var list = el.capList;
    if (capRows.length !== items.length) {
      list.innerHTML = '';
      capRows = items.map(function () {
        var row = document.createElement('div');
        row.className = 'cap-row';
        row.innerHTML =
          '<div class="cap-top"><span class="cap-k"></span><b></b></div>' +
          '<div class="cap-track"><div class="cap-fill"></div></div>' +
          '<div class="cap-note"></div>';
        list.appendChild(row);
        return {
          k: row.querySelector('.cap-k'),
          pct: row.querySelector('.cap-top b'),
          fill: row.querySelector('.cap-fill'),
          note: row.querySelector('.cap-note'),
          track: row.querySelector('.cap-track')
        };
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

  var netCells = null;

  function renderNet(items) {
    if (!netCells || netCells.length !== items.length) {
      el.net.innerHTML = '';
      netCells = items.map(function () {
        var cell = document.createElement('div');
        cell.innerHTML = '<span></span><b></b>';
        el.net.appendChild(cell);
        return { label: cell.querySelector('span'), value: cell.querySelector('b') };
      });
    }
    items.forEach(function (item, i) {
      setText(netCells[i].label, (item.label || '').toUpperCase());
      setText(netCells[i].value, item.value);
    });
  }

  var actionIds = '';

  function renderActions(items) {
    var ids = items.map(function (item) { return item.id; }).join(',');
    if (ids !== actionIds) {
      actionIds = ids;
      el.actions.innerHTML = '';
      items.forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-id', item.id);
        button.innerHTML = actionIcon(item.id) + '<span></span>';
        button.querySelector('span').textContent = item.label;
        button.addEventListener('click', function () {
          act('system', item.id);
        });
        el.actions.appendChild(button);
      });
    }
  }

  function actionIcon(id) {
    var icons = {
      lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
      monitor_off: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
      show_desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M3 9h18"/></svg>',
      screenshot: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v10H4z"/><circle cx="12" cy="13" r="3"/></svg>',
      cpu_sensor: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/><circle cx="12" cy="17" r="3"/></svg>'
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

  var outputsKey = '';
  var playState = null;

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
    el.outputs.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No outputs reported';
      el.outputs.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (item.on ? ' is-on' : '');
      chip.textContent = item.label;
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

  /* ------------------------------- chrome ----------------------------- */

  var toastTimer = 0;

  function toast(text) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  function setView(next) {
    view = next === 'media' ? 'media' : 'system';
    localStorage.setItem('dg_carthing_view', view);
    document.body.setAttribute('data-view', view);
    el.rail.setAttribute('data-view', view);
    el.viewSystem.className = 'view' + (view === 'system' ? ' is-on' : '');
    el.viewMedia.className = 'view' + (view === 'media' ? ' is-on' : '');
    document.querySelectorAll('.rail-btn').forEach(function (button) {
      button.classList.toggle('is-on', button.getAttribute('data-view') === view);
    });
  }

  function tickClock() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    setText(el.clock, (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);
  }

  /* -------------------------------- boot ------------------------------ */

  function boot() {
    el = {
      rail: $('rail'),
      viewSystem: $('view-system'),
      viewMedia: $('view-media'),
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
      outputs: $('outputs'),
      toast: $('toast')
    };

    document.querySelectorAll('.rail-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-view'));
      });
    });

    document.querySelectorAll('.tbtn').forEach(function (button) {
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

    setView(view);
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
