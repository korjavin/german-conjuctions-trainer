// GCT UI kit v2 — Practice + Session summary
const GCT_TOTAL = 6;
const isPunct = (w) => /^[.,!?;:]$/.test(w);
function gctShuffle(arr, seed) { const a = arr.map((w, i) => ({ w, i })); let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const DEMOS = {
  idle: { placed: 0 },
  listening: { placed: 2, listening: true, transcript: 'Sie geht spazieren obwohl' },
  wrong: { placed: 4, wrong: 'regnet', mistakes: 1 },
  correct: { placed: 99, mistakes: 1, explain: true },
};

function PracticeScreen({ topic = 'telc B1 (Berlin) — Prüfung › G1b. Fokus 02.10', demo }) {
  const { mobile, go, confirm, prefs, setPrefs, offline } = useUI();
  const D = GCT_DATA;
  const seed = DEMOS[demo] || null;
  const [n, setN] = React.useState(seed ? 2 : 0);
  const ex = D.EXERCISES[n % D.EXERCISES.length];
  const target = ex.words;
  const bank = React.useMemo(() => gctShuffle(target.map((w, i) => ({ w, i })).filter((x) => !isPunct(x.w)).map((x) => x.w), n + 3), [n]);
  const initPlaced = () => { if (!seed) return 0; let k = 0, c = 0; while (k < target.length && (isPunct(target[k]) || c < seed.placed)) { if (!isPunct(target[k])) c++; k++; } while (k < target.length && isPunct(target[k])) k++; return k; };
  const [pos, setPos] = React.useState(initPlaced);
  const [used, setUsed] = React.useState(() => { const u = new Set(); if (seed) { const taken = target.slice(0, initPlaced()).filter((w) => !isPunct(w)); const tmp = [...taken]; bank.forEach((b, bi) => { const k = tmp.indexOf(b.w); if (k >= 0) { u.add(bi); tmp.splice(k, 1); } }); } return u; });
  const [mistakes, setMistakes] = React.useState(seed?.mistakes || 0);
  const [hints, setHints] = React.useState(0);
  const [wrong, setWrong] = React.useState(seed?.wrong ? bank.findIndex((b) => b.w === seed.wrong) : -1);
  const [hintIdx, setHintIdx] = React.useState(-1);
  const [listening, setListening] = React.useState(!!seed?.listening || (prefs.voice && !seed));
  const [explain, setExplain] = React.useState(!!seed?.explain);
  const [fav, setFav] = React.useState(false);
  const done = pos >= target.length;

  const reset = (next) => { setN(next); setPos(0); setUsed(new Set()); setMistakes(0); setHints(0); setWrong(-1); setHintIdx(-1); setExplain(false); setFav(false); };
  const next = () => { if (n + 1 >= GCT_TOTAL) go('summary', { topic }); else reset(n + 1); };
  const pick = (bi) => {
    if (done || used.has(bi)) return;
    if (bank[bi].w === target[pos]) {
      let p = pos + 1; while (p < target.length && isPunct(target[p])) p++;
      setPos(p); setUsed(new Set([...used, bi])); setWrong(-1); setHintIdx(-1);
    } else { setMistakes((m) => m + 1); setWrong(bi); setTimeout(() => setWrong(-1), 900); }
  };
  const hint = () => { const bi = bank.findIndex((b, i) => !used.has(i) && b.w === target[pos]); setHintIdx(bi); setHints((h) => h + 1); };
  const skip = () => confirm({ title: 'Skip this sentence?', body: 'Skipping keeps it in your reviews. Hiding removes it from every future session.',
    actions: [{ label: 'Skip for now', kind: 'primary', run: next }, { label: 'Never show again', kind: 'secondary', run: next }, { label: 'Cancel', kind: 'ghost' }] });
  React.useEffect(() => {
    if (mobile) return;
    const k = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (done && e.key === 'Enter') next(); const i = parseInt(e.key, 10); if (!done && i >= 1 && i <= 9) pick(i - 1); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const outcome = mistakes ? { tone: 'danger', label: mistakes === 1 ? 'With 1 mistake' : `With ${mistakes} mistakes`, next: '10 min' } : hints ? { tone: 'warning', label: 'With hints', next: '4 h' } : { tone: 'success', label: 'Perfect', next: '1 d' };
  const progress = (n + (done ? 1 : 0)) / GCT_TOTAL;
  const shortTopic = topic.split(' › ').slice(-1)[0];

  const bar = <div style={{ height: mobile ? 56 : 64, flex: 'none', display: 'flex', alignItems: 'center', gap: mobile ? 8 : 16, padding: mobile ? '0 8px 0 4px' : '0 24px' }}>
    <IconBtn icon="x" label="End session" onClick={() => go('today')}></IconBtn>
    {!mobile && <div style={{ minWidth: 0, flex: '0 1 420px' }}><Crumbs path={topic.split(' › ').map((l) => ({ label: l.split(' (')[0] }))}></Crumbs></div>}
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
      <Progress value={progress} style={{ flex: mobile ? 1 : '0 1 240px' }}></Progress>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--fg-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{n + 1} of {GCT_TOTAL}</span>
      {offline && <OfflineChip></OfflineChip>}
    </div>
  </div>;

  const answerBorder = done ? (mistakes ? 'var(--color-danger-border)' : 'var(--color-success-border)') : listening ? 'var(--color-orange-bright)' : 'var(--color-border-strong)';
  const answer = <div style={{ minHeight: mobile ? 92 : 84, padding: 12, borderRadius: 12, border: `2px ${pos === 0 && !listening ? 'dashed' : 'solid'} ${answerBorder}`, background: done && !mistakes ? 'var(--color-success-bg)' : 'var(--color-cream-soft)', display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', alignItems: 'center', boxShadow: listening && !done ? '0 0 0 4px rgba(239,134,57,.15)' : 'none' }}>
    {pos === 0 && !listening && <span style={{ color: 'var(--fg-muted)', fontSize: 15, padding: '10px 6px' }}>{mobile ? 'Tap the words in order' : 'Click words or press 1–9'}</span>}
    {target.slice(0, pos).map((w, i) => isPunct(w) ? <span key={i} style={{ fontSize: 18, fontWeight: 700, marginLeft: -4 }}>{w}</span> : <span key={i} className="gct-chip gct-chip--placed" style={{ height: 40 }}>{w}</span>)}
    {listening && !done && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 18, background: '#fff', border: '1px solid var(--color-info-border)', color: 'var(--color-orange-dark)', fontSize: 14, fontStyle: 'italic', fontWeight: 600 }}>
      <span className="gct-eq"><i></i><i></i><i></i><i></i></span>{seed?.transcript || 'Ich höre zu…'}</span>}
  </div>;

  const bankEl = !done && <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 10 : 14, justifyContent: 'center', padding: mobile ? '4px 0' : '6px 8px' }}>
    {bank.map((b, bi) => <span key={bi} onClick={() => pick(bi)} className={'gct-chip' + (used.has(bi) ? ' gct-chip--used' : '') + (wrong === bi ? ' gct-chip--wrong gct-shake' : '') + (hintIdx === bi ? ' gct-chip--hint' : '')}>
      {!mobile && bi < 9 && !used.has(bi) && <span className="gct-chip__key">{bi + 1}</span>}{b.w}</span>)}
  </div>;

  const status = <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)', minHeight: 20 }}>
    {wrong >= 0 ? <span style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="x" size={14}></Icon>“{bank[wrong].w}” doesn’t go here yet</span>
      : listening ? <span style={{ color: 'var(--color-orange-dark)' }}>Listening · or say <b>weiter</b>, <b>hinweis</b>, <b>überspringen</b></span>
      : <span>{mistakes} {mistakes === 1 ? 'mistake' : 'mistakes'} · {hints} {hints === 1 ? 'hint' : 'hints'}</span>}
  </div>;

  const pending = !done && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
    {status}
    <div style={{ display: 'flex', gap: 8 }}><Btn kind="ghost" icon="skip" onClick={skip}>Skip</Btn><Btn kind="secondary" icon="hint" onClick={hint}>Hint</Btn></div>
  </div>;

  const finished = done && <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 15, fontWeight: 600 }}>
      <Badge tone={outcome.tone} dot>{outcome.label}</Badge><span style={{ color: 'var(--fg-secondary)' }}>Next review in {outcome.next}</span>
    </div>
    {explain && <div style={{ background: 'var(--color-cream-soft)', border: '1px solid var(--color-border)', borderRadius: 12, padding: mobile ? 14 : 18, fontSize: 15, lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Icon name="explain" size={16} style={{ color: 'var(--color-orange)' }}></Icon><Caption>Why</Caption></div>
      <b>obwohl</b> starts a subordinate clause, so the conjugated verb moves to the end: <i>…, obwohl es <b>regnet</b>.</i> You picked <i>regnet</i> before <i>es</i>.
      <div style={{ marginTop: 8, color: 'var(--fg-secondary)' }}>Compare: <i>Es regnet, <b>trotzdem</b> geht sie spazieren.</i> After <b>trotzdem</b> the verb stays in second position.</div>
    </div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <IconBtn icon="star" label="Favorite" pressed={fav} tone="fav" onClick={() => setFav(!fav)}></IconBtn>
      <IconBtn icon="sound" label="Replay sentence"></IconBtn>
      {mistakes > 0 && !explain && <Btn kind="ghost" icon="explain" onClick={() => setExplain(true)}>Explain mistakes</Btn>}
      <div style={{ flex: 1 }}></div>
      <Btn kind="primary" size="lg" iconRight="arrow-right" onClick={next} style={mobile ? { flex: '1 1 100%' } : {}}>Next{!mobile && <span style={{ opacity: .7, fontWeight: 600, fontSize: 12, marginLeft: 4 }}>Enter</span>}</Btn>
    </div>
  </div>;

  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    {bar}
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '4px 12px 20px' : '12px 24px 48px' }}>
      <div className="gct-card" style={{ maxWidth: 760, margin: '0 auto', padding: mobile ? 18 : 32, display: 'flex', flexDirection: 'column', gap: mobile ? 16 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Caption>{mobile ? shortTopic.split(':')[0] : 'Build the sentence'}</Caption>
          <div style={{ display: 'flex', gap: 4 }}>
            <IconBtn icon={prefs.sound ? 'sound' : 'sound-off'} label={prefs.sound ? 'Sound on' : 'Sound off'} pressed={prefs.sound} onClick={() => setPrefs({ ...prefs, sound: !prefs.sound })} size={18}></IconBtn>
            <span style={{ position: 'relative', display: 'inline-flex' }}>{listening && <span className="gct-pulse"></span>}
              <IconBtn icon={listening ? 'mic' : 'mic-off'} label={listening ? 'Stop listening' : 'Answer by voice'} pressed={listening} onClick={() => setListening(!listening)} size={18}></IconBtn></span>
          </div>
        </div>
        <div style={{ fontSize: mobile ? 20 : 24, fontWeight: 700, lineHeight: 1.35, textWrap: 'pretty' }}>{ex.en}</div>
        {answer}
        {bankEl}
        {pending}{finished}
      </div>
    </div>
  </div>;
}

function SummaryScreen({ topic = 'telc B1 (Berlin) — Prüfung › G1b. Fokus 02.10' }) {
  const { mobile, go } = useUI();
  const res = { perfect: 4, hints: 1, mistakes: 1 }; const total = 6;
  const tiles = [['success', 'Perfect', res.perfect, 'var(--outcome-perfect)'], ['warning', 'With hints', res.hints, 'var(--outcome-hints)'], ['danger', 'With mistakes', res.mistakes, 'var(--outcome-mistakes)']];
  const missed = [{ de: 'Sie geht spazieren, obwohl es regnet.', en: 'She is going for a walk, although it is raining.', tone: 'danger', l: '1 mistake' }, { de: 'Wir haben in vielen Ländern gewohnt.', en: 'We lived in many countries.', tone: 'warning', l: '1 hint' }];
  return <div style={{ maxWidth: 760, margin: '0 auto' }}>
    <Caption style={{ marginBottom: 8 }}>Session done</Caption>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 14 : 24, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ font: `800 ${mobile ? 64 : 80}px/0.85 var(--font-sans)`, color: 'var(--color-orange-dark)', letterSpacing: '-.03em' }}>{res.perfect}<span style={{ color: 'var(--color-cream-strong)' }}>/{total}</span></span>
      <div style={{ paddingBottom: 4 }}><div style={{ fontSize: mobile ? 20 : 24, fontWeight: 800 }}>perfect on the first try</div><div style={{ fontSize: 14, color: 'var(--fg-secondary)', fontWeight: 600, marginTop: 2 }}>{topic.split(' › ').slice(-1)[0]} · 4 min 12 s</div></div>
    </div>
    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 3, margin: '22px 0 14px' }}>{tiles.map(([, , v, c], i) => v ? <div key={i} style={{ flex: v, background: c }}></div> : null)}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: mobile ? 8 : 14 }}>
      {tiles.map(([tone, l, v, c]) => <Card key={l} pad={mobile ? 14 : 18}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: c }}></span><span style={{ fontSize: mobile ? 12 : 13, fontWeight: 700, color: 'var(--fg-secondary)' }}>{l}</span></div><div style={{ font: '800 32px/1 var(--font-sans)', marginTop: 10 }}>{v}</div></Card>)}
    </div>
    <Card pad={mobile ? 16 : 20} style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ color: 'var(--color-orange)' }}><Icon name="clock" size={22}></Icon></span>
      <div style={{ flex: 1, fontSize: 15, lineHeight: 1.45 }}><b>Next reviews:</b> 1 in 10 min, 1 in 4 h, 4 tomorrow.<div style={{ color: 'var(--fg-secondary)', fontSize: 14 }}>51 more sentences are due today.</div></div>
    </Card>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 10px' }}><Caption>Worth another look</Caption><Btn kind="secondary" size="sm" icon="retry" onClick={() => go('practice', { topic })}>Retry these 2</Btn></div>
    <Card pad={0} style={{ overflow: 'hidden' }}>{missed.map((m, i) => <div key={i} style={{ padding: '14px 18px', borderTop: i ? '1px solid var(--color-border)' : 0, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{m.de}</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>{m.en}</div></div><Badge tone={m.tone} quiet dot>{m.l}</Badge></div>)}</Card>
    <Row onClick={() => go('listen')} style={{ marginTop: 12, borderRadius: 10, fontSize: 14, fontWeight: 700, color: 'var(--color-orange-dark)' }}><Icon name="listen" size={18}></Icon>Turn this lesson into a podcast for the commute<div style={{ flex: 1 }}></div><Icon name="chevron-right" size={16}></Icon></Row>
    <div style={{ display: 'flex', gap: 10, marginTop: 24, flexDirection: mobile ? 'column-reverse' : 'row', justifyContent: 'flex-end' }}>
      <Btn kind="ghost" size="lg" onClick={() => go('today')}>Back to Today</Btn>
      <Btn kind="primary" size="lg" iconRight="arrow-right" onClick={() => go('practice', { topic: 'All due' })}>Keep reviewing · 51 due</Btn>
    </div>
  </div>;
}

Object.assign(window, { PracticeScreen, SummaryScreen });
