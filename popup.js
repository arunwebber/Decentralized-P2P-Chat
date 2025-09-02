// WebRTC P2P with manual signaling. Omegle-style controls.
const els = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
const el = (sel, root=document)=>root.querySelector(sel);

const state = {
  pc: null,
  dc: null,
  localStream: null,
  remoteStream: null,
  connected: false,
  lineCount: 1
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
  // Simple approximation of line numbers beside the chat log
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
  const wantAudio = el('#audioToggle').checked;
  const wantVideo = el('#videoToggle').checked;
  if (!wantAudio && !wantVideo) return null;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: wantVideo });
    el('#localVideo').srcObject = stream;
    return stream;
  }catch(e){ console.error(e); addMsg('Could not access mic/cam: '+e.message,'them'); return null; }
}

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

function sendMessage(){
  const i = el('#msgInput');
  const text = i.value.trim();
  if (!text || !state.dc || state.dc.readyState !== 'open') return;
  state.dc.send(text);
  addMsg(text,'me');
  i.value = '';
}

function copyLocal(){
  const ta = el('#localSDP');
  ta.select(); ta.setSelectionRange(0, 99999);
  document.execCommand('copy');
}

function muteToggle(){ if (!state.localStream) return; state.localStream.getAudioTracks().forEach(t=>t.enabled = !t.enabled); }
function camToggle(){ if (!state.localStream) return; state.localStream.getVideoTracks().forEach(t=>t.enabled = !t.enabled); }

function cleanup(){
  try{ if (state.dc) state.dc.close(); }catch(_){};
  try{ if (state.pc) state.pc.close(); }catch(_){};
  if (state.localStream){ state.localStream.getTracks().forEach(t=>t.stop()); }
  state.pc = null; state.dc = null; state.localStream = null; state.remoteStream = null; state.connected = false;
  el('#remoteVideo').srcObject = null; el('#localVideo').srcObject = null;
}

function leave(){
  cleanup();
  setStatus('Left chat.');
}

function next(){ leave(); start(); }

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

function bindUI(){
  el('#startBtn').addEventListener('click', start);
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

  // right panel tabs
  els('.rightTab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      els('.rightTab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      els('.rightTabContent').forEach(p=>p.style.display='none');
      el('#'+btn.dataset.tab).style.display='block';
    });
  });

  // font size shortcuts — persist per session only (simple)
  let base = 1;
  el('#increaseFont').addEventListener('click', ()=>{ base = Math.min(1.4, base + 0.05); document.body.style.fontSize = base+'em';});
  el('#decreaseFont').addEventListener('click', ()=>{ base = Math.max(0.8, base - 0.05); document.body.style.fontSize = base+'em';});

  darkModeInit();
  updateLineNumbers();
}

document.addEventListener('DOMContentLoaded', bindUI);
