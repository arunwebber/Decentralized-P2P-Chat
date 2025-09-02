// Based largely on your original working code (manual signaling) with a safe, optional Tracker mode.
// Original base restored from your uploaded popup.js. :contentReference[oaicite:5]{index=5}

const els = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
const el = (sel, root=document)=>root.querySelector(sel);

const state = {
  pc: null,
  dc: null,
  localStream: null,
  remoteStream: null,
  connected: false,
  lineCount: 1,
  trackerClient: null,   // optional tracker client
  trackerPeer: null      // peer object from tracker (if any)
};

function setStatus(txt){ el('#status').textContent = txt; }
function addMsg(text, who='them'){
  const m = document.createElement('div');
  m.className = `msg ${who}`;
  m.textContent = text;
  el('#messages').appendChild(m);
  el('#messages').scrollTop = el('#messages').scrollHeight;
  updateLineNumbers();
}

function updateLineNumbers(){
  const lines = Math.max(1, Math.ceil(el('#messages').scrollHeight / 20));
  state.lineCount = lines;
  el('#lineNumbers').textContent = Array.from({length:lines}, (_,i)=>i+1).join('\n');
}

function darkModeInit(){
  const toggle = el('#darkModeToggle');
  const curr = localStorage.getItem('darkMode');
  if (curr === 'enabled') { document.body.classList.add('dark-mode'); toggle.checked = true; }
  toggle.addEventListener('change', ()=>{
    if (toggle.checked){ document.body.classList.add('dark-mode'); localStorage.setItem('darkMode','enabled'); }
    else { document.body.classList.remove('dark-mode'); localStorage.setItem('darkMode','disabled'); }
  });
}

async function getMediaIfEnabled(){
  const wantAudio = el('#audioToggle') ? el('#audioToggle').checked : true;
  const wantVideo = el('#videoToggle') ? el('#videoToggle').checked : false;
  if (!wantAudio && !wantVideo) return null;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: wantVideo });
    el('#localVideo').srcObject = stream;
    return stream;
  }catch(e){ console.error(e); addMsg('Could not access mic/cam: '+e.message,'them'); return null; }
}

// ------------------ Manual Signaling (original code) ------------------
function createPeer(){
  const stun = el('#stunInput').value || 'stun:stun.stunprotocol.org:3478';
  const pc = new RTCPeerConnection({ iceServers:[{ urls: stun }] });
  state.pc = pc;

  state.remoteStream = new MediaStream();
  el('#remoteVideo').srcObject = state.remoteStream;

  pc.onicecandidate = (e)=>{
    if (!e.candidate) {
      // when gathering is complete, expose local SDP
      el('#localSDP').value = JSON.stringify(pc.localDescription);
    }
  };

  pc.onconnectionstatechange = ()=>{
    setStatus('Connection: '+pc.connectionState);
    if (pc.connectionState === 'connected') { state.connected = true; }
    if (["disconnected","failed","closed"].includes(pc.connectionState)) { state.connected = false; }
  };

  pc.ontrack = (e)=>{ e.streams[0].getTracks().forEach(t=>state.remoteStream.addTrack(t)); };

  pc.ondatachannel = (evt)=>{ state.dc = evt.channel; bindDC(); };
}

function bindDC(){
  if (!state.dc) return;
  state.dc.onopen = ()=>{ setStatus('Connected'); addMsg('You are now connected to a stranger. Say hi!','them'); };
  state.dc.onclose = ()=>{ setStatus('Channel closed'); };
  state.dc.onmessage = (e)=>{ addMsg(e.data,'them'); };
}

async function start(){
  // Manual: create offer
  if (state.pc) cleanup();
  createPeer();

  // media
  const ms = await getMediaIfEnabled();
  if (ms){ ms.getTracks().forEach(t=>state.pc.addTrack(t, ms)); state.localStream = ms; }

  // create our own data channel (caller side)
  state.dc = state.pc.createDataChannel('chat');
  bindDC();

  const offer = await state.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await state.pc.setLocalDescription(offer);
  setStatus('Offer created. Share it to the stranger.');
}

async function applyAnswer(){
  const val = el('#remoteSDP').value.trim();
  if (!val){ alert('Paste the answer SDP first.'); return; }
  try{
    const desc = JSON.parse(val);
    await state.pc.setRemoteDescription(desc);
    setStatus('Answer applied. Connecting…');
  }catch(e){ alert('Invalid answer: '+e.message); }
}

async function generateAnswer(){
  const val = el('#remoteSDP').value.trim();
  if (!val){ alert('Paste the offer SDP first.'); return; }
  try{
    if (state.pc) cleanup();
    createPeer();
    const ms = await getMediaIfEnabled();
    if (ms){ ms.getTracks().forEach(t=>state.pc.addTrack(t, ms)); state.localStream = ms; }

    const offer = JSON.parse(val);
    await state.pc.setRemoteDescription(offer);
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    el('#localSDP').value = JSON.stringify(state.pc.localDescription);
    setStatus('Answer generated. Send back to the stranger.');
  }catch(e){ alert('Invalid offer: '+e.message); }
}

