// GCT UI kit v2 — Listen, History, Me
function Player({ ep, compact }) {
  const { mobile } = useUI();
  const [playing, setPlaying] = React.useState(true);
  const [speed, setSpeed] = React.useState(1);
  const speeds = [1, 1.25, 1.5, 0.75];
  const pct = 32;
  return <div className="gct-player" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', padding: mobile ? 14 : 20, gap: mobile ? 14 : 20, boxShadow: 'var(--shadow-card)' }}>
    <button className="gct-player__play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} style={mobile ? { width: 52, height: 52 } : { width: 64, height: 64 }}><Icon name={playing ? 'pause' : 'play'} size={mobile ? 22 : 26}></Icon></button>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: mobile ? 15 : 17, lineHeight: 1.3 }}>{ep.title}</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600, marginTop: 2 }}>Phrase 8 of {ep.phrases} · <span style={{ color: 'var(--color-orange-dark)' }}>Recall — say it in German</span></div></div>
        <Btn kind="secondary" size="sm" onClick={() => setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length])} style={{ minWidth: 56 }}>{speed}×</Btn>
      </div>
      <div className="gct-player__track"><div className="gct-player__fill" style={{ width: pct + '%' }}></div><div className="gct-player__knob" style={{ left: pct + '%' }}></div></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="gct-player__time">3:58</span>
        <div style={{ display: 'flex', gap: 2 }}><IconBtn icon="back-10" label="Back 10 s"></IconBtn><IconBtn icon="fwd-10" label="Forward 10 s"></IconBtn><IconBtn icon="download" label="Download MP3"></IconBtn></div>
        <span className="gct-player__time">{ep.len}</span>
      </div>
    </div>
  </div>;
}

