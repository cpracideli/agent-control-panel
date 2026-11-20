import { useRef, useState } from 'react';
import { GripVertical, LayoutGrid, Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import { Modal, haptic, useToast } from './ui.jsx';

export const DEFAULT_DOCK = ['chat', 'bots', 'usage', 'overview'];
export const DOCK_SIZE = 4;

export function normalizeDock(list, validIds) {
  if (!Array.isArray(list) || list.length !== DOCK_SIZE) return [...DEFAULT_DOCK];
  const valid = new Set(validIds);
  const clean = list.map((x) => String(x || '').trim());
  if (clean.some((x) => !valid.has(x)) || new Set(clean).size !== DOCK_SIZE) return [...DEFAULT_DOCK];
  return clean;
}

export function isSameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function DockSettingsModal({ pages, dock, onSave, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState(() => [...dock]);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(null); // { id, dy }
  const listRef = useRef(null);
  const dragRef = useRef(null);

  const pageMap = new Map(pages.map((p) => [p.id, p]));
  const available = pages.filter((p) => !draft.includes(p.id));
  const isDefault = isSameList(draft, DEFAULT_DOCK);
  const dirty = !isSameList(draft, dock);
  const canSave = draft.length === DOCK_SIZE && dirty && !saving;

  const remove = (id) => {
    haptic(6);
    setDraft((prev) => prev.filter((x) => x !== id));
  };

  const add = (id) => {
    if (draft.length >= DOCK_SIZE || draft.includes(id)) return;
    haptic(8);
    setDraft((prev) => [...prev, id]);
  };

  const moveBy = (id, delta) => {
    setDraft((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    haptic(6);
  };

  const restore = () => {
    haptic(8);
    setDraft([...DEFAULT_DOCK]);
  };

  // Pointer drag-and-drop reorder inside the selected group (works for both touch and mouse).
  const onHandleDown = (id, e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id, pointerId: e.pointerId, startY: e.clientY };
    setDrag({ id, dy: 0 });
    haptic(6);
  };

  const onHandleMove = (e) => {
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    const listEl = listRef.current;
    if (listEl) {
      const rows = [...listEl.querySelectorAll('[data-dock-id]')];
      const idx = rows.findIndex((r) => r.dataset.dockId === g.id);
      if (idx >= 0) {
        const y = e.clientY;
        if (idx < rows.length - 1) {
          const nextRect = rows[idx + 1].getBoundingClientRect();
          if (y > nextRect.top + nextRect.height / 2) {
            g.startY += nextRect.height;
            setDraft((prev) => {
              const i = prev.indexOf(g.id);
              if (i < 0 || i >= prev.length - 1) return prev;
              const next = [...prev];
              [next[i], next[i + 1]] = [next[i + 1], next[i]];
              return next;
            });
            haptic(6);
          }
        }
        if (idx > 0) {
          const prevRect = rows[idx - 1].getBoundingClientRect();
          if (y < prevRect.top + prevRect.height / 2) {
            g.startY -= prevRect.height;
            setDraft((prev) => {
              const i = prev.indexOf(g.id);
              if (i <= 0) return prev;
              const next = [...prev];
              [next[i], next[i - 1]] = [next[i - 1], next[i]];
              return next;
            });
            haptic(6);
          }
        }
      }
    }
    setDrag({ id: g.id, dy: e.clientY - g.startY });
  };

  const onHandleEnd = (e) => {
    const g = dragRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
  };

  const onHandleKey = (id, e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); moveBy(id, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveBy(id, 1); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await onSave(draft);
      toast(t(r?.synced === false ? 'dock.savedLocal' : 'dock.saved'));
      onClose();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('dock.title')} onClose={onClose}>
      <form className="dock-cfg" onSubmit={submit}>
        <div className="dock-preview-wrap" aria-label={t('dock.preview')}>
          <div className="dock-preview-bar">
            {Array.from({ length: DOCK_SIZE }, (_, i) => {
              const id = draft[i];
              const pg = id ? pageMap.get(id) : null;
              const Icon = pg?.icon;
              return (
                <div key={i} className={'dock-preview-slot' + (pg ? '' : ' empty')}>
                  {pg ? <><Icon size={18} strokeWidth={2} /><span className="ellipsis">{t('nav.' + id)}</span></> : <span className="dock-slot-num">{i + 1}</span>}
                </div>
              );
            })}
            <div className="dock-preview-slot fixed">
              <LayoutGrid size={18} strokeWidth={2} />
              <span className="ellipsis">{t('nav.more')}</span>
            </div>
          </div>
        </div>

        <div className="group-label">{t('dock.selected', { n: draft.length })}</div>
        <div className="group dock-sel-list" ref={listRef} data-no-swipe>
          {draft.map((id, idx) => {
            const pg = pageMap.get(id);
            if (!pg) return null;
            const Icon = pg.icon;
            const isDragging = drag?.id === id;
            return (
              <div
                key={id}
                data-dock-id={id}
                className={'group-row dock-sel-row' + (isDragging ? ' dragging' : '')}
                style={isDragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
              >
                <button
                  type="button"
                  className="dock-drag-handle"
                  aria-label={`${t('nav.' + id)} — ${t('dock.dragHint')}`}
                  onPointerDown={(e) => onHandleDown(id, e)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleEnd}
                  onPointerCancel={onHandleEnd}
                  onKeyDown={(e) => onHandleKey(id, e)}
                >
                  <GripVertical size={17} />
                </button>
                <span className={'row-ic ic-' + id}><Icon size={17} /></span>
                <span className="grow">
                  <b>{t('nav.' + id)}</b>
                  <small className="muted">#{idx + 1}</small>
                </span>
                <button
                  type="button"
                  className="dock-act-btn remove press"
                  aria-label={`${t('dock.remove')}: ${t('nav.' + id)}`}
                  onClick={() => remove(id)}
                >
                  <Minus size={15} strokeWidth={2.6} />
                </button>
              </div>
            );
          })}
          <div className="group-row dock-fixed-row">
            <span className="dock-drag-spacer" aria-hidden />
            <span className="row-ic ic-more"><LayoutGrid size={17} /></span>
            <span className="grow">
              <b>{t('nav.more')}</b>
              <small className="muted">{t('dock.moreFixed')}</small>
            </span>
            <Lock size={15} className="muted" aria-hidden />
          </div>
        </div>
        <p className={'dock-hint ' + (draft.length < DOCK_SIZE ? 'warn-text' : 'muted')}>
          {draft.length < DOCK_SIZE ? t('dock.pickHint', { n: DOCK_SIZE - draft.length }) : t('dock.dragHint')}
        </p>

        <div className="group">
          <button type="button" className="group-row press" disabled={isDefault} onClick={restore}>
            <span className="row-ic ic-plain"><RotateCcw size={16} /></span>
            <span className="grow">{t('dock.restore')}</span>
          </button>
        </div>

        <div className="group-label">{t('dock.available')}</div>
        {draft.length >= DOCK_SIZE && <p className="dock-hint muted">{t('dock.fullHint')}</p>}
        <div className="group">
          {available.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="group-row press"
              disabled={draft.length >= DOCK_SIZE}
              onClick={() => add(id)}
            >
              <span className={'row-ic ic-' + id}><Icon size={17} /></span>
              <span className="grow">{t('nav.' + id)}</span>
              <span className="dock-act-btn add" aria-hidden><Plus size={15} strokeWidth={2.6} /></span>
            </button>
          ))}
        </div>

        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" disabled={!canSave}>{t('dock.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
