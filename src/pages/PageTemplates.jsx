// Template gallery for Pages: light/dark preview, "use template" and "ask for adjustment" (side-by-side preview).
import { useMemo, useState } from 'react';
import { Moon, Plane, Sparkles, Sun, Sunrise, Wallet } from 'lucide-react';
import { bridge } from '../api.js';
import { Btn, Modal, useAction } from '../ui.jsx';

const BASE_CSS = `:root{--bg:#f5f6fa;--card:#fff;--fg:#14161c;--mut:#6b7280;--ac:#0a84ff;--line:#e5e7eb}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0b0d12;--card:#161a24;--fg:#f4f6fb;--mut:#9aa3b2;--line:#2a3140}}
:root[data-theme=dark]{--bg:#0b0d12;--card:#161a24;--fg:#f4f6fb;--mut:#9aa3b2;--line:#2a3140}
*{box-sizing:border-box}body{margin:0;padding:18px;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,sans-serif}
.w{max-width:620px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.m{color:var(--mut);font-size:13px}
.c{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:12px 0}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.k{font-size:24px;font-weight:700}.r{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.r:last-child{border:0}
.b{height:8px;border-radius:9px;background:var(--line);overflow:hidden}.b i{display:block;height:100%;background:var(--ac)}
input,button{font:inherit;border-radius:10px;border:1px solid var(--line);padding:9px 11px;background:var(--card);color:var(--fg)}button{background:var(--ac);color:#fff;border:0;font-weight:600}`;

const wrap = (title, body, script = '') => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${BASE_CSS}</style></head><body><div class="w">${body}</div><script>${script}</script></body></html>`;

const PERSIST = `let S={};const P=window.PageData;async function load(){try{S=(P&&await P.get())||{}}catch(e){S={}}draw()}async function save(){if(P)await P.set(S)}`;

export const TEMPLATES = [
  {
    id: 'viagem', name: 'Viagem', icon: Plane, desc: 'Roteiro, checklist e voos com estado salvo.',
    title: 'Viagem — roteiro e checklist',
    html: wrap('Viagem', `<h1>✈️ Minha viagem</h1><div class="m">Destino · datas · reservas</div>
<div class="c"><b>Roteiro</b><div class="r"><span>Dia 1 — Chegada e hotel</span><span class="m">—</span></div><div class="r"><span>Dia 2 — Passeio principal</span><span class="m">—</span></div><div class="r"><span>Dia 3 — Livre</span><span class="m">—</span></div></div>
<div class="c"><b>Checklist</b><div id="l"></div><div style="display:flex;gap:8px;margin-top:10px"><input id="i" placeholder="Novo item" style="flex:1"><button onclick="add()">+</button></div></div>`,
      `${PERSIST}
function draw(){const a=S.items||[];document.getElementById('l').innerHTML=a.map((x,i)=>'<div class="r"><label><input type="checkbox" '+(x.d?'checked':'')+' onchange="tg('+i+')"> '+x.t.replace(/</g,'&lt;')+'</label></div>').join('')||'<div class="m">Nada ainda.</div>'}
function add(){const i=document.getElementById('i');if(!i.value.trim())return;(S.items=S.items||[]).push({t:i.value.trim()});i.value='';save();draw()}
function tg(i){S.items[i].d=!S.items[i].d;save();draw()}load();`),
  },
  {
    id: 'financas', name: 'Finanças', icon: Wallet, desc: 'Resumo do mês, categorias e lançamentos.',
    title: 'Finanças do mês',
    html: wrap('Finanças', `<h1>💰 Finanças do mês</h1><div class="m">Edite pelo chat ou adicione lançamentos abaixo</div>