function ListenScreen() {
  const { mobile, go, toast, scope, openScope } = useUI();
  const D = GCT_DATA;
  const eps = D.EPISODES.filter((e) => D.inScope(e.topicId, scope));
  const sn = D.node(scope);
  const [cur0, setCur] = React.useState(null);
  const cur = eps.some((e) => e.id === cur0) ? cur0 : (eps[0] && eps[0].id);
  const [favOnly, setFavOnly] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ep = eps.find((e) => e.id === cur);
  const generate = () => { setBusy(true); setTimeout(() => { setBusy(false); toast({ tone: 'success', text: 'Episode ready · 25 phrases' }); }, 1600); };

  const make = <Card pad={mobile ? 16 : 20}>
    <Caption>New episode</Caption>
    <Row onClick={() => openScope(true)} hover style={{ padding: '12px 0', gap: 10 }}>
      <Icon name={sn && sn.kind === 'leaf' ? 'leaf' : 'folder'} size={18} style={{ color: 'var(--color-orange)' }}></Icon>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{sn ? sn.name : 'All topics'}</div><div style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>{sn ? scopePathString(scope) + (sn.kind === 'folder' ? ' · includes sub-topics' : '') : 'A mix from every track'}</div></div>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-orange-dark)' }}>Change</span>
    </Row>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 14px', borderTop: '1px solid var(--color-border)' }}><span style={{ fontWeight: 600, fontSize: 14 }}>Only favorites</span><Switch on={favOnly} onChange={setFavOnly}></Switch></div>
    <Btn kind="secondary" icon={busy ? 'refresh' : 'plus'} full disabled={busy} onClick={generate}>{busy ? 'Generating · about 40 s' : 'Generate 25 phrases'}</Btn>
  </Card>;

  const list = <Card pad={0} style={{ overflow: 'hidden' }}>
    <div style={{ padding: '16px 18px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><Caption>Episodes · {eps.length}</Caption><span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>kept 7 days</span></div>
    {eps.length === 0 && <div style={{ padding: '8px 18px 18px', fontSize: 14, color: 'var(--fg-muted)', fontWeight: 600 }}>No episodes for this topic yet.</div>}
    {eps.map((e) => { const on = e.id === cur; return <Row key={e.id} onClick={() => setCur(e.id)} style={{ padding: '12px 18px', background: on ? 'var(--color-orange-tint)' : undefined, borderTop: '1px solid var(--color-border)' }}>
      <span style={{ color: on ? 'var(--color-orange-dark)' : 'var(--fg-muted)' }}><Icon name={on ? 'sound' : 'play'} size={18}></Icon></span>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14, color: on ? 'var(--color-orange-dark)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div><div style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>{e.when} · {e.phrases} phrases · {e.len}</div></div>
      {e.isNew && <Badge tone="info" dot>New</Badge>}
    </Row>; })}
  </Card>;

  const feed = <Row onClick={() => go('me')} style={{ borderRadius: 10, fontSize: 14, fontWeight: 600, color: 'var(--fg-secondary)' }}><Icon name="rss" size={18} style={{ color: 'var(--color-orange)' }}></Icon>Get episodes in your podcast app<div style={{ flex: 1 }}></div><Icon name="chevron-right" size={16}></Icon></Row>;

  const how = <div style={{ fontSize: 14, color: 'var(--fg-secondary)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px' }}>
    <div><b style={{ color: 'var(--fg-primary)' }}>Listen</b> — English, then German twice.</div><div><b style={{ color: 'var(--fg-primary)' }}>Recall</b> — English, a pause to say it yourself, then the answer.</div></div>;

  const transcript = <details className="gct-card" style={{ padding: '14px 18px' }}><summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>Transcript</summary>
    <ol style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}><li>Guten Tag, ich heiße … und komme aus …</li><li>Ich wohne seit drei Jahren in Berlin.</li><li>Darf ich Sie fragen, woher Sie kommen?</li></ol></details>;

  const player = ep ? <Player ep={ep}></Player> : <Card pad={mobile ? 18 : 24} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-orange-tint)', color: 'var(--color-orange-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="listen" size={24}></Icon></span>
    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 17 }}>Nothing to play for {sn ? D.short(sn) : 'this topic'}</div><div style={{ fontSize: 14, color: 'var(--fg-secondary)' }}>Generate 25 phrases from it — about 40 s.</div></div>
    <Btn kind="primary" icon="plus" onClick={generate}>Generate</Btn>
  </Card>;

  return <div>
    <PageHead title="Listen" sub="Phrase drills for when you can't look at the screen"></PageHead>
    <ScopeNote what="Episodes"></ScopeNote>
    {mobile ? <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{player}{list}{make}{feed}</div>
      : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{player}{how}{ep && transcript}{list}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{make}{feed}</div>
      </div>}
  </div>;
}

