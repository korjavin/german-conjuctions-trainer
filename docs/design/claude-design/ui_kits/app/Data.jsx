// GCT UI kit v2 — demo data
(function () {
  let n = 0;
  const L = (name, o = {}) => ({ id: 't' + (++n), name, kind: 'leaf', total: o.t ?? 12, due: o.d ?? 0, mastery: o.m ?? 0.5, isNew: !!o.isNew, created: o.c || '19.09.2026' });
  const F = (name, children, o = {}) => {
    const total = children.reduce((s, c) => s + c.total, 0);
    const due = children.reduce((s, c) => s + c.due, 0);
    const mastery = children.length ? children.reduce((s, c) => s + c.mastery * c.total, 0) / Math.max(total, 1) : 0;
    return { id: 't' + (++n), name, kind: 'folder', children, total, due, mastery, isNew: children.some((c) => c.isNew), ...o };
  };

  const goethe = F('Goethe B1 (Berlin)', [
    F('S1. Sprechen Teil 1 — Gemeinsam planen', [
      L('S1a. Gespräch eröffnen & Aufgabe einrahmen', { d: 2, m: 0.7 }),
      L('S1b. Vorschläge machen', { d: 4, m: 0.55 }),
      L('S1c. Partner nach Meinung fragen', { m: 0.8 }),
      L('S1d. Zustimmen', { m: 0.9 }),
      L('S1e. Zweifel ausdrücken', { d: 3, m: 0.4 }),
      L('S1f. Ablehnen & Gegenvorschlag', { d: 1, m: 0.45 }),
      L('S1g. Aufgaben verteilen', { m: 0.6 }),
      L('S1h. Kompromiss finden & Plan zusammenfassen', { d: 2, m: 0.35 }),
      L('S1i. Fokus 23.09: Kochaktion — Einstieg, Wortschatz, Zusammenfassung', { d: 5, m: 0.2, c: '23.09.2026' }),
    ]),
    F('S2. Sprechen Teil 2 — Präsentation', [L('S2a. Folie 1: Thema vorstellen', { m: 0.6 }), L('S2b. Erfahrungen berichten', { d: 2, m: 0.4 }), L('S2c. Vor- und Nachteile', { m: 0.5 }), L('S2d. Abschluss & Dank', { m: 0.7 })]),
    F('S3. Sprechen Teil 3 — Über die Präsentation sprechen', [L('S3a. Rückmeldung geben', { m: 0.3 }), L('S3b. Fragen stellen', { d: 1, m: 0.25 })]),
  ]);

  const telc = F('telc B1 (Berlin) — Prüfung', [
    F('A. Sprechen', [L('A1. Kontaktaufnahme', { d: 3, m: 0.7 }), L('A2. Über ein Thema sprechen', { d: 4, m: 0.5 }), L('A3. Gemeinsam etwas planen', { d: 2, m: 0.6 })]),
    F('E. Schreiben — Brief & E-Mail', [L('E1. Einleitung & Anrede', { m: 0.8 }), L('E2. Bitten & Beschwerden', { d: 6, m: 0.35 }), L('E3. Schluss & Gruß', { m: 0.85 })]),
    F('G. Mündliche Prüfung (Teil 1–3)', [
      L('G1. Teil 1 — Kontaktaufnahme', { d: 4, m: 0.55 }),
      L('G1a. Fokus 29.09: seit + Dativ, sowohl … als auch, Reisen, Prüfungsgrund', { d: 6, m: 0.3, c: '29.09.2026' }),
      L('G1b. Fokus 02.10: Haus oder Wohnung, Söhne, in vielen Ländern gewohnt', { d: 9, m: 0.1, isNew: true, c: '02.10.2026' }),
      L('G2. Teil 2 — Gespräch über ein Thema', { d: 2, m: 0.4 }),
      L('G3. Teil 3 — Gemeinsam etwas planen', { d: 1, m: 0.5 }),
    ]),
    F('C. Meinung äußern & Sprechen', [L('C1. Ich finde, dass …', { m: 0.75 }), L('C2. Einerseits … andererseits', { d: 2, m: 0.45 })]),
  ]);

  const panorama = F('B1 Panorama', [
    F('Konjunktionen', [L('weil / da', { m: 0.9 }), L('obwohl / trotzdem', { d: 1, m: 0.7 }), L('damit / um … zu', { m: 0.8 }), L('bevor / nachdem', { m: 0.6 })]),
    F('Verb + Präposition', [L('sich freuen auf / über', { m: 0.7 }), L('warten auf', { m: 0.85 })]),
    L('Adjektivendungen', { m: 0.55 }),
  ]);
  const amt = F('Amt', [L('Arbeitslosmeldung (Agentur für Arbeit)', { m: 0.4 }), L('Anmeldung beim Bürgeramt', { m: 0.6 })]);
  const archive = F('Archive', [L('A2 Wiederholung', { m: 0.9 })], { archived: true });

  const roots = [telc, goethe, panorama, amt];

  const EXERCISES = [
    { en: 'She is going for a walk, although it is raining.', words: ['Sie', 'geht', 'spazieren', ',', 'obwohl', 'es', 'regnet', '.'] },
    { en: 'He has been learning German for ten years.', words: ['Er', 'lernt', 'seit', 'zehn', 'Jahren', 'Deutsch', '.'] },
    { en: 'We lived in many countries, for example in Vietnam.', words: ['Wir', 'haben', 'in', 'vielen', 'Ländern', 'gewohnt', ',', 'zum', 'Beispiel', 'in', 'Vietnam', '.'] },
    { en: 'I am learning German because I want to work here.', words: ['Ich', 'lerne', 'Deutsch', ',', 'weil', 'ich', 'hier', 'arbeiten', 'will', '.'] },
  ];

  const HISTORY = [
    { de: 'Er hat im Ausland viele positive Erfahrungen gemacht.', en: 'He made many positive experiences abroad.', topic: 'G1b. Fokus 02.10', date: 'Yesterday', ok: 0, err: 1, hint: 0, status: 'due', fav: false },
    { de: 'Er lernt seit zehn Jahren Deutsch.', en: 'He has been learning German for ten years.', topic: 'G1a. Fokus 29.09', date: 'Yesterday', ok: 0, err: 1, hint: 1, status: 'due', fav: true },
    { de: 'Wir sind in viele Länder gereist, zum Beispiel nach Vietnam.', en: 'We traveled to many countries, for example to Vietnam.', topic: 'G1a. Fokus 29.09', date: 'Yesterday', ok: 1, err: 1, hint: 0, status: 'due', fav: false },
    { de: 'Wollen wir zuerst die Einkaufsliste schreiben?', en: 'Shall we write the shopping list first?', topic: 'S1i. Fokus 23.09', date: '2 Oct', ok: 3, err: 0, hint: 0, status: 'in 2 d', fav: false },
    { de: 'Wie wäre es, wenn jeder etwas mitbringt?', en: 'How about everyone brings something?', topic: 'S1b. Vorschläge machen', date: '1 Oct', ok: 2, err: 1, hint: 1, status: 'in 6 h', fav: true },
    { de: 'Ich bin mir nicht sicher, ob das klappt.', en: "I'm not sure that will work.", topic: 'S1e. Zweifel ausdrücken', date: '30 Sep', ok: 1, err: 0, hint: 0, status: 'ignored', fav: false },
    { de: 'Könnten Sie mir bitte bis Freitag antworten?', en: 'Could you please reply by Friday?', topic: 'E2. Bitten & Beschwerden', date: '3 Oct', ok: 0, err: 2, hint: 1, status: 'due', fav: false },
    { de: 'Ich wohne seit drei Jahren in Berlin.', en: 'I have lived in Berlin for three years.', topic: 'G1. Teil 1', date: 'Today', ok: 2, err: 0, hint: 0, status: 'in 1 d', fav: true },
    { de: 'Meiner Meinung nach ist das Thema sehr wichtig.', en: 'In my opinion the topic is very important.', topic: 'A2. Über ein Thema sprechen', date: '4 Oct', ok: 1, err: 1, hint: 0, status: 'due', fav: false },
    { de: 'Obwohl ich müde war, bin ich zum Kurs gegangen.', en: 'Although I was tired, I went to class.', topic: 'obwohl / trotzdem', date: '28 Sep', ok: 3, err: 1, hint: 0, status: 'due', fav: false },
  ];

  const EPISODES = [
    { id: 'e1', title: 'G1. Teil 1 — Kontaktaufnahme', topic: 'G1. Teil 1', when: 'Today, 07:50', phrases: 25, len: '12:24', isNew: true },
    { id: 'e2', title: 'G. Mündliche Prüfung (Teil 1–3)', topic: 'G. Mündliche', when: 'Yesterday, 11:18', phrases: 25, len: '13:55' },
    { id: 'e3', title: 'telc B1 (Berlin) — Prüfung', topic: 'telc B1', when: 'Yesterday, 09:57', phrases: 25, len: '15:00' },
    { id: 'e4', title: 'E. Schreiben — Brief & E-Mail', topic: 'E. Schreiben', when: '6 Oct, 13:43', phrases: 25, len: '14:59' },
    { id: 'e5', title: 'S1. Sprechen Teil 1 — Gemeinsam planen', topic: 'S1. Sprechen', when: '5 Oct, 18:02', phrases: 20, len: '10:40' },
    { id: 'e6', title: 'Konjunktionen', topic: 'Konjunktionen', when: '4 Oct, 08:12', phrases: 25, len: '11:30' },
  ];

  const UPCOMING = [
    { label: 'Now', v: 57 }, { label: '<4h', v: 6 }, { label: '4–12h', v: 11 }, { label: '12–24h', v: 18 },
    { label: '1–2d', v: 24 }, { label: '2–4d', v: 9 }, { label: '4–7d', v: 14 }, { label: 'Later', v: 31 },
  ];
  const WEEK = [{ d: 'M', v: 32 }, { d: 'T', v: 18 }, { d: 'W', v: 0 }, { d: 'T', v: 41 }, { d: 'F', v: 25 }, { d: 'S', v: 12 }, { d: 'S', v: 0, today: true }];

  const VERSIONS = [
    { v: 4, when: '23.09.2026 20:14', note: 'Added Zusammenfassung phrases', current: true },
    { v: 3, when: '23.09.2026 19:02', note: 'Narrowed to Kochaktion vocabulary' },
    { v: 2, when: '23.09.2026 18:40', note: 'Initial lesson notes' },
  ];

  function findPath(id, nodes = roots, trail = []) {
    for (const node of nodes) {
      const t = [...trail, node];
      if (node.id === id) return t;
      if (node.children) { const r = findPath(id, node.children, t); if (r) return r; }
    }
    return null;
  }
  const byName = (name, nodes = [...roots, archive]) => {
    for (const x of nodes) { if (x.name.startsWith(name)) return x; if (x.children) { const r = byName(name, x.children); if (r) return r; } }
    return null;
  };

  HISTORY.forEach((r) => { r.topicId = byName(r.topic).id; });
  EPISODES.forEach((e) => { e.topicId = byName(e.topic).id; });
  const ALL_DUE = roots.reduce((s, r) => s + r.due, 0);
  const node = (id) => { const p = id && findPath(id); return p ? p[p.length - 1] : null; };
  // true when topic `id` is the scope or inside its subtree
  const inScope = (id, scopeId) => !scopeId || (findPath(id) || []).some((p) => p.id === scopeId);
  const leaves = (n) => n.kind === 'leaf' ? [n] : n.children.flatMap(leaves);
  const newestLeaf = (scopeId) => { const ls = scopeId ? leaves(node(scopeId)) : roots.flatMap(leaves); const ds = (s) => s.split('.').reverse().join(''); return ls.filter((l) => l.isNew || l.created !== '19.09.2026').sort((a, b) => ds(b.created).localeCompare(ds(a.created)))[0] || null; };
  const short = (n) => n.name.split(' — ')[0].split(' (')[0].split(':')[0];
  const scopeStats = (scopeId) => { const n = node(scopeId); const due = n ? n.due : ALL_DUE; return { due, total: n ? n.total : roots.reduce((s, r) => s + r.total, 0), ratio: due / ALL_DUE, mastery: n ? n.mastery : 0.55 }; };

  window.GCT_DATA = { ALL_DUE, node, inScope, leaves, newestLeaf, short, scopeStats, roots, archive, EXERCISES, HISTORY, EPISODES, UPCOMING, WEEK, VERSIONS, findPath, byName, user: { name: 'Ivan K.', email: 'ivan@example.com', initials: 'IK', admin: true } };
})();
