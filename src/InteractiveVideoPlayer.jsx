import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Player from "@vimeo/player";

const DEFAULT_CONFIG = {
  title: "Hub Education — Video Interactivo",
  // Acepta: ID numérico, URL pública, o URL con hash para videos privados
  vimeoId: "1171751497",
  vimeoHash: "415649d0b1",  // Hash para videos privados/no listados
  subtitlesUrl: null,
  subtitlesCues: [],
  interactions: [
    {
      id: "note-1", type: "note", time: 3,
      data: { title: "📍 Dato importante", text: "En esta sección vamos a ver cómo el dron ajusta su altitud automáticamente usando sensores barométricos y GPS." },
    },
    {
      id: "mc-1", type: "multiple-choice", time: 8,
      data: {
        question: "¿Cuál es el sensor principal que usa un dron para mantener la altitud?",
        options: [
          { id: "a", text: "Sensor barométrico" }, { id: "b", text: "Cámara RGB" },
          { id: "c", text: "Sensor de ultrasonido" }, { id: "d", text: "Acelerómetro" },
        ],
        correctId: "a",
        explanation: "El sensor barométrico mide la presión atmosférica para calcular la altitud relativa.",
      },
    },
    {
      id: "hotspot-1", type: "hotspot", time: 15, duration: 6,
      data: {
        spots: [
          { id: "h1", x: 25, y: 30, label: "Motor CW", info: "Motor en sentido horario." },
          { id: "h2", x: 72, y: 35, label: "GPS", info: "Módulo GNSS para posicionamiento." },
          { id: "h3", x: 50, y: 70, label: "Gimbal", info: "Estabilizador de 3 ejes." },
        ],
      },
    },
    {
      id: "tf-1", type: "true-false", time: 23,
      data: {
        statement: "Un quadcopter puede mantenerse estable si falla uno de sus cuatro motores.",
        correct: false,
        explanation: "Falso. Un quadcopter necesita los 4 motores. Solo hexa/octocópteros tienen redundancia.",
      },
    },
    {
      id: "note-2", type: "note", time: 30,
      data: { title: "🎓 Resumen", text: "Barométrico para altitud, GPS para posición, IMU para orientación, ultrasonido para proximidad." },
    },
  ],
};

function getConfig() {
  return window.PLAYER_CONFIG ? { ...DEFAULT_CONFIG, ...window.PLAYER_CONFIG } : DEFAULT_CONFIG;
}

function parseVTT(text) {
  const cues = [];
  const blocks = text.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let match = lines[i].match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (match) {
        const start = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/1000;
        const end = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/1000;
        const txt = lines.slice(i+1).join("\n").trim();
        if (txt) cues.push({ start, end, text: txt });
        continue;
      }
      match = lines[i].match(/(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/);
      if (match) {
        const start = parseInt(match[1])*60 + parseInt(match[2]) + parseInt(match[3])/1000;
        const end = parseInt(match[4])*60 + parseInt(match[5]) + parseInt(match[6])/1000;
        const txt = lines.slice(i+1).join("\n").trim();
        if (txt) cues.push({ start, end, text: txt });
      }
    }
  }
  return cues;
}

// Icons
const PlayIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const FullscreenIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>;
const ExitFullscreenIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>;
const VolumeIcon = ({ muted }) => muted
  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
  : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>;
const SkipBackIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fontFamily="sans-serif">10</text></svg>;
const SkipFwdIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fontFamily="sans-serif">10</text></svg>;
const SubsIcon = ({ on }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity={on?1:0.4}><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10 0h2v2h-2v-2zm-6-4h8v2h-8v-2z"/></svg>;
const CheckIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>;
const CrossIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;
const InfoIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>;

const fmt = (s) => { const m=Math.floor(s/60); return `${m}:${Math.floor(s%60).toString().padStart(2,"0")}`; };

// Interaction overlays
function NoteOverlay({ data, onDismiss }) {
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-note-card">
        <div className="iv-note-header"><InfoIcon /><span className="iv-note-title">{data.title}</span></div>
        <p className="iv-note-text">{data.text}</p>
        <button className="iv-btn-primary" onClick={onDismiss}>Continuar ▸</button>
      </div>
    </div>
  );
}

