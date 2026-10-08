// GCT UI kit v2.1 — Topic scope: the central navigation piece.
// One scope (a folder or leaf, or null = all topics) filters Today, Topics, Listen, History and Practice.

function scopeCrumbs(scopeId) {
  const p = scopeId ? GCT_DATA.findPath(scopeId) : [];
  return p.map((n) => ({ id: n.id, label: GCT_DATA.short(n) }));
}

function ScopeLabel({ scopeId, onDark, max = 2 }) {
  const c = scopeCrumbs(scopeId);
  if (!c.length) return <span style={{ fontWeight: 800 }}>All topics</span>;
  const shown = c.length > max ? [c[0], { label: '…' }, ...c.slice(-(max - 1))] : c;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
    {shown.map((x, i) => <React.Fragment key={i}>{i > 0 && <Icon name="chevron-right" size={13} style={{ opacity: .6 }}></Icon>}
      <span style={{ fontWeight: i === shown.length - 1 ? 800 : 600, opacity: i === shown.length - 1 ? 1 : .8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: i === shown.length - 1 ? 1 : 0 }}>{x.label}</span></React.Fragment>)}
  </span>;
}

// Desktop: sits in the top bar between wordmark and nav
function ScopeButton() {
  const { scope, openScope, scopeOpen } = useUI();
  const n = GCT_DATA.node(scope);
  return <button onClick={() => openScope(!scopeOpen)} aria-haspopup="dialog" aria-expanded={scopeOpen}
    style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, maxWidth: 380, minWidth: 0, padding: '0 10px 0 12px', borderRadius: 10, border: '1px solid rgba(255,248,240,.35)', background: scopeOpen ? 'rgba(255,248,240,.22)' : 'rgba(255,248,240,.12)', color: '#fff8f0', font: '14px/1 var(--font-sans)', cursor: 'pointer' }}>
    <Icon name={n && n.kind === 'leaf' ? 'leaf' : 'folder'} size={16} style={{ color: '#ffd49a' }}></Icon>
    <ScopeLabel scopeId={scope} onDark></ScopeLabel>
    <span style={{ flex: 'none', minWidth: 22, height: 20, padding: '0 6px', borderRadius: 10, background: '#ffd49a', color: '#6c290d', font: '800 11px/20px var(--font-sans)', textAlign: 'center' }}>{n ? n.due : GCT_DATA.ALL_DUE}</span>
    <Icon name="chevron-down" size={16} style={{ opacity: .8 }}></Icon>
  </button>;
}

// Mobile: first row of every scoped tab
function ScopeBar() {
  const { scope, openScope } = useUI();
  const n = GCT_DATA.node(scope);
  return <button onClick={() => openScope(true)} className="gct-card" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, height: 48, padding: '0 12px 0 14px', marginBottom: 16, cursor: 'pointer', font: '14px/1 var(--font-sans)', color: 'var(--fg-primary)', boxShadow: 'var(--shadow-sm)' }}>
    <Icon name={n && n.kind === 'leaf' ? 'leaf' : 'folder'} size={18} style={{ color: 'var(--color-orange)' }}></Icon>
    <span style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}><ScopeLabel scopeId={scope}></ScopeLabel></span>
    <Badge tone="info" quiet dot>{n ? n.due : GCT_DATA.ALL_DUE}</Badge>
    <Icon name="chevron-down" size={18} style={{ color: 'var(--fg-muted)' }}></Icon>
  </button>;
}

// Shown on filtered pages (desktop) so the filter is never invisible
function ScopeNote({ what }) {
  const { scope, setScope, openScope, mobile } = useUI();
  if (!scope || mobile) return null;
  const n = GCT_DATA.node(scope);
  const subs = n.kind === 'folder' ? GCT_DATA.leaves(n).length : 0;
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14, color: 'var(--fg-secondary)', fontWeight: 600, marginBottom: 18 }}>
    <Icon name="folder" size={16} style={{ color: 'var(--color-orange)' }}></Icon>
    <span>{what} in <b style={{ color: 'var(--fg-primary)' }}>{GCT_DATA.short(n)}</b>{subs ? ` and its ${subs} topics` : ''}</span>
    <a onClick={() => openScope(true)} style={{ cursor: 'pointer', fontWeight: 700 }}>Change</a>
    <a onClick={() => setScope(null)} style={{ cursor: 'pointer', fontWeight: 700 }}>Show all</a>
  </div>;
}

