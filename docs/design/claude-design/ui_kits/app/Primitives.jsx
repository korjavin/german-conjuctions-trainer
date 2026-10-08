// GCT UI kit v2 — primitives (map 1:1 to components.css)
const UICtx = React.createContext({ mobile: false });
const useUI = () => React.useContext(UICtx);

function Icon({ name, size = 20, stroke = 2, style }) {
  return <span style={{ display: 'inline-flex', flex: 'none', ...style }} dangerouslySetInnerHTML={{ __html: window.gctIconSvg(name, size, stroke) }}></span>;
}
function Btn({ kind = 'secondary', size, icon, iconRight, children, onClick, disabled, style, full }) {
  const cls = ['gct-btn', 'gct-btn--' + kind, size && 'gct-btn--' + size].filter(Boolean).join(' ');
  return <button className={cls} onClick={onClick} disabled={disabled} style={{ ...(full ? { width: '100%' } : {}), ...style }}>
    {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16}></Icon>}{children}{iconRight && <Icon name={iconRight} size={16}></Icon>}
  </button>;
}
function IconBtn({ icon, label, pressed, onClick, size = 20, style, tone }) {
  const { mobile } = useUI();
  const d = mobile ? 44 : 40;
  return <button className="gct-icon-btn" aria-label={label} title={label} aria-pressed={pressed ? 'true' : undefined} onClick={onClick}
    style={{ width: d, height: d, ...(tone === 'fav' && pressed ? { color: '#d9a21b', background: '#fdf0cf', borderColor: '#f0d58f' } : {}), ...style }}><Icon name={icon} size={size}></Icon></button>;
}
function Badge({ tone = 'neutral', dot, quiet, children, style }) {
  return <span className={'gct-badge gct-badge--' + tone + (quiet ? ' gct-badge--quiet' : '')} style={style}>{dot && <span className="gct-badge__dot"></span>}{children}</span>;
}
function Pill({ active, icon, count, children, onClick }) {
  return <button className="gct-pill" aria-pressed={active ? 'true' : 'false'} onClick={onClick}>{icon && <Icon name={icon} size={14}></Icon>}{children}{count != null && <span className="gct-pill__count">{count}</span>}</button>;
}
function OfflineChip({ onDark, cached }) {
  return <span className={'gct-offline' + (onDark ? ' gct-offline--on-dark' : '')}><Icon name="offline" size={14}></Icon>Offline{cached ? ' · ' + cached + ' cached' : ''}</span>;
}
function Toast({ toast }) {
  if (!toast) return null;
  const icon = toast.tone === 'success' ? 'check-circle' : toast.tone === 'danger' ? 'alert' : (toast.icon || 'info');
  return <div className={'gct-toast' + (toast.tone ? ' gct-toast--' + toast.tone : '')}><span className="gct-toast__icon"><Icon name={icon} size={18}></Icon></span>{toast.text}{toast.action && <button className="gct-toast__action">{toast.action}</button>}</div>;
}
function ConfirmDialog({ dlg, onClose }) {
  if (!dlg) return null;
  return <div className="gct-scrim" onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div className="gct-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="gct-dialog__title">{dlg.title}</div>
      <div className="gct-dialog__body">{dlg.body}</div>
      <div className="gct-dialog__actions">{dlg.actions.map((a, i) => <Btn key={i} kind={a.kind} onClick={() => { onClose(); a.run && a.run(); }}>{a.label}</Btn>)}</div>
    </div>
  </div>;
}
function Progress({ value, style }) {
  return <div className="gct-progress" style={style}><div className="gct-progress__fill" style={{ width: Math.round(value * 100) + '%' }}></div></div>;
}
function Switch({ on, onChange }) {
  return <button className="gct-switch" role="switch" aria-checked={on ? 'true' : 'false'} onClick={() => onChange && onChange(!on)}></button>;
}
function Mastery({ value, width = 64 }) {
  return <div title={Math.round(value * 100) + '% mastered'} style={{ width, height: 4, borderRadius: 2, background: 'var(--color-cream-medium)', overflow: 'hidden', flex: 'none' }}>
    <div style={{ width: Math.round(value * 100) + '%', height: '100%', background: 'var(--color-orange)', borderRadius: 2 }}></div></div>;
}
function Card({ children, style, pad = 20 }) {
  return <div className="gct-card" style={{ padding: pad, ...style }}>{children}</div>;
}
function Caption({ children, style }) {
  return <div style={{ font: '700 11px/1 var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', ...style }}>{children}</div>;
}
function Histogram({ data, height = 72, compact }) {
  const max = Math.max(...data.map((d) => d.v), 1);
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length},1fr)`, gap: compact ? 4 : 8, alignItems: 'end' }}>
    {data.map((d, i) => <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'var(--color-orange-dark)' : 'var(--fg-muted)' }}>{d.v}</span>
      <div style={{ width: '100%', height: Math.max(3, (d.v / max) * height), borderRadius: 4, background: i === 0 ? 'var(--color-orange)' : 'var(--color-cream-strong)' }}></div>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{d.label}</span>
    </div>)}
  </div>;
}
function Crumbs({ path, onNav, onDark }) {
  return <nav style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: onDark ? 'rgba(255,248,240,.8)' : 'var(--fg-secondary)', minWidth: 0 }}>
    {path.map((p, i) => <React.Fragment key={i}>
      {i > 0 && <Icon name="chevron-right" size={14} style={{ opacity: .6 }}></Icon>}
      {onNav && i < path.length - 1 ? <a onClick={() => onNav(p, i)} style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}>{p.label}</a>
        : <span style={{ color: i === path.length - 1 ? (onDark ? '#fff' : 'var(--fg-primary)') : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{p.label}</span>}
    </React.Fragment>)}
  </nav>;
}
function PageHead({ title, sub, actions }) {
  const { mobile } = useUI();
  return <div style={{ display: 'flex', alignItems: mobile ? 'flex-start' : 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: mobile ? 16 : 24 }}>
    <div style={{ minWidth: 0 }}><h1 style={{ fontSize: mobile ? 26 : 30, fontWeight: 800, letterSpacing: '-.01em', margin: 0 }}>{title}</h1>
      {sub && <div style={{ marginTop: 4, fontSize: 14, color: 'var(--fg-secondary)' }}>{sub}</div>}</div>
    {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
  </div>;
}
function Row({ children, style, onClick, hover = true }) {
  const [h, setH] = React.useState(false);
  return <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: onClick ? 'pointer' : 'default', background: hover && h && onClick ? 'var(--bg-hover)' : 'transparent', ...style }}>{children}</div>;
}

Object.assign(window, { UICtx, useUI, Icon, Btn, IconBtn, Badge, Pill, OfflineChip, Toast, ConfirmDialog, Progress, Switch, Mastery, Card, Caption, Histogram, Crumbs, PageHead, Row });