function MCOverlay({ data, onDismiss }) {
  const [sel, setSel] = useState(null);
  const [done, setDone] = useState(false);
  const ok = sel === data.correctId;
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-quiz-card">
        <div className="iv-badge">PREGUNTA</div>
        <p className="iv-question">{data.question}</p>
        <div className="iv-options">
          {data.options.map(o => {
            let c="iv-option";
            if(done){if(o.id===data.correctId)c+=" correct";else if(o.id===sel)c+=" wrong";else c+=" disabled";}
            else if(o.id===sel)c+=" selected";
            return <button key={o.id} className={c} onClick={()=>!done&&setSel(o.id)} disabled={done}>
              <span className="iv-option-id">{o.id.toUpperCase()}</span>
              <span className="iv-option-text">{o.text}</span>
              {done&&o.id===data.correctId&&<span className="iv-option-icon correct"><CheckIcon/></span>}
              {done&&o.id===sel&&o.id!==data.correctId&&<span className="iv-option-icon wrong"><CrossIcon/></span>}
            </button>;
          })}
        </div>
        {done&&<div className={`iv-explanation ${ok?"correct":"wrong"}`}><strong>{ok?"✓ ¡Correcto!":"✗ Incorrecto"}</strong><p>{data.explanation}</p></div>}
        {!done
          ? <button className="iv-btn-primary" style={{opacity:sel?1:0.4}} onClick={()=>sel&&setDone(true)} disabled={!sel}>Confirmar respuesta</button>
          : <button className="iv-btn-primary" onClick={onDismiss}>Continuar ▸</button>}
      </div>
    </div>
  );
}

function TFOverlay({ data, onDismiss }) {
  const [ans, setAns] = useState(null);
  const [done, setDone] = useState(false);
  const ok = ans === data.correct;
  const bc = v => { let c="iv-tf-btn"; if(done){if(v===data.correct)c+=" correct";else if(v===ans)c+=" wrong";else c+=" disabled";}else if(v===ans)c+=" selected"; return c; };
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-quiz-card iv-tf-card">
        <div className="iv-badge tf">VERDADERO O FALSO</div>
        <p className="iv-question">{data.statement}</p>
        <div className="iv-tf-row">
          <button className={bc(true)} onClick={()=>!done&&setAns(true)} disabled={done}>Verdadero</button>
          <button className={bc(false)} onClick={()=>!done&&setAns(false)} disabled={done}>Falso</button>
        </div>
        {done&&<div className={`iv-explanation ${ok?"correct":"wrong"}`}><strong>{ok?"✓ ¡Correcto!":"✗ Incorrecto"}</strong><p>{data.explanation}</p></div>}
        {!done
          ? <button className="iv-btn-primary" style={{opacity:ans!==null?1:0.4}} onClick={()=>ans!==null&&setDone(true)} disabled={ans===null}>Confirmar</button>
          : <button className="iv-btn-primary" onClick={onDismiss}>Continuar ▸</button>}
      </div>
    </div>
  );
}

function HotspotOverlay({ data, onDismiss }) {
  const [active, setActive] = useState(null);
  const [viewed, setViewed] = useState(new Set());
  const tap = s => { setActive(active?.id===s.id?null:s); setViewed(p=>new Set([...p,s.id])); };
  const allDone = viewed.size===data.spots.length;
  return (
    <div className="iv-hotspot-container">
      {data.spots.map(s=>(
        <div key={s.id}>
          <button className={`iv-hotspot-dot ${viewed.has(s.id)?"viewed":""} ${active?.id===s.id?"active":""}`}
            style={{left:`${s.x}%`,top:`${s.y}%`}} onClick={()=>tap(s)}>
            <span className="iv-hotspot-pulse"/><span className="iv-hotspot-label">{s.label}</span>
          </button>
          {active?.id===s.id&&<div className="iv-hotspot-info" style={{left:`${Math.min(s.x,55)}%`,top:`${s.y+6}%`}}>
            <strong>{s.label}</strong><p>{s.info}</p>
          </div>}
        </div>
      ))}
      <div className="iv-hotspot-bar">
        <span className="iv-hotspot-hint">Tocá los puntos ({viewed.size}/{data.spots.length})</span>
        {allDone&&<button className="iv-btn-primary iv-btn-small" onClick={onDismiss}>Continuar ▸</button>}
      </div>
    </div>
  );
}