function copyLocal(){
  const ta = el('#localSDP');
  if (!ta) return;
  ta.select(); ta.setSelectionRange(0, 99999);
  document.execCommand('copy');
}

// ------------------ Tracker Mode (optional, safe) ------------------
// NOTE: tracker mode will only work if you include the browser UMD builds inside lib/
// - lib/simplepeer.min.js  (exposes SimplePeer global)
// - lib/bittorrent-tracker.min.js (exposes Client global)
// If they are not present, tracker mode will inform the user and not crash.

function getDefaultTrackers(){
  return [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz',
    'wss://tracker.webtorrent.dev'
  ];
}

function getTrackersList(){
  const saved = localStorage.getItem('trackers');
  if (saved && saved.trim()) return saved.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return getDefaultTrackers();
}

function startTrackerMode(){
  // detection of browser globals (be tolerant to different UMD naming)
  const TrackerClient = window.Client || window.bittorrentTrackerClient || window.BittorrentTrackerClient || window.bittorrentTracker || null;
  const SimplePeerGlobal = window.SimplePeer || window.SimplePeerDefault || window.SimplePeerLib || null;

  if (!TrackerClient || !SimplePeerGlobal){
    addMsg('Tracker libraries not found. To enable Tracker mode, add browser builds of simple-peer and bittorrent-tracker to lib/.','them');
    setStatus('Tracker unavailable');
    return;
  }

  // safe destroy any existing client/pc
  if (state.trackerClient && state.trackerClient.destroy) {
    try{ state.trackerClient.destroy(); }catch(_){}
    state.trackerClient = null;
  }
  if (state.trackerPeer && state.trackerPeer.destroy) {
    try{ state.trackerPeer.destroy(); }catch(_){}
    state.trackerPeer = null;
  }

  // prepare announce list
  const announce = getTrackersList();
  const peerId = 'p-' + Math.random().toString(36).substr(2, 9);
  const infoHash = 'strangerchatroom00000001'; // simple swarm id (not a real torrent hash but accepted by some tracker libs)

  try{
    // instantiate tracker client using the detected global Client
    const client = new TrackerClient({
      infoHash,
      peerId,
      announce
    });

    state.trackerClient = client;
    setStatus('Searching for peers (tracker)...');
    addMsg('Searching for a stranger (tracker mode)...', 'them');

    client.on('error', (err) => {
      console.warn('tracker error', err);
      addMsg('Tracker error: '+(err && err.message ? err.message : err), 'them');
      setStatus('Tracker error');
    });

    client.on('warning', (err) => {
      console.warn('tracker warning', err);
    });

    // when tracker finds a remote peer this event fires. Many tracker libs emit 'peer'.
    client.on('peer', (peer) => {
      // 'peer' is usually an object that speaks the simple-peer-like API (signal/send/data/connect)
      console.log('Tracker found peer', peer);
      if (state.trackerPeer) {
        // already connected to another peer; ignore extras
        return;
      }
      bindTrackerPeer(peer);
    });

    client.start(); // some clients require start(); if client doesn't have start, it's OK
  }catch(e){
    console.error('failed to start tracker client', e);
    addMsg('Failed to start tracker client: '+e.message, 'them');
    setStatus('Tracker init failed');
  }
}

function bindTrackerPeer(peer){
  // store
  state.trackerPeer = peer;

  // many tracker 'peer' objects have .on / .signal / .send semantics (similar to simple-peer)
  if (peer.on) {
    // forwarding 'signal' emitted by the real peer to tracker's signal method
    try{
      peer.on('signal', data=>{
        try{
          if (state.trackerClient && state.trackerClient.signal) state.trackerClient.signal(data);
        }catch(_){}
      });
    }catch(_){}
    try{ peer.on('connect', ()=>{ setStatus('Connected (tracker)'); addMsg('Connected to stranger (tracker).','them'); state.dc = peer; }); }catch(_){}
    try{ peer.on('data', (d)=>{ addMsg((d && d.toString)?d.toString():String(d), 'them'); }); }catch(_){}
  } else {
    // unknown shape — try commonly available helpers
    if (peer.onmessage) {
      peer.onmessage = (e)=> addMsg(e.data,'them');
      setStatus('Connected (tracker)');
      state.dc = peer;
    } else {
      addMsg('Connected to peer (tracker) — but peer API shape is unfamiliar; check tracker build compatibility.', 'them');
    }
  }
}

// ------------------ Send / UI / Controls (shared) ------------------
function sendMessage(){
  const i = el('#msgInput');
  const text = i.value.trim();
  if (!text) return;

  // prefer datachannel (manual) then tracker peer
  try{
    if (state.dc && (state.dc.readyState === 'open' || state.dc.readyState === 'open')) {
      // RTCDataChannel case
      state.dc.send(text);
      addMsg(text,'me');
      i.value = '';
      return;
    }
  }catch(e){ /* continue to try tracker peer */ }

  // tracker peer 'send' method (some libs expose send)
  try{
    if (state.trackerPeer && state.trackerPeer.send) {
      state.trackerPeer.send(text);
      addMsg(text,'me');
      i.value = '';
      return;
    }
  }catch(e){ console.error(e); }

  addMsg('Not connected to a stranger. Start a session first.','them');
}

