// GCT UI kit v2.1 — Today + Topics, both driven by the global topic scope
function scopePathString(scope) {
  const c = scopeCrumbs(scope);
  return c.length ? c.map((x) => x.label).join(' › ') : 'All topics';
}

function TodayScreen() {
  const { mobile, go, scope, setScope } = useUI();
  const D = GCT_DATA;
  const n = D.node(scope);
  const st = D.scopeStats(scope);
  const kids = n ? (n.children || []) : D.roots;
  const lesson = D.newestLeaf(scope);
  const lessonPath = lesson && D.findPath(lesson.id);
  const ep = D.EPISODES.find((e) => D.inScope(e.topicId, scope));
  const topicStr = scopePathString(scope);

  const hero = <Card pad={mobile ? 20 : 28} style={{ background: 'linear-gradient(160deg,#fffcf7 0%,#fff1de 100%)' }}>
    <Caption>Due now{n ? ' · ' + D.short(n) : ''}</Caption>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '10px 0 6px', flexWrap: 'wrap' }}>
      <span style={{ font: '800 64px/0.9 var(--font-sans)', color: 'var(--color-orange-dark)', letterSpacing: '-.02em' }}>{st.due}</span>
      <span style={{ fontSize: 16, color: 'var(--fg-secondary)', fontWeight: 600 }}>{st.due ? `sentences ready · about ${Math.max(1, Math.round(st.due * 0.25))} min` : 'nothing due here right now'}</span>
    </div>
    {kids.some((k) => k.due) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 22px' }}>
      {kids.filter((k) => k.due).slice(0, 4).map((k) => <button key={k.id} className="gct-pill" onClick={() => setScope(k.id)} title={'Narrow to ' + k.name} style={{ maxWidth: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{D.short(k)}</span><span className="gct-pill__count">{k.due}</span></button>)}
    </div>}
    {!kids.some((k) => k.due) && <div style={{ height: 16 }}></div>}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {st.due > 0 ? <Btn kind="primary" size="lg" iconRight="arrow-right" full={mobile} onClick={() => go('practice', { topic: topicStr })}>Review {st.due}</Btn>
        : <Btn kind="primary" size="lg" icon="play" full={mobile} onClick={() => go('practice', { topic: topicStr })}>Practice anyway</Btn>}
      {!mobile && <Btn kind="ghost" size="lg" onClick={() => go('topics')}>Browse {n ? 'inside' : 'topics'}</Btn>}
    </div>
  </Card>;

  const cont = lesson && <Card pad={mobile ? 18 : 22}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}><Caption>Latest lesson{n ? ' here' : ''}</Caption>{lesson.isNew && <Badge tone="info" dot>New</Badge>}</div>
    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, textWrap: 'pretty' }}>{lesson.name}</div>
    <div style={{ marginTop: 6 }}><Crumbs path={lessonPath.slice(0, -1).map((p) => ({ label: D.short(p) }))}></Crumbs></div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
      <Mastery value={lesson.mastery} width={mobile ? 80 : 120}></Mastery>
      <span style={{ fontSize: 13, color: 'var(--fg-secondary)', fontWeight: 600 }}>{lesson.due} due · {lesson.total} sentences</span>
      <div style={{ flex: 1 }}></div>
      <Btn kind="secondary" icon="play" onClick={() => go('practice', { topic: lessonPath.map(D.short).join(' › ') })}>Practice lesson</Btn>
    </div>
  </Card>;

  const sections = kids.length > 0 && <Card pad={mobile ? 18 : 22}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}><Caption>{n ? 'Inside this topic' : 'Your tracks'}</Caption><div style={{ fontSize: 17, fontWeight: 800, marginTop: 6 }}>{n ? n.name : 'All topics'}</div></div>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>tap to narrow</span>
    </div>
    {kids.map((s, i) => <div key={s.id} onClick={() => setScope(s.id)} className="gct-tree-row" style={{ display: 'grid', gridTemplateColumns: mobile ? 'auto minmax(0,1fr) auto' : 'auto minmax(0,1fr) 140px 44px 72px', alignItems: 'center', gap: 12, padding: '11px 8px', margin: '0 -8px', borderRadius: 8, borderTop: i ? '1px solid var(--color-border)' : 0, cursor: 'pointer' }}>
      <Icon name={s.kind === 'folder' ? 'folder' : 'leaf'} size={16} style={{ color: s.kind === 'folder' ? 'var(--color-orange)' : 'var(--fg-muted)' }}></Icon>
      <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
      {!mobile && <Mastery value={s.mastery} width={140}></Mastery>}
      {!mobile && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-secondary)', textAlign: 'right' }}>{Math.round(s.mastery * 100)}%</span>}
      <span style={{ textAlign: 'right' }}>{s.due ? <Badge tone="info" quiet dot>{s.due} due</Badge> : <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>up to date</span>}</span>
    </div>)}
  </Card>;

  const wk = D.WEEK.map((w) => ({ ...w, v: Math.round(w.v * Math.max(st.ratio, 0.15)) }));
  const max = Math.max(...wk.map((w) => w.v), 1);
  const days = wk.filter((w) => w.v).length;
  const week = <Card pad={20}>
    <Caption>This week{n ? ' · ' + D.short(n) : ''}</Caption>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, alignItems: 'end', height: 64, margin: '16px 0 8px' }}>
      {wk.map((w, i) => <div key={i} style={{ height: w.v ? Math.max(8, (w.v / max) * 64) : 6, borderRadius: 4, background: w.v ? 'var(--color-orange-bright)' : 'var(--color-cream-medium)', outline: w.today ? '2px dashed var(--color-border-strong)' : 0, outlineOffset: 2 }}></div>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', textAlign: 'center' }}>{wk.map((w, i) => <span key={i} style={{ color: w.today ? 'var(--color-orange-dark)' : undefined }}>{w.d}</span>)}</div>
    <div style={{ marginTop: 14, fontSize: 14, fontWeight: 600, color: 'var(--fg-secondary)' }}><b style={{ color: 'var(--fg-primary)' }}>{days} of 7 days</b> · {wk.reduce((s, w) => s + w.v, 0)} sentences</div>
  </Card>;

  const up = D.UPCOMING.map((u, i) => ({ ...u, v: i === 0 ? st.due : Math.round(u.v * st.ratio) }));
  const upcoming = <Card pad={20}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}><Caption>Upcoming reviews</Caption><a onClick={() => go('history')} style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>History</a></div>
    <Histogram data={up} height={56} compact></Histogram>
  </Card>;

  const listen = ep ? <Card pad={18} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <button className="gct-player__play" style={{ width: 48, height: 48, flex: 'none' }} aria-label="Play episode" onClick={() => go('listen')}><Icon name="play" size={20}></Icon></button>
    <div style={{ minWidth: 0, flex: 1 }}>
      <Caption>{ep.isNew ? 'New episode' : 'Latest episode'}</Caption>
      <div style={{ fontWeight: 800, fontSize: 15, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600 }}>{ep.phrases} phrases · {ep.len}</div>
    </div>
  </Card> : <Card pad={18} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <span style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-orange-tint)', color: 'var(--color-orange-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="listen" size={20}></Icon></span>
    <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 800, fontSize: 15 }}>No podcast for this topic yet</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600 }}>25 phrases from {n ? D.short(n) : 'all topics'}</div></div>
    <Btn kind="secondary" size="sm" onClick={() => go('listen')}>Make one</Btn>
  </Card>;

  if (mobile) return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{hero}{cont}{listen}{sections}{week}{upcoming}</div>;
  return <div>
    <PageHead title="Today" sub="Friday, 9 October · telc B1 Sprechen in 12 days"></PageHead>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{hero}{cont}{sections}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{listen}{week}{upcoming}</div>
    </div>
  </div>;
}