<div class="g" style="margin-top:12px"><div class="c"><div class="m">Entradas</div><div class="k" id="in">R$ 0</div></div><div class="c"><div class="m">Saídas</div><div class="k" id="out">R$ 0</div></div><div class="c"><div class="m">Saldo</div><div class="k" id="bal">R$ 0</div></div></div>
<div class="c"><b>Lançamentos</b><div id="l"></div><div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap"><input id="d" placeholder="Descrição" style="flex:2;min-width:120px"><input id="v" type="number" placeholder="Valor (− saída)" style="flex:1;min-width:100px"><button onclick="add()">Add</button></div></div>`,
      `${PERSIST}
const f=n=>'R$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2});
function draw(){const a=S.tx||[];const i=a.filter(x=>x.v>0).reduce((s,x)=>s+x.v,0),o=Math.abs(a.filter(x=>x.v<0).reduce((s,x)=>s+x.v,0));
document.getElementById('in').textContent=f(i);document.getElementById('out').textContent=f(o);document.getElementById('bal').textContent=f(i-o);
document.getElementById('l').innerHTML=a.map(x=>'<div class="r"><span>'+x.d.replace(/</g,'&lt;')+'</span><b style="color:'+(x.v<0?'#ef4444':'#22c55e')+'">'+f(x.v)+'</b></div>').join('')||'<div class="m">Sem lançamentos.</div>'}
function add(){const d=document.getElementById('d'),v=document.getElementById('v');if(!d.value||!v.value)return;(S.tx=S.tx||[]).push({d:d.value,v:Number(v.value)});d.value=v.value='';save();draw()}load();`),
  },
  {
    id: 'briefing', name: 'Briefing', icon: Sunrise, desc: 'Painel diário: agenda, prioridades e destaques.',
    title: 'Briefing do dia',
    html: wrap('Briefing', `<h1>☀️ Briefing do dia</h1><div class="m" id="dt"></div>
<div class="c"><b>Prioridades</b><div class="r"><span>1. Defina a prioridade principal</span></div><div class="r"><span>2. Segunda prioridade</span></div><div class="r"><span>3. Terceira prioridade</span></div></div>
<div class="c"><b>Agenda</b><div class="r"><span>09:00</span><span class="m">Compromisso</span></div><div class="r"><span>14:00</span><span class="m">Compromisso</span></div></div>
<div class="c"><b>Progresso da semana</b><div class="b" style="margin-top:8px"><i style="width:40%"></i></div><div class="m" style="margin-top:6px">Atualizado automaticamente por rotinas (page_data).</div></div>`,
      `document.getElementById('dt').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})`),
  },
];

export const withTheme = (html, theme) => (theme === 'auto' ? html : html.replace('<html lang="pt-BR">', `<html lang="pt-BR" data-theme="${theme}">`));

export default function TemplateGallery({ bots, onClose, onCreated }) {
  const [sel, setSel] = useState(TEMPLATES[0]);
  const [theme, setTheme] = useState('light');
  const [ask, setAsk] = useState('');
  const [made, setMade] = useState(null);
  const [busy, run] = useAction();
  const doc = useMemo(() => withTheme(sel.html, theme), [sel, theme]);

  const create = async () => {
    if (made?.tpl === sel.id) return made.page;
    const page = await run('create', () => bridge.addPage({ title: sel.title, description: 'Modelo: ' + sel.name, bot: bots?.[0]?.id || 'default', public: false, html: sel.html }), 'Página criada');
    if (page) { setMade({ tpl: sel.id, page }); onCreated?.(page); }
    return page;
  };
  const request = async () => {
    if (!ask.trim()) return;
    const page = await create(); if (!page) return;
    const chats = await bridge.chats().catch(() => []);
    const chat = (chats || []).find((c) => String(c.id).startsWith('web:')) || (chats || [])[0];
    if (!chat) return;
    const prompt = `Ajuste a Página da ponte com id ${page.id} ("${sel.title}") conforme o pedido: ${ask.trim()}\nLeia com GET /pages/${page.id}, aplique o ajuste mantendo o tema claro/escuro e o window.PageData, e salve com PATCH /pages/${page.id} (campo html).`;
    const r = await run('ask', () => bridge.startTask({ parentChatId: chat.id, title: 'Ajustar página: ' + sel.name, prompt, bot: page.bot || undefined }), 'Pedido enviado ao bot');
    if (r) setAsk('');
  };

  return (
    <Modal title="Galeria de modelos" onClose={onClose} wide>
      <div className="tg-layout">
        <div className="tg-side stack" style={{ gap: 10 }}>
          <div className="tg-list">
            {TEMPLATES.map((t) => <button key={t.id} className={'tg-item' + (t.id === sel.id ? ' on' : '')} onClick={() => setSel(t)}><t.icon size={18} /><span><b>{t.name}</b><small className="muted">{t.desc}</small></span></button>)}
          </div>
          <div className="seg seg-ios" role="radiogroup" aria-label="Tema da prévia">
            <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}><Sun size={13} /> Claro</button>
            <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}><Moon size={13} /> Escuro</button>
          </div>
          <Btn icon={Sparkles} disabled={busy === 'create' || made?.tpl === sel.id} onClick={create}>{made?.tpl === sel.id ? 'Página criada ✓' : 'Usar este modelo'}</Btn>
          <label className="stack" style={{ gap: 6 }}><span className="small muted">Pedir ajuste ao bot</span>
            <textarea rows={3} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ex.: trocar para destino Lisboa e adicionar seção de hotéis" />
          </label>
          <Btn className="ghost" disabled={!ask.trim() || busy === 'ask'} onClick={request}>Pedir ajuste</Btn>
        </div>
        <iframe className="tg-prev" title={'Prévia ' + sel.name} sandbox="allow-scripts" srcDoc={doc} />
      </div>
    </Modal>
  );
}
