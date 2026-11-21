import { useEffect, useState } from 'react';
import { Bot, Brain, Check, CheckSquare, Clock, FileCode2, FolderArchive, GitBranch, Inbox, Mail, MessageSquare, Pencil, Plus, Search, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { bridge } from './api.js';
import { Badge, Btn, ErrorBox, Field, IconButton, Modal, useAction, useFmt, useLoad, useToast } from './ui.jsx';

const GROUP_META = [
  ['chats', 'Conversas', MessageSquare, 'chat'],
  ['tickets', 'Tarefas (Board)', CheckSquare, 'board'],
  ['pages', 'Páginas / Mini-Apps', FileCode2, 'dashboards'],
  ['bots', 'Bots', Bot, 'bots'],
  ['skills', 'Skills', Wand2, 'skills'],
  ['memory', 'Memórias', Brain, 'memory'],
  ['obsidian', 'Obsidian Vault', FileCode2, 'memory'],
  ['semantic', 'Busca Semântica (ai-memory)', Sparkles, 'memory'],
  ['artifacts', 'Artefatos', FolderArchive, 'artifacts'],
];

export function GlobalSearchModal({ onClose, go }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const clean = q.trim();
    if (!clean) { setRes(null); setErr(''); return undefined; }
    let cancel = false;
    const t = setTimeout(() => {
      setLoading(true);
      setErr('');
      bridge.search(clean, 30)
        .then((d) => { if (!cancel) setRes(d); })
        .catch((e) => { if (!cancel) setErr(e.message || 'Erro na busca'); })
        .finally(() => { if (!cancel) setLoading(false); });
    }, 220);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

  const jump = (pageId, item) => {
    if (pageId === 'chat' && item?.id?.startsWith('web:')) {
      try { localStorage.setItem('acp_chat_open', item.id); } catch {}
      window.dispatchEvent(new CustomEvent('acp:open-chat', { detail: { chatId: item.id } }));
    }
    go(pageId);
    onClose();
  };

  return (
    <Modal title="Busca Global (Cmd+K)" onClose={onClose} wide>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <Search size={17} className="muted" />
          <input
            autoFocus
            className="grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar em conversas, tickets, páginas, skills, memórias, Obsidian e ai-memory…"
          />
          {q && <IconButton icon={X} label="Limpar" onClick={() => setQ('')} />}
        </div>
        {err && <ErrorBox error={err} />}
        {loading && <p className="muted small" style={{ margin: 0 }}>Buscando em todas as fontes…</p>}
        {!q.trim() && (
          <p className="muted small" style={{ margin: 0 }}>
            Dica: digite qualquer termo para pesquisar simultaneamente em chats, Board, Mini-Apps, artefatos, memórias locais, vault Obsidian e busca semântica.
          </p>
        )}
        {res && !loading && res.total === 0 && <p className="muted">Nenhum resultado para "{res.query}".</p>}
        {res && res.total > 0 && (
          <div className="stack" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {GROUP_META.map(([key, label, Icon, pageId]) => {
              const items = res.groups?.[key] || [];
              if (!items.length) return null;
              return (
                <div key={key} className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Icon size={14} className="muted" />
                    <b className="small">{label}</b>
                    <Badge kind="muted">{items.length}</Badge>
                  </div>
                  {items.map((it, idx) => (
                    <button
                      key={it.id || it.slug || it.file || it.path || it.name || idx}
                      type="button"
                      className="list-row press"
                      style={{ textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 10 }}
                      onClick={() => jump(pageId, it)}
                    >
                      <div className="grow">
                        <div className="row wrap" style={{ gap: 6 }}>
                          <b>{it.title || it.name || it.slug || it.file || it.path}</b>
                          {it.status && <Badge kind="muted">{it.status}</Badge>}
                          {it.hasData && <Badge kind="ok">Mini-App</Badge>}
                        </div>
                        {(it.snippet || it.description) && (
                          <div className="muted small ellipsis-2">{it.snippet || it.description}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewDraftForm({ onClose, onSaved }) {
  const [f, setF] = useState({ channel: 'whatsapp', to: '', subject: '', body: '', scheduledAt: '' });
  const [busy, run] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run('save', () => bridge.addDraft({
      channel: f.channel,
      to: f.to.trim(),
      subject: f.subject.trim(),
      body: f.body.trim(),
      scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : '',
    }), 'Rascunho criado');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <form className="stack" onSubmit={submit} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="form-grid">
        <Field label="Canal">
          <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail (AgentMail)</option>
          </select>
        </Field>
        <Field label={f.channel === 'whatsapp' ? 'Número / Destinatário' : 'E-mail destinatário'}>
          <input required value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder={f.channel === 'whatsapp' ? '5511999998888' : 'alguem@empresa.com'} />
        </Field>
      </div>
      {f.channel === 'email' && (
        <Field label="Assunto"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Assunto do e-mail" /></Field>
      )}
      <Field label="Mensagem"><textarea required rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Texto do rascunho…" /></Field>
      <Field label="Agendar envio (opcional)"><input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
      <div className="row end">
        <button type="button" className="ghost small" onClick={onClose}>Cancelar</button>
        <button className="small" disabled={busy === 'save'}>Salvar rascunho</button>
      </div>
    </form>
  );
}

export function ActionInboxModal({ onClose, go }) {
  const f = useFmt();
  const toast = useToast();
  const inbox = useLoad(() => bridge.inbox(), [], { interval: 10000 });
  const [busy, run] = useAction();
  const [newDraft, setNewDraft] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const [draftBody, setDraftBody] = useState('');
  const [draftSched, setDraftSched] = useState('');

  const data = inbox.data || { total: 0, prompts: [], nudges: [], drafts: [], reviewTickets: [], waitingWorkflows: [] };
  const refresh = () => { inbox.reload(true); window.dispatchEvent(new Event('acp:nav-refresh')); };

  return (
    <Modal title={'Central de Decisões (' + data.total + ')'} onClose={onClose} wide>
      <div className="stack" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        <ErrorBox error={inbox.error} onRetry={() => inbox.reload()} />
        <div className="row wrap">
          <span className="muted small grow">Tudo que aguarda sua aprovação, revisão ou envio em um só lugar.</span>
          <Btn icon={Plus} className="ghost small" onClick={() => setNewDraft((v) => !v)}>Novo rascunho</Btn>
        </div>
        {newDraft && <NewDraftForm onClose={() => setNewDraft(false)} onSaved={refresh} />}

        {data.total === 0 && !inbox.loading && (
          <p className="muted" style={{ textAlign: 'center', padding: '18px 0' }}>✨ Tudo limpo! Nenhuma pendência aguardando sua decisão agora.</p>
        )}

        {/* Prompts & Nudges */}
        {[...(data.prompts || []), ...(data.nudges || [])].length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <b className="small">🔔 Aprovações & Nudges</b>
            {[...(data.prompts || []), ...(data.nudges || [])].map((p) => (
              <div key={p.id} className="list-row wrap" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                <div className="grow">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <b>{p.title}</b>
                    <Badge kind={p.kind === 'nudge' ? 'warn' : 'ok'}>{p.kind === 'nudge' ? 'Nudge' : 'Aprovação'}</Badge>
                  </div>
                  <p className="muted small" style={{ margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{p.question}</p>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {(p.options || ['Aprovar', 'Cancelar']).map((opt) => {
                      const label = typeof opt === 'string' ? opt : opt.label;
                      return (
                        <Btn key={label} className="small" disabled={busy === p.id + label}
                          onClick={() => run(p.id + label, () => bridge.answerPrompt(p.id, label), 'Resposta enviada').then(refresh)}>
                          {label}
                        </Btn>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Assisted Drafts */}
        {(data.drafts || []).length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <b className="small">✉️ Rascunhos Assistidos ({data.drafts.length})</b>
            {data.drafts.map((d) => (
              <div key={d.id} className="stack" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, gap: 8 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  {d.channel === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />}
                  <b>{d.to}</b>
                  <Badge kind={d.status === 'scheduled' ? 'warn' : d.status === 'error' ? 'err' : 'muted'}>
                    {d.status === 'scheduled' ? 'Agendado ' + f.date(d.scheduledAt) : d.status}
                  </Badge>
                  {d.subject && <span className="muted small">· {d.subject}</span>}
                  <span className="grow" />
                  <IconButton icon={Pencil} label="Editar" onClick={() => { setEditingDraft(editingDraft === d.id ? null : d.id); setDraftBody(d.body); setDraftSched(d.scheduledAt ? d.scheduledAt.slice(0, 16) : ''); }} />
                  <IconButton icon={Trash2} className="ghost danger-text" label="Descartar" onClick={() => run('dd' + d.id, () => bridge.deleteDraft(d.id), 'Rascunho descartado').then(refresh)} />
                </div>
                {editingDraft === d.id ? (
                  <div className="stack" style={{ gap: 6 }}>
                    <textarea rows={3} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
                    <div className="row wrap">
                      <input type="datetime-local" value={draftSched} onChange={(e) => setDraftSched(e.target.value)} />
                      <span className="grow" />
                      <Btn icon={Check} className="small" disabled={busy === 'sv' + d.id}
                        onClick={() => run('sv' + d.id, () => bridge.patchDraft(d.id, { body: draftBody, scheduledAt: draftSched ? new Date(draftSched).toISOString() : '' }), 'Rascunho salvo').then(() => { setEditingDraft(null); refresh(); })}>
                        Salvar
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{d.body}</p>
                )}
                {d.error && <p className="err small" style={{ margin: 0 }}>{d.error}</p>}
                <div className="row end">
                  <Btn icon={Send} className="small" disabled={busy === 'sd' + d.id}
                    onClick={() => run('sd' + d.id, () => bridge.sendDraft(d.id), 'Enviado com sucesso!').then(refresh)}>
                    Enviar agora
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tickets in Review / Blocked / Interrupted */}
        {(data.reviewTickets || []).length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <b className="small">📋 Tarefas aguardando revisão ({data.reviewTickets.length})</b>
            {data.reviewTickets.map((tk) => (
              <div key={tk.id} className="list-row wrap" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                <div className="grow">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <b>{tk.title}</b>
                    <Badge kind={tk.interrupted || tk.status === 'blocked' ? 'err' : 'warn'}>{tk.interrupted ? 'Interrompida' : tk.status}</Badge>
                  </div>
                  <div className="muted small ellipsis-2">{tk.description}</div>
                </div>
                <div className="row">
                  {tk.interrupted && (
                    <Btn className="small" disabled={busy === 'rt' + tk.id} onClick={() => run('rt' + tk.id, () => bridge.resumeTicket(tk.id), 'Retomando tarefa').then(refresh)}>Retomar</Btn>
                  )}
                  <Btn className="ghost small" onClick={() => { go('board'); onClose(); }}>Abrir Board</Btn>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Waiting Workflows */}
        {(data.waitingWorkflows || []).length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <b className="small">⚡ Workflows aguardando aprovação</b>
            {data.waitingWorkflows.map((w) => (
              <div key={w.id} className="list-row wrap" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                <div className="grow">
                  <b>{w.workflowName}</b>
                  <div className="muted small">Etapa {(w.currentStep || 0) + 1} · iniciado {f.ago(w.started)}</div>
                </div>
                <Btn icon={GitBranch} className="ghost small" onClick={() => { go('schedules'); onClose(); }}>Ver Workflow</Btn>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