function TopicsScreen() {
  const { mobile, go, scope, setScope } = useUI();
  const D = GCT_DATA;
  const [q, setQ] = React.useState('');
  const node = D.node(scope);
  const crumbs = [{ label: 'All topics', id: null }, ...scopeCrumbs(scope)];

  const search = <div style={{ position: 'relative', flex: mobile ? '1 1 100%' : '0 1 320px' }}>
    <Icon name="search" size={18} style={{ position: 'absolute', left: 12, top: mobile ? 13 : 11, color: 'var(--fg-muted)' }}></Icon>
    <input className="gct-input" placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 38, minHeight: mobile ? 44 : 40 }}></input>
  </div>;

  const flat = [];
  const walk = (ns, trail) => ns.forEach((x) => { flat.push({ node: x, trail }); x.children && walk(x.children, [...trail, x]); });
  walk(D.roots, []);
  const results = q.trim() ? flat.filter((f) => f.node.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30) : null;
  const open = (x) => { setQ(''); setScope(x.id); };
  const practice = (x) => go('practice', { topic: scopePathString(x.id) });

  const NodeRow = ({ x, trail, first }) => <Row onClick={() => open(x)} style={{ borderTop: first ? 0 : '1px solid var(--color-border)', alignItems: 'flex-start', padding: mobile ? '14px 14px' : '14px 18px' }}>
    <span style={{ position: 'relative', marginTop: 2, color: x.kind === 'folder' ? 'var(--color-orange)' : 'var(--fg-muted)' }}><Icon name={x.kind === 'folder' ? 'folder' : 'leaf'} size={20}></Icon>
      {x.isNew && <span title="New" style={{ position: 'absolute', top: -2, right: -3, width: 9, height: 9, borderRadius: '50%', background: 'var(--color-orange-bright)', border: '2px solid var(--color-surface)' }}></span>}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, textWrap: 'pretty' }}>{x.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600, flexWrap: 'wrap' }}>
        {trail && trail.length > 0 && <span>{trail.map(D.short).join(' › ')}</span>}
        <span>{x.kind === 'folder' ? x.children.length + ' topics · ' : ''}{x.total} items</span>
        {mobile && <Mastery value={x.mastery} width={56}></Mastery>}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', alignSelf: 'center' }}>
      {x.due > 0 && <Badge tone="info" quiet dot>{x.due}</Badge>}
      {!mobile && <Mastery value={x.mastery} width={72}></Mastery>}
      <span onClick={(e) => { e.stopPropagation(); practice(x); }} title="Practice" style={{ display: 'flex', padding: 6, borderRadius: 8, color: 'var(--color-orange-dark)' }}><Icon name="play" size={16}></Icon></span>
      {x.kind === 'folder' && <Icon name="chevron-right" size={18} style={{ color: 'var(--fg-muted)' }}></Icon>}
    </div>
  </Row>;

  const crumbNav = <div style={{ marginBottom: 12 }}><Crumbs path={crumbs} onNav={(p) => setScope(p.id)}></Crumbs></div>;

  if (results) return <div>
    <PageHead title="Topics"></PageHead>
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>{search}</div>
    <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 10 }}>{results.length} matches · picking one makes it your topic everywhere</div>
    <Card pad={0} style={{ overflow: 'hidden' }}>{results.map((r, i) => <NodeRow key={r.node.id} x={r.node} trail={r.trail} first={i === 0}></NodeRow>)}</Card>
  </div>;

  if (!node) return <div>
    <PageHead title="Topics" sub="Pick a topic — Today, Listen and History follow it" actions={!mobile && search}></PageHead>
    {mobile && <div style={{ display: 'flex', marginBottom: 16 }}>{search}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(2,minmax(0,1fr))', gap: mobile ? 12 : 20 }}>
      {D.roots.map((r) => <div key={r.id} className="gct-card" onClick={() => open(r)} style={{ padding: mobile ? 18 : 24, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-orange-tint)', color: 'var(--color-orange-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="folder" size={20}></Icon></span>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>{r.name}</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600, marginTop: 3 }}>{r.children.length} sections · {r.total} items</div></div>
          {r.isNew && <Badge tone="info" dot>New lesson</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}><Mastery value={r.mastery} width="100%"></Mastery></div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-secondary)', width: 84, textAlign: 'right' }}>{Math.round(r.mastery * 100)}% known</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {r.due ? <Badge tone="info" dot>{r.due} due now</Badge> : <Badge tone="neutral">Up to date</Badge>}
          <Icon name="chevron-right" size={18} style={{ color: 'var(--fg-muted)' }}></Icon>
        </div>
      </div>)}
    </div>
    <Row onClick={() => {}} style={{ marginTop: 16, borderRadius: 10, color: 'var(--fg-muted)', fontSize: 14, fontWeight: 600 }}><Icon name="archive" size={18}></Icon>Archive · {D.archive.children.length} retired topic</Row>
  </div>;

  const actions = (big) => [<Btn key="p" kind="secondary" icon="listen" onClick={() => go('listen')}>{big ? 'Make podcast' : 'Podcast'}</Btn>, <Btn key="a" kind="primary" icon="play" style={mobile ? { flex: 1 } : {}} onClick={() => practice(node)}>Practice{node.kind === 'folder' ? ' all' : ''} · {node.total}</Btn>];

  if (node.kind === 'leaf') {
    const recent = D.HISTORY.filter((r) => r.topicId === node.id);
    return <div>
      {crumbNav}
      <PageHead title={node.name} sub={`${node.total} items · ${node.due} due · created ${node.created}`} actions={!mobile && actions(true)}></PageHead>
      {mobile && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{actions(false)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(3,minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
        <Card pad={16}><Caption>Due</Caption><div style={{ font: '800 28px/1 var(--font-sans)', marginTop: 8, color: 'var(--color-orange-dark)' }}>{node.due}</div></Card>
        <Card pad={16}><Caption>Known</Caption><div style={{ font: '800 28px/1 var(--font-sans)', marginTop: 8 }}>{Math.round(node.mastery * 100)}%</div><Mastery value={node.mastery} width="100%"></Mastery></Card>
        {!mobile && <Card pad={16}><Caption>Items</Caption><div style={{ font: '800 28px/1 var(--font-sans)', marginTop: 8 }}>{node.total}</div></Card>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><Caption>Recent sentences</Caption><a onClick={() => go('history')} style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>All in History</a></div>
      <Card pad={0} style={{ overflow: 'hidden' }}>{recent.length ? recent.map((r, i) => <div key={i} style={{ padding: '14px 18px', borderTop: i ? '1px solid var(--color-border)' : 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{r.de}</div><div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 2 }}>{r.en}</div></div>)
        : <div style={{ padding: 24, color: 'var(--fg-muted)', fontWeight: 600, fontSize: 14 }}>Not practiced yet. <i>Aller Anfang ist schwer</i> — every beginning is hard.</div>}</Card>
    </div>;
  }

  return <div>
    {crumbNav}
    <PageHead title={node.name} sub={`${node.children.length} topics · ${node.total} items · ${node.due} due`} actions={!mobile && actions(true)}></PageHead>
    {mobile && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{actions(false)}</div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-secondary)', marginBottom: 12, fontWeight: 600 }}><Icon name="info" size={16} style={{ color: 'var(--color-orange)' }}></Icon>This is your current topic. Practice, Listen and History include everything inside it.</div>
    <Card pad={0} style={{ overflow: 'hidden' }}>{node.children.map((x, i) => <NodeRow key={x.id} x={x} first={i === 0}></NodeRow>)}</Card>
  </div>;
}

Object.assign(window, { scopePathString, TodayScreen, TopicsScreen });
