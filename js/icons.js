/* GCT icon set — Lucide-style, 24px grid, 2px stroke, round caps, currentColor.
   Static pages: <i data-icon="mic"></i> (auto-replaced). React: window.GCTIcons[name] → inner SVG markup. */
(function () {
  const P = (d) => d.split('|').map((x) => '<path d="' + x + '"/>').join('');
  const I = {
    today: '<circle cx="12" cy="12" r="4"/>' + P('M12 2v2|M12 20v2|m4.93 4.93 1.41 1.41|m17.66 17.66 1.41 1.41|M2 12h2|M20 12h2|m6.34 17.66-1.41 1.41|m19.07 4.93-1.41 1.41'),
    topics: P('m16 6 4 14|M12 6v14|M8 8v12|M4 4v16'),
    listen: P('M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3'),
    history: P('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5|M12 7v5l4 2'),
    user: P('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2') + '<circle cx="12" cy="7" r="4"/>',
    sliders: P('M21 4h-7|M10 4H3|M21 12h-9|M8 12H3|M21 20h-5|M12 20H3|M14 2v4|M8 10v4|M16 18v4'),
    search: '<circle cx="11" cy="11" r="8"/>' + P('m21 21-4.3-4.3'),
    'chevron-right': P('m9 18 6-6-6-6'),
    'chevron-down': P('m6 9 6 6 6-6'),
    'chevron-left': P('m15 18-6-6 6-6'),
    play: P('M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z'),
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    skip: P('m6 17 5-5-5-5|m13 17 5-5-5-5'),
    hint: P('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5|M9 18h6|M10 22h4'),
    sound: P('M11 5 6 9H2v6h4l5 4V5Z|M15.54 8.46a5 5 0 0 1 0 7.07|M19.07 4.93a10 10 0 0 1 0 14.14'),
    'sound-off': P('M11 5 6 9H2v6h4l5 4V5Z|m22 9-6 6|m16 9 6 6'),
    mic: P('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v3'),
    'mic-off': P('m2 2 20 20|M18.89 13.23A7.12 7.12 0 0 0 19 12v-2|M5 10v2a7 7 0 0 0 12 5|M15 9.34V5a3 3 0 0 0-5.68-1.33|M9 9v3a3 3 0 0 0 5.12 2.12|M12 19v3'),
    star: P('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z'),
    'eye-off': P('M9.88 9.88a3 3 0 1 0 4.24 4.24|M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68|M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61|m2 2 20 20'),
    check: P('M20 6 9 17l-5-5'),
    'check-circle': '<circle cx="12" cy="12" r="10"/>' + P('m9 12 2 2 4-4'),
    x: P('M18 6 6 18|m6 6 12 12'),
    'arrow-right': P('M5 12h14|m12 5 7 7-7 7'),
    retry: P('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5'),
    'back-10': P('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5'),
    'fwd-10': P('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8|M21 3v5h-5'),
    download: P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|m7 10 5 5 5-5|M12 15V3'),
    rss: P('M4 11a9 9 0 0 1 9 9|M4 4a16 16 0 0 1 16 16') + '<circle cx="5" cy="19" r="1"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/>' + P('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'),
    offline: P('M12 20h.01|M8.5 16.43a5 5 0 0 1 7 0|M5 12.86a10 10 0 0 1 5.17-2.69|M19 12.86a10 10 0 0 0-2-1.52|M2 8.82a15 15 0 0 1 4.18-2.64|M22 8.82a15 15 0 0 0-11.29-3.76|m2 2 20 20'),
    refresh: P('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16|M8 16H3v5'),
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    plus: P('M5 12h14|M12 5v14'),
    grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/>' + P('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8|M10 12h4'),
    trash: P('M3 6h18|M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6|M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2'),
    pencil: P('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'),
    folder: P('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'),
    leaf: P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v4a2 2 0 0 0 2 2h4|M16 13H8|M16 17H8|M10 9H8'),
    logout: P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9'),
    shield: P('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'),
    explain: P('M7.9 20A9 9 0 1 0 4 16.1L2 22Z|M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3|M12 17h.01'),
    clock: '<circle cx="12" cy="12" r="10"/>' + P('M12 6v6l4 2'),
    manage: P('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'),
    info: '<circle cx="12" cy="12" r="10"/>' + P('M12 16v-4|M12 8h.01'),
    alert: P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3|M12 9v4|M12 17h.01'),
    terminal: P('m4 17 6-6-6-6|M12 19h8'),
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/>' + P('M3 5v14a9 3 0 0 0 18 0V5|M3 12a9 3 0 0 0 18 0'),
    activity: P('M22 12h-4l-3 9L9 3l-3 9H2'),
  };
  window.GCTIcons = I;
  window.gctIconSvg = function (name, size, sw) {
    size = size || 20; sw = sw || 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>';
  };
  function hydrate() {
    document.querySelectorAll('i[data-icon]').forEach(function (el) {
      el.outerHTML = window.gctIconSvg(el.dataset.icon, +el.dataset.size || 20, +el.dataset.stroke || 2);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hydrate); else hydrate();
})();
