// GCT UI kit v2 — Manage (admin)
function ManageScreen({ demo }) {
  const { mobile, go, toast, confirm } = useUI();
  const D = GCT_DATA;
  const goethe = D.roots[1], s1 = goethe.children[0];
  const [tab, setTab] = React.useState('topics');
  const [open, setOpen] = React.useState(() => new Set([goethe.id, s1.id]));
  const [sel, setSel] = React.useState(mobile && demo !== 'editor' ? null : s1.children[8].id);
  const [q, setQ] = React.useState('');
  const [menu, setMenu] = React.useState(null);
  const node = sel && D.findPath(sel);
  const cur = node && node[node.length - 1];

  const toggle = (id) => { const s = new Set(open); s.has(id) ? s.delete(id) : s.add(id); setOpen(s); };
  const rows = [];
  const walk = (ns, depth) => ns.forEach((x) => { if (!q || x.name.toLowerCase().includes(q.toLowerCase()) || x.kind === 'folder') rows.push({ x, depth }); if (x.children && (open.has(x.id) || q)) walk(x.children, depth + 1); });
  walk([...D.roots, D.archive], 0);

  const del = () => confirm({ title: 'Delete this topic?', body: 'Its prompt, version history and 12 practice records are removed. Archive instead if you might need it again.', actions: [{ label: 'Delete topic', kind: 'danger', run: () => toast({ text: 'Topic deleted', action: 'Undo' }) }, { label: 'Archive instead', kind: 'secondary', run: () => toast({ text: 'Moved to Archive' }) }, { label: 'Cancel', kind: 'ghost' }] });

  const Tree = <div className={mobile ? 'gct-tree--touch' : ''} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
    <div style={{ display: 'flex', gap: 8, padding: 12, borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ position: 'relative', flex: 1 }}><Icon name="search" size={16} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--fg-muted)' }}></Icon><input className="gct-input" placeholder="Search · Ctrl F" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32, fontSize: 14 }}></input></div>
      <select className="gct-input" style={{ width: 96, fontSize: 13 }}><option>Tree</option><option>A–Z</option><option>Newest</option></select>
      <IconBtn icon="plus" label="New root topic"></IconBtn>
    </div>
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
      {rows.map(({ x, depth }) => { const on = x.id === sel; return <div key={x.id} className="gct-tree-row" onClick={() => x.kind === 'folder' ? toggle(x.id) : setSel(x.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: mobile ? 48 : 36, padding: `0 8px 0 ${8 + depth * 18}px`, cursor: 'pointer', background: on ? 'var(--color-orange-tint)' : undefined, boxShadow: on ? 'inset 3px 0 0 var(--color-orange)' : undefined, color: x.archived ? 'var(--fg-muted)' : undefined, position: 'relative' }}>
        {depth > 0 && Array.from({ length: depth }).map((_, k) => <span key={k} style={{ position: 'absolute', left: 17 + k * 18, top: 0, bottom: 0, width: 1, background: 'var(--color-border)' }}></span>)}
        <span className="gct-grip" style={{ color: 'var(--fg-muted)', display: 'flex', width: 12, marginLeft: -4 }}><Icon name="grip" size={14}></Icon></span>
        <span style={{ width: 16, display: 'flex', color: 'var(--fg-muted)' }}>{x.kind === 'folder' && <Icon name={open.has(x.id) || q ? 'chevron-down' : 'chevron-right'} size={16}></Icon>}</span>
        <Icon name={x.archived ? 'archive' : x.kind === 'folder' ? 'folder' : 'leaf'} size={16} style={{ color: x.kind === 'folder' && !x.archived ? 'var(--color-orange)' : 'var(--fg-muted)' }}></Icon>
        <span title={x.name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: on || x.kind === 'folder' ? 700 : 500, color: on ? 'var(--color-orange-dark)' : undefined }}>{x.name}</span>
        {x.isNew && x.kind === 'leaf' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-orange-bright)', flex: 'none' }}></span>}
        {x.kind === 'folder' && <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 700 }}>{x.children.length}</span>}
        <span className="gct-row-more" onClick={(e) => { e.stopPropagation(); setMenu(menu === x.id ? null : x.id); }} style={{ display: 'flex', color: 'var(--fg-secondary)', padding: 4, borderRadius: 6 }}><Icon name="more" size={16}></Icon></span>
        {menu === x.id && <div className="gct-card" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 8, top: mobile ? 44 : 34, zIndex: 10, width: 180, padding: 4, boxShadow: 'var(--shadow-pop)' }}>
          {[['plus', 'Add child'], ['pencil', 'Rename'], ['archive', x.archived ? 'Restore' : 'Archive'], ['trash', 'Delete']].map(([ic, l]) => <Row key={l} onClick={() => { setMenu(null); l === 'Delete' ? del() : toast({ text: l + ' · ' + x.name.slice(0, 24) }); }} style={{ padding: '8px 10px', borderRadius: 6, fontSize: 14, fontWeight: 600, color: l === 'Delete' ? 'var(--color-danger)' : undefined }}><Icon name={ic} size={16}></Icon>{l}</Row>)}
        </div>}
      </div>; })}
    </div>
    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)', fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>Drag to nest or reorder · ↑↓ to move · Enter to open</div>
  </div>;

  const Editor = cur && <div style={{ padding: mobile ? 16 : 28, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
    {mobile && <button onClick={() => setSel(null)} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'none', color: 'var(--color-orange-dark)', font: '700 14px/1 var(--font-sans)', cursor: 'pointer', padding: '8px 0' }}><Icon name="chevron-left" size={18}></Icon>All topics</button>}
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}><Crumbs path={node.slice(0, -1).map((p) => ({ label: p.name.split(' — ')[0] }))}></Crumbs><div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, lineHeight: 1.3, textWrap: 'pretty' }}>{cur.name}</div>
        <div style={{ fontSize: 13, color: 'var(--fg-muted)', fontWeight: 600, marginTop: 4 }}>Created {cur.created} · {cur.total} exercises generated</div></div>
      <div style={{ display: 'flex', gap: 4 }}><IconBtn icon="archive" label="Archive"></IconBtn><IconBtn icon="trash" label="Delete" onClick={del}></IconBtn></div>
    </div>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontWeight: 700, fontSize: 13 }}>Name</span><input className="gct-input" defaultValue={cur.name}></input></label>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontWeight: 700, fontSize: 13 }}>Parent</span><select className="gct-input"><option>{node.slice(0, -1).map((p) => p.name.split(' — ')[0]).join(' › ')}</option></select>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}><span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>Recent:</span><Badge tone="neutral">G. Mündliche Prüfung</Badge><Badge tone="neutral">S2. Sprechen Teil 2</Badge></span></label>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 700, fontSize: 13 }}>Prompt</span><span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>412 / 4000</span></span>
      <textarea className="gct-input" rows={mobile ? 7 : 8} style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.55, resize: 'vertical' }} defaultValue={'Lesson 23.09 — Kochaktion. Generate B1 sentences for planning a cooking event with a partner (Goethe Sprechen Teil 1).\nUse: Wollen wir …? Wie wäre es mit …? Ich schlage vor, dass … Das ist eine gute Idee, aber …\nVocabulary: Einkaufsliste, Zutaten, mitbringen, vorbereiten, aufräumen.\nEnd with a short summary sentence: Also, wir treffen uns um …'}></textarea></label>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Btn kind="primary" onClick={() => toast({ tone: 'success', text: 'Saved · version 5' })}>Save</Btn><Btn kind="ghost">Discard</Btn><span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>Ctrl Enter saves</span></div>
    <div>
      <Caption style={{ marginBottom: 10 }}>Prompt versions</Caption>
      <Card pad={0} style={{ overflow: 'hidden' }}>{D.VERSIONS.map((v, i) => <div key={v.v} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i ? '1px solid var(--color-border)' : 0 }}>
        <span style={{ font: '800 13px/1 var(--font-sans)', color: 'var(--fg-muted)', width: 24 }}>v{v.v}</span>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{v.note}</div><div style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>{v.when}</div></div>
        {v.current ? <Badge tone="info">Current</Badge> : <Btn kind="ghost" size="sm" icon="retry" onClick={() => toast({ text: `Restored v${v.v} into the editor` })}>Restore</Btn>}
      </div>)}</Card>
    </div>
  </div>;

  const tabs = [['topics', 'Topics', 'topics'], ['obs', 'Observability', 'activity'], ['db', 'Database', 'database'], ['cli', 'CLI access', 'terminal']];
  const Other = tab === 'obs' ? <div style={{ padding: mobile ? 16 : 28, maxWidth: 820 }}><Caption style={{ marginBottom: 10 }}>Last refined prompt · 09.10.2026 07:48</Caption><pre style={{ margin: 0, padding: 18, borderRadius: 12, background: '#2b1810', color: '#ffe5c2', font: '13px/1.6 var(--font-mono)', whiteSpace: 'pre-wrap' }}>{'system: You write B1 German practice sentences…\ntopic_path: telc B1 › G. Mündliche Prüfung › G1b. Fokus 02.10\nexclude: 57 recent sentences\nmodel: server default · temperature 0.7'}</pre></div>
    : tab === 'db' ? <div style={{ padding: mobile ? 16 : 28, display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 14, maxWidth: 900 }}>{[['Topics', 162], ['Exercises', '4 812'], ['Attempts', '9 305'], ['Audio files', '2 140']].map(([l, v]) => <Card key={l} pad={18}><Caption>{l}</Caption><div style={{ font: '800 28px/1 var(--font-sans)', marginTop: 10 }}>{v}</div></Card>)}</div>
    : <div style={{ padding: mobile ? 16 : 28, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ fontSize: 15, color: 'var(--fg-secondary)' }}>A personal token lets scripts add topics and read stats. It is shown once.</div><div><Btn kind="primary" icon="terminal" onClick={() => toast({ text: 'Token created · copy it now' })}>Generate token</Btn></div><code style={{ display: 'block', padding: 14, borderRadius: 10, fontSize: 13 }}>gct topics add --parent "G. Mündliche Prüfung" --name "Fokus 09.10"</code></div>;

  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: mobile ? '20px 16px 0' : '24px 32px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!mobile ? <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}><h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Manage</h1><Badge tone="neutral">Admin</Badge></div>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconBtn icon="chevron-left" label="Back" onClick={() => go('me')}></IconBtn><h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Manage</h1></div>}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>{tabs.map(([k, l, ic]) => <button key={k} onClick={() => setTab(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 42, padding: '0 12px', border: 0, background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', font: '700 14px/1 var(--font-sans)', color: tab === k ? 'var(--color-orange-dark)' : 'var(--fg-secondary)', boxShadow: tab === k ? 'inset 0 -3px 0 var(--color-orange)' : 'none' }}><Icon name={ic} size={16}></Icon>{l}</button>)}</div>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: tab === 'topics' && !mobile ? 'hidden' : 'auto' }}>
      {tab !== 'topics' ? Other : mobile ? (cur ? Editor : Tree)
        : <div style={{ display: 'grid', gridTemplateColumns: '400px minmax(0,1fr)', height: '100%' }}>
          <div style={{ borderRight: '1px solid var(--color-border)', background: 'rgba(255,252,247,.6)', minHeight: 0 }}>{Tree}</div>
          <div style={{ overflow: 'auto' }}>{Editor}</div>
        </div>}
    </div>
  </div>;
}

Object.assign(window, { ManageScreen });
