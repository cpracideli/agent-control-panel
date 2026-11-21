// Camera button + capture modal. Falls back to the native camera picker when getUserMedia is unavailable.
import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';
import { IconButton, Modal } from '../ui.jsx';

export default function CameraCapture({ onPhoto, label = 'Câmera' }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [facing, setFacing] = useState('environment');
  const vid = useRef(null); const stream = useRef(null); const fallback = useRef(null);
  const canLive = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => {
    if (!open) return undefined;
    let dead = false; setErr('');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((s) => { if (dead) { s.getTracks().forEach((t) => t.stop()); return; } stop(); stream.current = s; if (vid.current) { vid.current.srcObject = s; vid.current.play().catch(() => {}); } })
      .catch((e) => !dead && setErr(e?.name === 'NotAllowedError' ? 'Permissão da câmera negada.' : 'Câmera indisponível.'));
    return () => { dead = true; stop(); };
  }, [open, facing]);

  const snap = () => {
    const v = vid.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((b) => { if (!b) return; onPhoto(new File([b], 'foto_' + Date.now() + '.jpg', { type: 'image/jpeg' })); setOpen(false); }, 'image/jpeg', 0.9);
  };

  return (
    <>
      <IconButton icon={Camera} className="ghost cbtn" size={20} label={label} onClick={() => (canLive ? setOpen(true) : fallback.current?.click())} />
      <input ref={fallback} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
      {open && (
        <Modal title="Tirar foto" onClose={() => setOpen(false)}>
          {err ? <p className="muted">{err}</p> : <video ref={vid} className="cam-video" playsInline muted autoPlay />}
          <div className="row" style={{ justifyContent: 'center', gap: 16, marginTop: 12 }}>
            <IconButton icon={RefreshCw} label="Trocar câmera" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} />
            <button type="button" className="cam-shutter" aria-label="Capturar" onClick={snap} disabled={!!err} />
          </div>
        </Modal>
      )}
    </>
  );
}