function ScopePicker() {
  const { scope, setScope, openScope, mobile, recent } = useUI();
  const D = GCT_DATA;
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(() => new Set((scope ? D.findPath(scope) : []).map((p) => p.id)));
  const pick = (id) => { setScope(id); openScope(false); };
  const toggle = (id) => { const s = new Set(open); s.has(id) ? s.delete(id) : s.add(id); setOpen(s); };
  const rows = [];
  if (q.trim()) {
    const walk = (ns, trail) => ns.forEach((x) => { if (x.name.toLowerCase().includes(q.toLowerCase())) rows.push({ x, depth: 0, trail }); x.children && walk(x.children, [...trail, x]); });
    walk(D.roots, []);
  } else {
    const walk = (ns, d) => ns.forEach((x) => { rows.push({ x, depth: d }); if (x.children && open.has(x.id)) walk(x.children, d + 1); });
    walk(D.roots, 0);
  }
  const rowH = mobile ? 48 : 38;
  const Item = ({ x, depth, trail }) => { const on = x.id === scope; return <div onClick={() => pick(x.id)} className="gct-tree-row"
    style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: rowH, padding: `6px 12px 6px ${10 + depth * 18}px`, cursor: 'pointer', borderRadius: 8, background: on ? 'var(--color-orange-tint)' : undefined }}>
    <span onClick={(e) => { if (x.kind === 'folder' && !trail) { e.stopPropagation(); toggle(x.id); } }} style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', borderRadius: 6, flex: 'none' }}>
      {x.kind === 'folder' && !trail && <Icon name={open.has(x.id) ? 'chevron-down' : 'chevron-right'} size={16}></Icon>}</span>
    <Icon name={x.kind === 'folder' ? 'folder' : 'leaf'} size={16} style={{ color: x.kind === 'folder' ? 'var(--color-orange)' : 'var(--fg-muted)' }}></Icon>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: on || x.kind === 'folder' ? 700 : 500, color: on ? 'var(--color-orange-dark)' : undefined, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: mobile ? 'normal' : 'nowrap' }}>{x.name}</span>
      {trail && trail.length > 0 && <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600 }}>{trail.map(D.short).join(' › ')}</span>}
    </span>
    {x.isNew && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-orange-bright)', flex: 'none' }}></span>}
    {x.due > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-orange-dark)', minWidth: 20, textAlign: 'right' }}>{x.due}</span>}
    {on && <Icon name="check" size={16} style={{ color: 'var(--color-orange-dark)' }}></Icon>}
  </div>; };

  const body = <>
    <div style={{ padding: mobile ? '4px 16px 12px' : 12, borderBottom: '1px solid var(--color-border)' }}>
      {mobile && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}><span style={{ fontSize: 18, fontWeight: 800 }}>Choose a topic</span><IconBtn icon="x" label="Close" onClick={() => openScope(false)}></IconBtn></div>}
      <div style={{ position: 'relative' }}><Icon name="search" size={16} style={{ position: 'absolute', left: 11, top: mobile ? 14 : 12, color: 'var(--fg-muted)' }}></Icon>
        <input className="gct-input" autoFocus={!mobile} placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34, minHeight: mobile ? 44 : 40 }}></input></div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 600, marginTop: 8 }}>Today, Listen, History and Practice all follow this topic and everything inside it.</div>
    </div>
    <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
      {!q && <>
        <div onClick={() => pick(null)} className="gct-tree-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: rowH, padding: '6px 12px 6px 10px', borderRadius: 8, cursor: 'pointer', background: !scope ? 'var(--color-orange-tint)' : undefined }}>
          <span style={{ width: 22 }}></span><Icon name="topics" size={16} style={{ color: 'var(--fg-secondary)' }}></Icon><span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: !scope ? 'var(--color-orange-dark)' : undefined }}>All topics</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-orange-dark)' }}>{D.ALL_DUE}</span>{!scope && <Icon name="check" size={16} style={{ color: 'var(--color-orange-dark)' }}></Icon>}</div>
        {recent.filter((r) => r !== scope).length > 0 && <div style={{ padding: '10px 10px 4px' }}><Caption>Recent</Caption>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{recent.filter((r) => r !== scope).map((r) => <button key={r} className="gct-pill" onClick={() => pick(r)} style={{ maxWidth: '100%' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{D.short(D.node(r))}</span></button>)}</div></div>}
        <div style={{ padding: '12px 10px 4px' }}><Caption>All topics</Caption></div>
      </>}
      {rows.map((r) => <Item key={r.x.id} {...r}></Item>)}
      {q && rows.length === 0 && <div style={{ padding: 20, color: 'var(--fg-muted)', fontWeight: 600, fontSize: 14 }}>No topic matches “{q}”.</div>}
    </div>
  </>;

  if (mobile) return <div className="gct-scrim" onClick={() => openScope(false)} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '82%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column', paddingTop: 8 }}>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-neutral-border)', margin: '0 auto 8px' }}></div>{body}</div>
  </div>;
  return <>
    <div onClick={() => openScope(false)} style={{ position: 'absolute', inset: 0, zIndex: 55 }}></div>
    <div className="gct-card" style={{ position: 'absolute', top: 52, left: 20, zIndex: 60, width: 460, maxHeight: 'calc(100% - 80px)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>{body}</div>
  </>;
}

Object.assign(window, { scopeCrumbs, ScopeLabel, ScopeButton, ScopeBar, ScopeNote, ScopePicker });