const TYPE_COLORS = { note:"#84F4BE", "multiple-choice":"#0162F5", "true-false":"#14CCF7", hotspot:"#F59E0B" };

function TimelineMarkers({ interactions, duration }) {
  if(!duration) return null;
  return <>{interactions.map(ia=><div key={ia.id} className="iv-timeline-marker" style={{left:`${(ia.time/duration)*100}%`,background:TYPE_COLORS[ia.type]||"#fff"}}/>)}</>;
}

function SubtitleDisplay({ cues, currentTime, visible }) {
  if(!visible||!cues||!cues.length) return null;
  const c = cues.find(c=>currentTime>=c.start&&currentTime<=c.end);
  if(!c) return null;
  return <div className="iv-subtitle-container"><span className="iv-subtitle-text">{c.text}</span></div>;
}

// Main player
export default function InteractiveVideoPlayer() {
  const config = getConfig();
  const { title, vimeoId, vimeoHash, subtitlesUrl, subtitlesCues, interactions } = config;
  const containerRef = useRef(null);
  const vimeoRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolSlider, setShowVolSlider] = useState(false);
  const [isFS, setIsFS] = useState(false);
  const [fakeFS, setFakeFS] = useState(false);
  const [activeIA, setActiveIA] = useState(null);
  const [completed, setCompleted] = useState(new Set());
  const [showCtrl, setShowCtrl] = useState(true);
  const [subsOn, setSubsOn] = useState(true);
  const [cues, setCues] = useState(subtitlesCues || []);
  const [hasVimeoSubs, setHasVimeoSubs] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [skipFeedback, setSkipFeedback] = useState(null);
  const ctrlTimer = useRef(null);
  const triggered = useRef(new Set());
  const lastTapRef = useRef({ time: 0, x: 0 });
  const singleTapTimer = useRef(null);
  const lastSaveRef = useRef(0);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Parse Vimeo ID and hash from various URL formats
  const vimeoData = useMemo(()=>{
    let id = vimeoId, hash = vimeoHash || null;
    if(/^\d+$/.test(vimeoId)) return { id, hash };
    // Parse URL: vimeo.com/ID/HASH or vimeo.com/video/ID/HASH
    const m = vimeoId.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/);
    if(m) { id = m[1]; if(m[2]) hash = m[2]; }
    return { id, hash };
  },[vimeoId, vimeoHash]);

  useEffect(()=>{
    if(subtitlesUrl) fetch(subtitlesUrl).then(r=>r.text()).then(t=>setCues(parseVTT(t))).catch(()=>{});
  },[subtitlesUrl]);

  useEffect(()=>{
    if(!vimeoRef.current||playerRef.current) return;
    const opts = {
      controls: false, responsive: true,
      loop: false, muted: false, pip: false, title: false, byline: false, portrait: false, dnt: true,
    };
    if(vimeoData.hash) {
      opts.url = `https://vimeo.com/${vimeoData.id}/${vimeoData.hash}`;
    } else {
      opts.id = parseInt(vimeoData.id);
    }
    const p = new Player(vimeoRef.current, opts);
    playerRef.current = p;
    p.ready().then(()=>{
      setReady(true);
      p.getDuration().then(setDuration);
      p.getTextTracks().then(tracks=>{
        if(tracks&&tracks.length>0){
          const esTrack=tracks.find(t=>t.language==='es');
          const track=esTrack||tracks[0];
          p.enableTextTrack(track.language,track.kind).catch(()=>{});
          setHasVimeoSubs(true);
        }
      }).catch(()=>{});
    });
    p.on("timeupdate", d=>setCurrent(d.seconds));
    p.on("play", ()=>setPlaying(true));
    p.on("pause", ()=>setPlaying(false));
    p.on("ended", ()=>setPlaying(false));
    // No cleanup — Vimeo Player does not survive StrictMode destroy/recreate cycle
  },[vimeoData]);

  useEffect(()=>{
    if(!ready||activeIA) return;
    for(const ia of interactions){
      if(completed.has(ia.id)||triggered.current.has(ia.id)) continue;
      if(ia.type==="hotspot"){
        if(currentTime>=ia.time&&currentTime<=ia.time+(ia.duration||8)){
          triggered.current.add(ia.id); playerRef.current?.pause(); setActiveIA(ia); break;
        }
      } else if(Math.abs(currentTime-ia.time)<0.8){
        triggered.current.add(ia.id); playerRef.current?.pause(); setActiveIA(ia); break;
      }
    }
  },[currentTime,ready,completed,interactions,activeIA]);

  const toggleFS = useCallback(async()=>{
    const el=containerRef.current; if(!el) return;
    // Try native Fullscreen API on the container (desktop)
    try{
      if(!document.fullscreenElement&&!document.webkitFullscreenElement&&!fakeFS){
        if(el.requestFullscreen) { await el.requestFullscreen(); return; }
        if(el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
      } else if(document.fullscreenElement||document.webkitFullscreenElement){
        if(document.exitFullscreen) { await document.exitFullscreen(); return; }
        if(document.webkitExitFullscreen) { document.webkitExitFullscreen(); return; }
      }
    }catch(e){}
    // Fallback: CSS fake-fullscreen (mobile) — keeps interactions visible
    const entering=!fakeFS;
    setFakeFS(entering);
    setIsFS(entering);
    // Try to lock orientation to landscape on mobile
    try{ if(entering) await screen.orientation?.lock('landscape'); else screen.orientation?.unlock(); }catch(e){}
  },[fakeFS]);

  useEffect(()=>{
    const h=()=>setIsFS(!!(document.fullscreenElement||document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange",h);
    document.addEventListener("webkitfullscreenchange",h);
    return()=>{document.removeEventListener("fullscreenchange",h);document.removeEventListener("webkitfullscreenchange",h);};
  },[]);

  // Keyboard shortcuts
  useEffect(()=>{
    const handleKey=(e)=>{
      if(activeIA) return;
      switch(e.key){
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); skip(-10); break;
        case 'ArrowRight': e.preventDefault(); skip(10); break;
        case 'ArrowUp': e.preventDefault(); changeVolume(Math.min(1,volume+0.1)); break;
        case 'ArrowDown': e.preventDefault(); changeVolume(Math.max(0,volume-0.1)); break;
        case 'f': case 'F': toggleFS(); break;
        case 'm': case 'M': toggleMute(); break;
        case 'c': case 'C': toggleSubs(); break;
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>document.removeEventListener('keydown',handleKey);
  },[activeIA,playing,volume,muted,subsOn]);

  // Load progress from localStorage
  useEffect(()=>{
    if(!ready) return;
    try{
      const saved=localStorage.getItem(`iv_progress_${vimeoData.id}`);
      if(saved){
        const data=JSON.parse(saved);
        if(data.completed){setCompleted(new Set(data.completed));data.completed.forEach(id=>triggered.current.add(id));}
        if(data.currentTime&&playerRef.current) playerRef.current.setCurrentTime(data.currentTime);
      }
    }catch(e){}
  },[ready]);

  // Save progress to localStorage (throttled)
  useEffect(()=>{
    if(!ready) return;
    if(Date.now()-lastSaveRef.current<5000) return;
    lastSaveRef.current=Date.now();
    try{
      localStorage.setItem(`iv_progress_${vimeoData.id}`,JSON.stringify({
        completed:[...completed],currentTime,updatedAt:Date.now()
      }));
    }catch(e){}
  },[completed,currentTime,ready,vimeoData.id]);

  const resetCtrl = useCallback(()=>{
    setShowCtrl(true); clearTimeout(ctrlTimer.current);
    if(playing&&!activeIA) ctrlTimer.current=setTimeout(()=>setShowCtrl(false), fakeFS?2500:3000);
  },[playing,activeIA,fakeFS]);

  const togglePlay=()=>{const p=playerRef.current;if(!p||!ready)return;playing?p.pause():p.play();};
  const skip=(seconds)=>{
    const p=playerRef.current;if(!p||!ready)return;
    let targetTime=Math.max(0,Math.min(duration,currentTime+seconds));
    if(seconds>0){
      const next=interactions.filter(ia=>!completed.has(ia.id)&&ia.time>currentTime&&ia.time<=targetTime).sort((a,b)=>a.time-b.time)[0];
      if(next) targetTime=next.time;
    }
    p.setCurrentTime(targetTime);
  };
  const toggleMute=()=>{const p=playerRef.current;if(!p)return;const m=!muted;p.setVolume(m?0:volume);setMuted(m);};
  const changeVolume=(v)=>{const p=playerRef.current;if(!p)return;setVolume(v);p.setVolume(v);setMuted(v===0);};
  const seek=(e)=>{
    const r=e.currentTarget.getBoundingClientRect();
    const pct=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    let targetTime=pct*duration;
    const next=interactions.filter(ia=>!completed.has(ia.id)&&ia.time>currentTime&&ia.time<=targetTime).sort((a,b)=>a.time-b.time)[0];
    if(next) targetTime=next.time;
    playerRef.current?.setCurrentTime(targetTime);
  };
  const changeSpeed=(rate)=>{playerRef.current?.setPlaybackRate(rate);setSpeed(rate);setShowSpeedMenu(false);};
  const toggleSubs=()=>{
    const next=!subsOn;
    setSubsOn(next);
    if(hasVimeoSubs){
      const p=playerRef.current;
      if(!next) p?.disableTextTrack().catch(()=>{});
      else p?.getTextTracks().then(tracks=>{
        if(tracks.length){const t=tracks.find(t=>t.language==='es')||tracks[0];p.enableTextTrack(t.language,t.kind).catch(()=>{});}
      });
    }
  };

  // Touch double-tap handler (mobile only, separate from click)
  const handleTouchEnd=(e)=>{
    if(activeIA) return;
    const now=Date.now();
    const rect=containerRef.current.getBoundingClientRect();
    const touch=e.changedTouches?.[0];
    if(!touch) return;
    const x=touch.clientX;
    const isLeft=(x-rect.left)<rect.width/2;
    if(now-lastTapRef.current.time<300){
      // Double tap — skip ±10s and cancel the pending single-tap play/pause
      e.preventDefault();
      clearTimeout(singleTapTimer.current);
      skip(isLeft?-10:10);
      setSkipFeedback(isLeft?'left':'right');
      setTimeout(()=>setSkipFeedback(null),600);
      lastTapRef.current={time:0,x};
    } else {
      // First tap — wait to see if a second tap comes; if not, toggle play
      singleTapTimer.current=setTimeout(()=>togglePlay(),300);
      lastTapRef.current={time:now,x};
    }
  };
  // Desktop click — immediate play/pause
  const handleClickLayer=()=>{
    // On mobile, touchEnd already handles it; skip if recently touched
    if(Date.now()-lastTapRef.current.time<400) return;
    togglePlay();
  };

  const dismiss=()=>{
    if(activeIA){setCompleted(p=>new Set([...p,activeIA.id]));setActiveIA(null);playerRef.current?.play();}
  };

  const resetProgress=()=>{
    localStorage.removeItem(`iv_progress_${vimeoData.id}`);
    setCompleted(new Set());
    triggered.current=new Set();
    playerRef.current?.setCurrentTime(0);
  };

  const progress=duration?(currentTime/duration)*100:0;
  const hasCues=cues&&cues.length>0;

  return (
    <div className={`iv-wrapper ${fakeFS?"fake-fs":""}`}>
      <div className="iv-top-bar">
        <span className="iv-top-title">{title}</span>
        <span className="iv-top-progress">{completed.size}/{interactions.length} actividades</span>
      </div>
      <div ref={containerRef} className={`iv-container ${isFS&&!fakeFS?"fullscreen":""}`}
        onMouseMove={resetCtrl} onTouchStart={resetCtrl}>

        <div ref={vimeoRef} className="iv-vimeo-wrap"/>
        {ready&&!activeIA&&<div className="iv-click-layer" onClick={handleClickLayer} onTouchStart={resetCtrl} onTouchEnd={handleTouchEnd}/>}
        {skipFeedback&&<div className={`iv-skip-feedback ${skipFeedback}`}>{skipFeedback==='left'?'⟲ 10s':'10s ⟳'}</div>}
        {!ready&&<div className="iv-loading"><div className="iv-spinner"/><span>Cargando video...</span></div>}
        {ready&&!playing&&!activeIA&&<button className="iv-big-play" onClick={togglePlay}><PlayIcon/></button>}

        {!hasVimeoSubs&&<SubtitleDisplay cues={cues} currentTime={currentTime} visible={subsOn&&!activeIA}/>}

        {activeIA?.type==="note"&&<NoteOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="multiple-choice"&&<MCOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="true-false"&&<TFOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="hotspot"&&<HotspotOverlay data={activeIA.data} onDismiss={dismiss}/>}

        <div className={`iv-controls ${showCtrl||!playing||activeIA?"visible":""}`}>
          <div className="iv-progress-container" onClick={seek}>
            <div className="iv-progress-track">
              <TimelineMarkers interactions={interactions} duration={duration}/>
              <div className="iv-progress-fill" style={{width:`${progress}%`}}/>
              <div className="iv-progress-thumb" style={{left:`${progress}%`}}/>
            </div>
          </div>
          <div className="iv-controls-row">
            <button className="iv-ctrl-btn" onClick={togglePlay}>{playing?<PauseIcon/>:<PlayIcon/>}</button>
            <button className="iv-ctrl-btn" onClick={()=>skip(-10)}><SkipBackIcon/></button>
            <button className="iv-ctrl-btn" onClick={()=>skip(10)}><SkipFwdIcon/></button>
            <div className="iv-volume-group" onMouseEnter={()=>setShowVolSlider(true)} onMouseLeave={()=>setShowVolSlider(false)}>
              <button className="iv-ctrl-btn" onClick={toggleMute}><VolumeIcon muted={muted}/></button>
              {showVolSlider&&<div className="iv-volume-slider-wrap">
                <input type="range" className="iv-volume-slider" min="0" max="1" step="0.05"
                  value={muted?0:volume} onChange={e=>changeVolume(parseFloat(e.target.value))}/>
              </div>}
            </div>
            <span className="iv-time">{fmt(currentTime)} / {fmt(duration)}</span>
            <div style={{flex:1}}/>
            {(hasCues||hasVimeoSubs)&&<button className="iv-ctrl-btn" onClick={toggleSubs}><SubsIcon on={subsOn}/></button>}
            <div className="iv-speed-group">
              <button className="iv-ctrl-btn iv-speed-btn" onClick={()=>setShowSpeedMenu(!showSpeedMenu)}>{speed}x</button>
              {showSpeedMenu&&<div className="iv-speed-menu">
                {SPEEDS.map(s=><button key={s} className={`iv-speed-option ${s===speed?'active':''}`} onClick={()=>changeSpeed(s)}>{s}x</button>)}
              </div>}
            </div>
            <button className="iv-ctrl-btn" onClick={toggleFS}>{isFS?<ExitFullscreenIcon/>:<FullscreenIcon/>}</button>
          </div>
        </div>
      </div>
      <div className="iv-legend">
        <span className="iv-legend-title">Marcadores:</span>
        {Object.entries(TYPE_COLORS).map(([t,c])=><span key={t} className="iv-legend-item">
          <span className="iv-legend-dot" style={{background:c}}/>{t==="multiple-choice"?"MC":t==="true-false"?"V/F":t==="hotspot"?"Hotspot":"Nota"}
        </span>)}
        {completed.size>0&&<button className="iv-reset-btn" onClick={resetProgress}>Reiniciar progreso</button>}
      </div>
    </div>
  );
}