function HistoryScreen() {
  const { mobile, toast, scope } = useUI();
  const D = GCT_DATA;
  const st = D.scopeStats(scope);
  const [filter, setFilter] = React.useState('due');
  const [sort, setSort] = React.useState('timing');
  const [rows0, setRows] = React.useState(D.HISTORY);
  const rows = rows0.filter((r) => D.inScope(r.topicId, scope));
  const counts = { due: st.due, training: rows.filter((r) => /^in /.test(r.status)).length, fav: rows.filter((r) => r.fav).length, ignored: rows.filter((r) => r.status === 'ignored').length };
  const shown = rows.filter((r) => filter === 'due' ? r.status === 'due' : filter === 'training' ? /^in /.test(r.status) : filter === 'fav' ? r.fav : r.status === 'ignored');
  const pct = (r) => Math.round((r.ok / Math.max(r.ok + r.err, 1)) * 100);
  const toggle = (i, k) => setRows(rows0.map((r, j) => j === i ? { ...r, [k]: !r[k] } : r));
  const ignore = (r) => { setRows(rows0.map((x) => x === r ? { ...x, status: x.status === 'ignored' ? 'due' : 'ignored' } : x)); toast({ text: r.status === 'ignored' ? 'Back in your reviews' : 'Hidden from future sessions', action: 'Undo' }); };
  const practiced = Math.round(57 * st.ratio) || rows.length;
  const rel = (r) => { const p = D.findPath(r.topicId); const k = scope ? p.findIndex((x) => x.id === scope) : -1; const tail = p.slice(k + 1); return (tail.length ? tail : p.slice(-1)).map(D.short).join(' › '); };

  return <div>
    <PageHead title="History" sub={`${practiced} practiced · 44% right first time`}></PageHead>
    <ScopeNote what="Sentences"></ScopeNote>
    <Card pad={mobile ? 16 : 20} style={{ marginBottom: 20 }}><Caption style={{ marginBottom: 14 }}>Upcoming reviews</Caption><Histogram data={D.UPCOMING.map((u, i) => ({ ...u, v: i === 0 ? st.due : Math.round(u.v * st.ratio) }))} height={mobile ? 44 : 64} compact={mobile}></Histogram></Card>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: mobile ? 'nowrap' : 'wrap', overflowX: mobile ? 'auto' : 'visible', margin: mobile ? '0 -16px' : 0, padding: mobile ? '2px 16px' : 0, maxWidth: mobile ? 'calc(100% + 32px)' : 'none' }}>
        <Pill active={filter === 'due'} count={counts.due} onClick={() => setFilter('due')}>Due</Pill>
        <Pill active={filter === 'training'} count={counts.training} onClick={() => setFilter('training')}>Training</Pill>
        <Pill active={filter === 'fav'} icon="star" count={counts.fav} onClick={() => setFilter('fav')}>Favorites</Pill>
        <Pill active={filter === 'ignored'} icon="eye-off" count={counts.ignored} onClick={() => setFilter('ignored')}>Ignored</Pill>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)' }}>Sort
        {[['timing', 'Next review'], ['errors', 'Errors'], ['date', 'Date']].map(([k, l]) => <button key={k} onClick={() => setSort(k)} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: 0, cursor: 'pointer', font: '700 13px/1 var(--font-sans)', background: sort === k ? 'var(--color-orange-tint)' : 'transparent', color: sort === k ? 'var(--color-orange-dark)' : 'var(--fg-secondary)' }}>{l}</button>)}
      </div>
    </div>
    <Card pad={0} style={{ overflow: 'hidden' }}>
      {shown.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontWeight: 600 }}>Nothing here yet.</div>}
      {shown.map((r, i) => { const idx = rows0.indexOf(r); const p = pct(r); return <div key={idx} style={{ padding: mobile ? '14px 14px' : '16px 20px', borderTop: i ? '1px solid var(--color-border)' : 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px 16px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4, textWrap: 'pretty' }}>{r.de}</div>
          <div style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 2 }}>{r.en}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <IconBtn icon="star" label="Favorite" pressed={r.fav} tone="fav" size={18} onClick={() => toggle(idx, 'fav')}></IconBtn>
          <IconBtn icon="eye-off" label={r.status === 'ignored' ? 'Stop ignoring' : 'Ignore'} size={18} onClick={() => ignore(r)}></IconBtn>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600, marginTop: 4 }}>
          <Badge quiet dot tone={r.status === 'due' ? 'info' : 'neutral'}>{r.status === 'due' ? 'Due now' : r.status === 'ignored' ? 'Ignored' : r.status}</Badge>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: mobile ? 200 : 420 }}>{rel(r)} · {r.date}</span>
          <div style={{ flex: 1 }}></div>
          <span title="Correct · mistakes · hints" style={{ display: 'flex', gap: 10, fontVariantNumeric: 'tabular-nums' }}><span>✓ {r.ok}</span><span>✗ {r.err}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="hint" size={13}></Icon>{r.hint}</span></span>
          <span style={{ fontWeight: 800, color: p >= 75 ? 'var(--color-success)' : p >= 40 ? 'var(--fg-secondary)' : 'var(--color-danger)', width: 40, textAlign: 'right' }}>{p}%</span>
        </div>
      </div>; })}
    </Card>
  </div>;
}