function muteToggle(){ if (!state.localStream) return; state.localStream.getAudioTracks().forEach(t=>t.enabled = !t.enabled); }
function camToggle(){ if (!state.localStream) return; state.localStream.getVideoTracks().forEach(t=>t.enabled = !t.enabled); }

function cleanup(){
  try{ if (state.dc) state.dc.close && state.dc.close(); }catch(_){};
  try{ if (state.pc) state.pc.close(); }catch(_){};
  try{ if (state.trackerPeer) state.trackerPeer.destroy && state.trackerPeer.destroy(); }catch(_){};
  try{ if (state.trackerClient) state.trackerClient.destroy && state.trackerClient.destroy(); }catch(_){};
  if (state.localStream){ state.localStream.getTracks().forEach(t=>t.stop()); }
  state.pc = null; state.dc = null; state.localStream = null; state.remoteStream = null; state.connected = false;
  state.trackerClient = null; state.trackerPeer = null;
  el('#remoteVideo').srcObject = null; el('#localVideo').srcObject = null;
}

function leave(){
  cleanup();
  setStatus('Left chat.');
}

function next(){ 
  leave();
  // if tracker mode is selected, start tracker; otherwise start manual (new offer)
  const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
  if (mode === 'tracker') startTrackerMode();
  else start();
}

function saveLog(){
  const text = els('.msg').map(n=> (n.classList.contains('me')?'Me: ':'Stranger: ')+n.textContent).join('\n');
  const blob = new Blob([text], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `chat-${new Date().toISOString()}.txt`; a.click(); URL.revokeObjectURL(url);
}

function printLog(){
  const w = window.open('', '_blank');
  const msgs = els('.msg').map(n=> (n.classList.contains('me')?'Me: ':'Stranger: ')+n.textContent).join('\n');
  const esc = (s)=>s.replace(/[&<>]/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]));
  w.document.write(`<pre>${esc(msgs)}</pre>`);
  w.document.close(); w.focus(); w.print(); w.close();
}

// ------------------ Tracker Settings ------------------
function saveTrackers(){
  const list = (el('#trackerList') && el('#trackerList').value) ? el('#trackerList').value.trim() : '';
  localStorage.setItem('trackers', list);
  addMsg('Tracker list saved.', 'them');
  setStatus('Tracker list saved');
}

function restoreDefaultTrackers(){
  el('#trackerList').value = getDefaultTrackers().join('\n');
  saveTrackers();
}

// ------------------ UI binding ------------------
function bindUI(){
  el('#startBtn').addEventListener('click', ()=>{
    const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
    if (mode === 'manual') start();
    else startTrackerMode();
  });

  el('#applyAnswerBtn').addEventListener('click', applyAnswer);
  el('#generateAnswerBtn').addEventListener('click', generateAnswer);
  el('#copyOfferBtn').addEventListener('click', copyLocal);
  el('#sendBtn').addEventListener('click', sendMessage);
  el('#downloadBtn').addEventListener('click', saveLog);
  el('#printBtn').addEventListener('click', printLog);
  el('#muteBtn').addEventListener('click', muteToggle);
  el('#camBtn').addEventListener('click', camToggle);
  el('#leaveBtn').addEventListener('click', leave);
  el('#nextBtn').addEventListener('click', next);
  el('#haveOfferBtn').addEventListener('click', ()=>{ el('#remoteSDP').focus(); });

  el('#saveTrackersBtn').addEventListener('click', saveTrackers);
  el('#restoreDefaultTrackersBtn').addEventListener('click', restoreDefaultTrackers);

  // right panel tabs
  els('.rightTab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      els('.rightTab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      els('.rightTabContent').forEach(p=>p.style.display='none');
      el('#'+btn.dataset.tab).style.display='block';
    });
  });

  // show/hide manual UI depending on mode
  els('input[name="sigMode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
      const manualBox = el('.manualBox') ? el('.manualBox').closest('details') || null : null;
      if (manualBox) manualBox.style.display = (mode === 'manual') ? 'block' : 'none';
    });
  });

  // font size shortcuts — persist per session only (simple)
  let base = 1;
  el('#increaseFont').addEventListener('click', ()=>{ base = Math.min(1.4, base + 0.05); document.body.style.fontSize = base+'em';});
  el('#decreaseFont').addEventListener('click', ()=>{ base = Math.max(0.8, base - 0.05); document.body.style.fontSize = base+'em';});

  darkModeInit();
  updateLineNumbers();

  // preload trackers into settings UI
  const trackers = localStorage.getItem('trackers') || getDefaultTrackers().join('\n');
  if (el('#trackerList')) el('#trackerList').value = trackers.trim();
}

document.addEventListener('DOMContentLoaded', bindUI);
