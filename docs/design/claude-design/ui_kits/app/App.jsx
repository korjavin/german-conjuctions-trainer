// GCT UI kit v2 — app shell, routing, mount
const SCOPED = ['today', 'topics', 'listen', 'history', 'summary'];
const NAV = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'topics', label: 'Topics', icon: 'topics' },
  { id: 'listen', label: 'Listen', icon: 'listen' },
  { id: 'history', label: 'History', icon: 'history' },
];

function TopBar({ route, go, offline, menuOpen, setMenuOpen }) {
  const u = GCT_DATA.user;
  return <header style={{ height: 56, flex: 'none', background: 'var(--gradient-header)', boxShadow: 'var(--shadow-header)', display: 'flex', alignItems: 'center', gap: 20, padding: '0 20px', position: 'relative', zIndex: 20 }}>
    {SCOPED.includes(route) && <ScopeButton></ScopeButton>}
    <nav style={{ display: 'flex', gap: 4 }}>
      {NAV.map((n) => { const on = route === n.id || (n.id === 'topics' && route === 'topics'); return <button key={n.id} onClick={() => go(n.id)}
        style={{ height: 36, padding: '0 14px', borderRadius: 8, border: 0, cursor: 'pointer', font: '700 14px/1 var(--font-sans)', color: on ? '#fff' : 'rgba(255,248,240,.78)', background: on ? 'rgba(255,248,240,.16)' : 'transparent' }}>{n.label}</button>; })}
    </nav>
    <div style={{ flex: 1 }}></div>
    {offline && <OfflineChip onDark></OfflineChip>}
    {u.admin && <button onClick={() => go('manage')} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,248,240,.25)', background: route === 'manage' ? 'rgba(255,248,240,.16)' : 'transparent', color: '#fff8f0', font: '700 13px/1 var(--font-sans)', cursor: 'pointer' }}><Icon name="manage" size={16}></Icon>Manage</button>}
    <div style={{ position: 'relative' }}>
      <button aria-label="Account" onClick={() => setMenuOpen(!menuOpen)} style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(255,248,240,.5)', background: '#ffd49a', color: '#6c290d', font: '800 13px/1 var(--font-sans)', cursor: 'pointer' }}>{u.initials}</button>
      {menuOpen && <div className="gct-card" style={{ position: 'absolute', right: 0, top: 46, width: 240, padding: 6, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ padding: '10px 12px 12px', borderBottom: '1px solid var(--color-border)', marginBottom: 4 }}><div style={{ fontWeight: 800 }}>{u.name}</div><div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{u.email}</div></div>
        {[['sliders', 'Settings', () => go('me')], ['manage', 'Manage', () => go('manage')], ['shield', 'Privacy', null], ['logout', 'Log out', null]].map(([ic, l, f]) =>
          <Row key={l} onClick={() => { setMenuOpen(false); f && f(); }} style={{ padding: '10px 12px', borderRadius: 8, fontWeight: 600, fontSize: 14 }}><Icon name={ic} size={18} style={{ color: 'var(--fg-secondary)' }}></Icon>{l}</Row>)}
      </div>}
    </div>
  </header>;
}