function MeScreen() {
  const { mobile, go, toast, confirm, prefs, setPrefs } = useUI();
  const u = GCT_DATA.user;
  const Section = ({ title, children }) => <div style={{ marginBottom: 22 }}><Caption style={{ margin: '0 4px 10px' }}>{title}</Caption><Card pad={0} style={{ overflow: 'hidden' }}>{children}</Card></div>;
  const Line = ({ label, sub, right, first, onClick, icon }) => <Row onClick={onClick} style={{ padding: '14px 18px', borderTop: first ? 0 : '1px solid var(--color-border)', minHeight: 56 }}>
    {icon && <Icon name={icon} size={20} style={{ color: 'var(--fg-secondary)' }}></Icon>}
    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{label}</div>{sub && <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2, fontWeight: 600 }}>{sub}</div>}</div>{right}</Row>;
  const feedUrl = 'https://gct.app/feed/7f3a9c…/podcast.xml';
  return <div style={{ maxWidth: 720 }}>
    <PageHead title={mobile ? 'Me' : 'Settings'}></PageHead>
    <Card pad={18} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
      <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-cream-strong)', color: 'var(--color-orange-900)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '800 17px/1 var(--font-sans)' }}>{u.initials}</span>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 17 }}>{u.name}</div><div style={{ fontSize: 14, color: 'var(--fg-muted)' }}>{u.email} · Google</div></div>
    </Card>
    <Section title="Practice">
      <Line first label="Speak each word" sub="Plays a word when you pick it" right={<Switch on={prefs.sound} onChange={(v) => setPrefs({ ...prefs, sound: v })}></Switch>}></Line>
      <Line label="Read the sentence when solved" right={<Switch on={prefs.autoplay} onChange={(v) => setPrefs({ ...prefs, autoplay: v })}></Switch>}></Line>
      <Line label="Start with voice input" sub="You can always toggle it on the card" right={<Switch on={prefs.voice} onChange={(v) => setPrefs({ ...prefs, voice: v })}></Switch>}></Line>
    </Section>
    <Section title="Offline">
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>120 exercises cached</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600 }}>Updated 2 h ago · results sync when you're back online</div></div>
          <Btn kind="secondary" icon="refresh" size="sm" onClick={() => toast({ tone: 'success', text: 'Offline cache updated · 120 exercises' })}>Update</Btn>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600, color: 'var(--fg-secondary)' }}><Progress value={0.86} style={{ flex: 1 }}></Progress>Audio 86%</div>
      </div>
    </Section>
    <Section title="Podcast feed">
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, color: 'var(--fg-secondary)' }}>Private feed — paste into any podcast app.</div>
        <div style={{ display: 'flex', gap: 8 }}><input className="gct-input" readOnly value={feedUrl} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, flex: 1, minWidth: 0 }}></input><Btn kind="secondary" icon="copy" onClick={() => toast({ icon: 'copy', text: 'Feed URL copied' })}>Copy</Btn></div>
        <div><Btn kind="ghost" size="sm" icon="refresh" onClick={() => confirm({ title: 'Make a new feed URL?', body: 'The old URL stops working. You will need to add the new one to your podcast app.', actions: [{ label: 'Make new URL', kind: 'danger', run: () => toast({ text: 'New feed URL ready' }) }, { label: 'Cancel', kind: 'ghost' }] })}>Regenerate URL</Btn></div>
      </div>
    </Section>
    <Section title="Account">
      {u.admin && <Line first icon="manage" label="Manage topics & system" sub="Admin" onClick={() => go('manage')} right={<Icon name="chevron-right" size={18} style={{ color: 'var(--fg-muted)' }}></Icon>}></Line>}
      <Line icon="shield" label="Privacy" onClick={() => {}} right={<Icon name="chevron-right" size={18} style={{ color: 'var(--fg-muted)' }}></Icon>}></Line>
      <Line icon="logout" label="Log out" onClick={() => {}}></Line>
    </Section>
  </div>;
}

Object.assign(window, { Player, ListenScreen, HistoryScreen, MeScreen });