function TabBar({ route, go }) {
  const { scope } = useUI();
  const due = scope ? GCT_DATA.node(scope).due : GCT_DATA.ALL_DUE;
  const tabs = [...NAV, { id: 'me', label: 'Me', icon: 'user' }];
  return <nav style={{ height: 64, flex: 'none', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', background: 'rgba(255,252,247,.94)', backdropFilter: 'blur(16px)', borderTop: '1px solid var(--color-border)', paddingBottom: 4 }}>
    {tabs.map((t) => { const on = route === t.id || (t.id === 'me' && route === 'manage'); return <button key={t.id} onClick={() => go(t.id)} style={{ border: 0, background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', color: on ? 'var(--color-orange-dark)' : 'var(--fg-muted)', font: (on ? 800 : 600) + ' 11px/1 var(--font-sans)', position: 'relative' }}>
      {t.id === 'today' && <span style={{ position: 'absolute', top: 8, left: '50%', marginLeft: 6, minWidth: 18, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--color-orange)', color: '#fff', font: '800 10px/16px var(--font-sans)' }}>{due}</span>}
      <Icon name={t.icon} size={22} stroke={on ? 2.25 : 1.75}></Icon>{t.label}</button>; })}
  </nav>;
}

function App({ initial = {}, forceMobile, offline: offline0 = false, demoToast, demoMenu, initialScope, demoScopeOpen }) {
  const [vw, setVw] = React.useState(window.innerWidth);
  React.useEffect(() => { if (forceMobile != null) return; const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const mobile = forceMobile != null ? forceMobile : vw < 760;
  const [route, setRoute] = React.useState(initial.route || 'today');
  const [params, setParams] = React.useState(initial.params || {});
  const [toast, setToast] = React.useState(demoToast || null);
  const [dlg, setDlg] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(!!demoMenu);
  const [offline] = React.useState(offline0);
  const [prefs, setPrefs] = React.useState({ sound: true, voice: false, autoplay: true });
  const [scope, setScope0] = React.useState(initialScope === undefined ? null : initialScope);
  const [recent, setRecent] = React.useState(() => [GCT_DATA.byName('G. Mündliche').id, GCT_DATA.byName('S1. Sprechen').id, GCT_DATA.byName('Konjunktionen').id]);
  const [scopeOpen, openScope] = React.useState(!!demoScopeOpen);
  const setScope = (id) => { setScope0(id); if (id) setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 4)); if (forceMobile == null) { try { localStorage.setItem('gct-scope', id || ''); } catch (e) {} } };
  const mainRef = React.useRef(null);
  const timer = React.useRef(null);

  const go = (r, p = {}) => { setRoute(r); setParams(p); setMenuOpen(false); if (mainRef.current) mainRef.current.scrollTop = 0; };
  const showToast = (t) => { setToast(t); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 3200); };
  const ui = { mobile, go, toast: showToast, confirm: setDlg, offline, prefs, setPrefs, params, scope, setScope, scopeOpen, openScope, recent };

  const screens = { today: TodayScreen, topics: TopicsScreen, practice: PracticeScreen, summary: SummaryScreen, listen: ListenScreen, history: HistoryScreen, me: MeScreen, manage: ManageScreen };
  const Screen = screens[route] || TodayScreen;
  const focused = route === 'practice';
  const wide = route === 'manage' && !mobile;

  return <UICtx.Provider value={ui}>
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--gradient-page)', color: 'var(--fg-primary)', fontFamily: 'var(--font-sans)', overflow: 'hidden' }}>
      {!mobile && !focused && <TopBar route={route} go={go} offline={offline} menuOpen={menuOpen} setMenuOpen={setMenuOpen}></TopBar>}
      <main ref={mainRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {focused || wide ? <Screen {...params}></Screen>
          : <div style={{ maxWidth: 1120, margin: '0 auto', padding: mobile ? '16px 16px 28px' : '36px 40px 56px' }}>{mobile && ['today', 'listen', 'history'].includes(route) && <ScopeBar></ScopeBar>}<Screen {...params}></Screen></div>}
      </main>
      {mobile && !focused && <TabBar route={route} go={go}></TabBar>}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: mobile && !focused ? 76 : 24, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 40, padding: '0 16px' }}><div style={{ pointerEvents: 'auto' }}><Toast toast={toast}></Toast></div></div>
      <ConfirmDialog dlg={dlg} onClose={() => setDlg(null)}></ConfirmDialog>
      {scopeOpen && <ScopePicker></ScopePicker>}
    </div>
  </UICtx.Provider>;
}

window.App = App;

const gctRootEl = document.getElementById('root');
if (gctRootEl) {
  const q = new URLSearchParams(location.search);
  const initial = { route: q.get('screen') || 'today', params: q.get('demo') ? { demo: q.get('demo') } : {} };
  let saved = null; try { saved = localStorage.getItem('gct-scope'); } catch (e) {}
  const initialScope = saved === null ? GCT_DATA.roots[0].id : (saved && GCT_DATA.node(saved) ? saved : null);
  ReactDOM.createRoot(gctRootEl).render(<App initial={initial} initialScope={initialScope} offline={q.get('offline') === '1'}></App>);
}
