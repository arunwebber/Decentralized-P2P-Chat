// A modular, class-based architecture for the WebRTC P2P chat.

// --- Helper Functions ---
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (sel, root = document) => root.querySelector(sel);

// --- Class 1: ChatState ---
class ChatState {
    constructor() {
        this.pc = null;
        this.dc = null;
        this.localStream = null;
        this.remoteStream = null;
        this.screenStream = null;
        this.connected = false;
        this.trackerClient = null;
        this.trackerPeer = null;
        
        // File transfer state
        this.fileState = {
            sending: false,
            receiving: false,
            chunks: [],
            metadata: null,
            receivedSize: 0
        };
    }

    cleanup() {
        try { if (this.dc) this.dc.close && this.dc.close(); } catch (_) { }
        try { if (this.pc) this.pc.close(); } catch (_) { }
        try { if (this.trackerPeer) this.trackerPeer.destroy && this.trackerPeer.destroy(); } catch (_) { }
        try { if (this.trackerClient) this.trackerClient.destroy && this.trackerClient.destroy(); } catch (_) { }
        if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); }

        this.pc = null;
        this.dc = null;
        this.localStream = null;
        this.remoteStream = null;
        this.screenStream = null;
        this.connected = false;
        this.trackerClient = null;
        this.trackerPeer = null;
        el('#remoteVideo').srcObject = null;
        el('#localVideo').srcObject = null;
        
        // Hide chat controls
        el('#chatControls').style.display = 'none';
        
        // Reset button states
        el('#voiceCallBtn').style.display = 'inline-block';
        el('#videoCallBtn').style.display = 'inline-block';
        el('#endCallBtn').style.display = 'none';
        el('#screenBtn').textContent = '🖥️';
        el('#muteBtn').textContent = '🔇';
        el('#muteBtn').classList.remove('active');
        el('#camBtn').textContent = '📷';
        el('#camBtn').classList.remove('active');
    }
}

// --- Class 2: UIHandler ---
class UIHandler {
    constructor(state) {
        this.state = state;
        this.bindEvents();
        this.darkModeInit();
    }

    setStatus(txt) { 
        el('#status').textContent = txt; 
    }
    
    addMsg(text, who = 'them') {
        const m = document.createElement('div');
        m.className = `msg ${who}`;
        m.textContent = text;
        el('#messages').appendChild(m);
        el('#messages').scrollTop = el('#messages').scrollHeight;
    }
    
    addFileLink(name, url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.textContent = `📎 ${name}`;
        a.className = 'file-link';
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg them';
        msgDiv.appendChild(a);
        el('#messages').appendChild(msgDiv);
        el('#messages').scrollTop = el('#messages').scrollHeight;
    }

    darkModeInit() {
        const toggle = el('#darkModeToggle');
        const curr = localStorage.getItem('darkMode');
        if (curr === 'enabled') { 
            document.body.classList.add('dark-mode'); 
            toggle.checked = true; 
        }
        toggle.addEventListener('change', () => {
            if (toggle.checked) { 
                document.body.classList.add('dark-mode'); 
                localStorage.setItem('darkMode', 'enabled'); 
            } else { 
                document.body.classList.remove('dark-mode'); 
                localStorage.setItem('darkMode', 'disabled'); 
            }
        });
    }

    bindEvents() {
        // Tab switching
        els('.rightTab').forEach(btn => {
            btn.addEventListener('click', () => {
                els('.rightTab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                els('.rightTabContent').forEach(p => p.style.display = 'none');
                el('#' + btn.dataset.tab).style.display = 'block';
            });
        });

        // Signaling mode toggle
        els('input[name="sigMode"]').forEach(r => {
            r.addEventListener('change', () => {
                const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
                const manualBox = el('.manualBox');
                if (manualBox) manualBox.style.display = (mode === 'manual') ? 'block' : 'none';
            });
        });
    }
    
    showFileProgress(filename, sending = true) {
        el('#fileProgress').style.display = 'block';
        el('#fileName').textContent = `${sending ? 'Sending' : 'Receiving'}: ${filename}`;
        el('#fileStatus').textContent = '0%';
        el('#progressBar').value = 0;
    }
    
    updateFileProgress(progress) {
        el('#progressBar').value = progress;
        el('#fileStatus').textContent = `${progress}%`;
    }
    
    hideFileProgress() {
        setTimeout(() => el('#fileProgress').style.display = 'none', 2000);
    }
}

// --- Class 3: WebRTCManager ---
class WebRTCManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }

    async getMediaIfEnabled() {
        const wantAudio = el('#audioToggle') ? el('#audioToggle').checked : true;
        const wantVideo = el('#videoToggle') ? el('#videoToggle').checked : false;
        if (!wantAudio && !wantVideo) return null;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: wantVideo });
            el('#localVideo').srcObject = stream;
            return stream;
        } catch (e) {
            console.error(e);
            this.ui.addMsg('Could not access mic/cam: ' + e.message, 'them');
            return null;
        }
    }

    createPeer(onIceCandidate, onDataChannel, onTrack) {
        const stun = el('#stunInput').value || 'stun:stun.stunprotocol.org:3478';
        this.state.pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] });
        this.state.remoteStream = new MediaStream();
        el('#remoteVideo').srcObject = this.state.remoteStream;

        this.state.pc.onicecandidate = onIceCandidate;
        this.state.pc.ondatachannel = onDataChannel;
        this.state.pc.ontrack = onTrack;
        this.state.pc.onconnectionstatechange = () => {
            this.ui.setStatus('Connection: ' + this.state.pc.connectionState);
            if (this.state.pc.connectionState === 'connected') { 
                this.state.connected = true; 
            }
            if (["disconnected", "failed", "closed"].includes(this.state.pc.connectionState)) { 
                this.state.connected = false; 
            }
        };
    }

    bindDC() {
        if (!this.state.dc) return;
        
        this.state.dc.onopen = () => { 
            this.ui.setStatus('Connected'); 
            this.ui.addMsg('You are now connected to a stranger. Say hi!', 'them');
            // Show chat controls when connected
            el('#chatControls').style.display = 'flex';
        };
        
        this.state.dc.onclose = () => { 
            this.ui.setStatus('Channel closed');
            // Hide chat controls when disconnected
            el('#chatControls').style.display = 'none';
        };
        
        this.state.dc.onmessage = (e) => { 
            // Handle different types of messages
            if (typeof e.data === 'string') {
                try {
                    const data = JSON.parse(e.data);
                    
                    if (data.type === 'file-metadata') {
                        // Receiving file metadata
                        this.state.fileState.receiving = true;
                        this.state.fileState.metadata = data;
                        this.state.fileState.chunks = [];
                        this.state.fileState.receivedSize = 0;
                        this.ui.showFileProgress(data.name, false);
                        
                    } else if (data.type === 'file-complete') {
                        // File transfer complete
                        if (this.state.fileState.receiving) {
                            const blob = new Blob(this.state.fileState.chunks, { 
                                type: this.state.fileState.metadata.mimeType 
                            });
                            const url = URL.createObjectURL(blob);
                            this.ui.addFileLink(this.state.fileState.metadata.name, url);
                            this.ui.hideFileProgress();
                            this.state.fileState.receiving = false;
                        }
                    }
                } catch {
                    // Regular text message
                    this.ui.addMsg(e.data, 'them');
                }
            } else if (e.data instanceof ArrayBuffer && this.state.fileState.receiving) {
                // Receiving file chunk
                this.state.fileState.chunks.push(e.data);
                this.state.fileState.receivedSize += e.data.byteLength;
                
                const progress = Math.round((this.state.fileState.receivedSize / this.state.fileState.metadata.size) * 100);
                this.ui.updateFileProgress(progress);
            }
        };
    }
}

// --- Class 4: FileTransferManager ---
class FileTransferManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
        this.setupFileInput();
    }
    
    setupFileInput() {
        const fileBtn = el('#fileBtn');
        const fileInput = el('#fileInput');
        
        if (fileBtn && fileInput) {
            fileBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.sendFile(file);
                e.target.value = ''; // Reset input
            });
        }
    }
    
    async sendFile(file) {
        if (!this.state.dc || this.state.dc.readyState !== 'open') {
            this.ui.addMsg('Not connected. Cannot send file.', 'them');
            return;
        }
        
        const chunkSize = 16384; // 16KB chunks
        const metadata = {
            type: 'file-metadata',
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream'
        };
        
        // Send metadata first
        this.state.dc.send(JSON.stringify(metadata));
        
        // Show progress
        this.ui.showFileProgress(file.name, true);
        
        // Add delay to ensure metadata is received first
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Read and send file in chunks
        let offset = 0;
        
        const sendNextChunk = async () => {
            if (offset >= file.size) {
                // Send completion signal
                this.state.dc.send(JSON.stringify({ type: 'file-complete' }));
                this.ui.addMsg(`Sent file: ${file.name}`, 'me');
                this.ui.hideFileProgress();
                return;
            }
            
            // Check if data channel buffer is not full
            if (this.state.dc.bufferedAmount > 65536) { // 64KB buffer threshold
                // Wait for buffer to drain
                setTimeout(() => sendNextChunk(), 50);
                return;
            }
            
            const slice = file.slice(offset, Math.min(offset + chunkSize, file.size));
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    this.state.dc.send(e.target.result);
                    offset += e.target.result.byteLength;
                    
                    const progress = Math.round((offset / file.size) * 100);
                    this.ui.updateFileProgress(progress);
                    
                    // Send next chunk
                    setTimeout(() => sendNextChunk(), 10);
                } catch (err) {
                    console.error('Error sending chunk:', err);
                    this.ui.addMsg('File transfer failed', 'them');
                    this.ui.hideFileProgress();
                }
            };
            
            reader.onerror = () => {
                this.ui.addMsg('Error reading file', 'them');
                this.ui.hideFileProgress();
            };
            
            reader.readAsArrayBuffer(slice);
        };
        
        // Start sending
        sendNextChunk();
    }
}

// --- Class 5: TrackerManager ---
class TrackerManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }
    
    getDefaultTrackers() {
        return [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.fastcast.nz',
            'wss://tracker.webtorrent.dev'
        ];
    }
    
    getTrackersList() {
        const saved = localStorage.getItem('trackers');
        if (saved && saved.trim()) return saved.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        return this.getDefaultTrackers();
    }
    
    saveTrackers() {
        const list = (el('#trackerList') && el('#trackerList').value) ? el('#trackerList').value.trim() : '';
        localStorage.setItem('trackers', list);
        this.ui.addMsg('Tracker list saved.', 'them');
        this.ui.setStatus('Tracker list saved');
    }
    
    restoreDefaultTrackers() {
        el('#trackerList').value = this.getDefaultTrackers().join('\n');
        this.saveTrackers();
    }
    
    startTrackerMode() {
        // Detection of browser globals
        const TrackerClient = window.Client || window.bittorrentTrackerClient || window.BittorrentTrackerClient || window.bittorrentTracker || null;
        const SimplePeerGlobal = window.SimplePeer || window.SimplePeerDefault || window.SimplePeerLib || null;
        
        if (!TrackerClient || !SimplePeerGlobal) {
            this.ui.addMsg('Tracker libraries not found. To enable Tracker mode, add browser builds of simple-peer and bittorrent-tracker to lib/.', 'them');
            this.ui.setStatus('Tracker unavailable');
            return;
        }
        
        // Safe destroy any existing client/pc
        if (this.state.trackerClient && this.state.trackerClient.destroy) {
            try { this.state.trackerClient.destroy(); } catch (_) {}
            this.state.trackerClient = null;
        }
        if (this.state.trackerPeer && this.state.trackerPeer.destroy) {
            try { this.state.trackerPeer.destroy(); } catch (_) {}
            this.state.trackerPeer = null;
        }
        
        // Prepare announce list
        const announce = this.getTrackersList();
        const peerId = 'p-' + Math.random().toString(36).substr(2, 9);
        const infoHash = 'strangerchatroom00000001';
        
        try {
            const client = new TrackerClient({
                infoHash,
                peerId,
                announce
            });
            
            this.state.trackerClient = client;
            this.ui.setStatus('Searching for peers (tracker)...');
            this.ui.addMsg('Searching for a stranger (tracker mode)...', 'them');
            
            client.on('error', (err) => {
                console.warn('tracker error', err);
                this.ui.addMsg('Tracker error: ' + (err && err.message ? err.message : err), 'them');
                this.ui.setStatus('Tracker error');
            });
            
            client.on('warning', (err) => {
                console.warn('tracker warning', err);
            });
            
            client.on('peer', (peer) => {
                console.log('Tracker found peer', peer);
                if (this.state.trackerPeer) {
                    return;
                }
                this.bindTrackerPeer(peer);
            });
            
            client.start();
        } catch (e) {
            console.error('failed to start tracker client', e);
            this.ui.addMsg('Failed to start tracker client: ' + e.message, 'them');
            this.ui.setStatus('Tracker init failed');
        }
    }
    
    bindTrackerPeer(peer) {
        this.state.trackerPeer = peer;
        
        if (peer.on) {
            try {
                peer.on('signal', data => {
                    try {
                        if (this.state.trackerClient && this.state.trackerClient.signal) {
                            this.state.trackerClient.signal(data);
                        }
                    } catch (_) {}
                });
            } catch (_) {}
            
            try {
                peer.on('connect', () => {
                    this.ui.setStatus('Connected (tracker)');
                    this.ui.addMsg('Connected to stranger (tracker).', 'them');
                    this.state.dc = peer;
                });
            } catch (_) {}
            
            try {
                peer.on('data', (d) => {
                    this.ui.addMsg((d && d.toString) ? d.toString() : String(d), 'them');
                });
            } catch (_) {}
        } else {
            if (peer.onmessage) {
                peer.onmessage = (e) => this.ui.addMsg(e.data, 'them');
                this.ui.setStatus('Connected (tracker)');
                this.state.dc = peer;
            } else {
                this.ui.addMsg('Connected to peer (tracker) — but peer API shape is unfamiliar; check tracker build compatibility.', 'them');
            }
        }
    }
}

// --- Class 6: SignalingManager (Main Orchestrator) ---
class SignalingManager {
    constructor() {
        this.state = new ChatState();
        this.ui = new UIHandler(this.state);
        this.webrtc = new WebRTCManager(this.state, this.ui);
        this.fileTransfer = new FileTransferManager(this.state, this.ui);
        this.tracker = new TrackerManager(this.state, this.ui);
        this.bindGlobalEvents();
        this.loadSettings();
    }

    // --- Manual Signaling Methods ---
    async start() {
        if (this.state.pc) this.state.cleanup();
        this.webrtc.createPeer(
            (e) => { 
                if (!e.candidate) el('#localSDP').value = JSON.stringify(this.state.pc.localDescription); 
            },
            (evt) => { 
                this.state.dc = evt.channel; 
                this.webrtc.bindDC(); 
            },
            (e) => { 
                e.streams[0].getTracks().forEach(t => this.state.remoteStream.addTrack(t)); 
            }
        );
        const ms = await this.webrtc.getMediaIfEnabled();
        if (ms) { 
            ms.getTracks().forEach(t => this.state.pc.addTrack(t, ms)); 
            this.state.localStream = ms; 
        }
        this.state.dc = this.state.pc.createDataChannel('chat');
        this.webrtc.bindDC();
        const offer = await this.state.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await this.state.pc.setLocalDescription(offer);
        this.ui.setStatus('Offer created. Share it to the stranger.');
    }

    async applyAnswer() {
        const val = el('#remoteSDP').value.trim();
        if (!val) { 
            alert('Paste the answer SDP first.'); 
            return; 
        }
        try {
            const desc = JSON.parse(val);
            await this.state.pc.setRemoteDescription(desc);
            this.ui.setStatus('Answer applied. Connecting…');
        } catch (e) { 
            alert('Invalid answer: ' + e.message); 
        }
    }

    // Add these methods to SignalingManager class:

    async startVoiceCall() {
        if (!this.state.pc) {
            this.ui.addMsg('Not connected. Cannot start call.', 'them');
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            // Replace or add audio track
            const audioTrack = stream.getAudioTracks()[0];
            const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            
            if (sender) {
                sender.replaceTrack(audioTrack);
            } else {
                this.state.pc.addTrack(audioTrack, stream);
            }
            
            this.state.localStream = stream;
            el('#voiceCallBtn').style.display = 'none';
            el('#endCallBtn').style.display = 'inline-block';
            this.ui.addMsg('Voice call started', 'me');
            
        } catch (err) {
            console.error('Error starting voice call:', err);
            this.ui.addMsg('Could not start voice call: ' + err.message, 'them');
        }
    }

    async startVideoCall() {
        if (!this.state.pc) {
            this.ui.addMsg('Not connected. Cannot start call.', 'them');
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            
            // Update local video
            el('#localVideo').srcObject = stream;
            
            // Add or replace tracks
            stream.getTracks().forEach(track => {
                const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                
                if (sender) {
                    sender.replaceTrack(track);
                } else {
                    this.state.pc.addTrack(track, stream);
                }
            });
            
            this.state.localStream = stream;
            el('#videoCallBtn').style.display = 'none';
            el('#endCallBtn').style.display = 'inline-block';
            this.ui.addMsg('Video call started', 'me');
            
        } catch (err) {
            console.error('Error starting video call:', err);
            this.ui.addMsg('Could not start video call: ' + err.message, 'them');
        }
    }

endCall() {
    if (this.state.localStream) {
        this.state.localStream.getTracks().forEach(track => {
            track.stop();
            const sender = this.state.pc.getSenders().find(s => s.track === track);
            if (sender && this.state.pc.connectionState === 'connected') {
                try {
                    sender.replaceTrack(null);
                } catch (e) {
                    console.error('Error replacing track:', e);
                }
            }
        });
        
        this.state.localStream = null;
        el('#localVideo').srcObject = null;
    }
    
    el('#voiceCallBtn').style.display = 'inline-block';
    el('#videoCallBtn').style.display = 'inline-block';
    el('#endCallBtn').style.display = 'none';
    this.ui.addMsg('Call ended', 'me');
}
    async generateAnswer() {
        const val = el('#remoteSDP').value.trim();
        if (!val) { 
            alert('Paste the offer SDP first.'); 
            return; 
        }
        try {
            if (this.state.pc) this.state.cleanup();
            this.webrtc.createPeer(
                (e) => { 
                    if (!e.candidate) el('#localSDP').value = JSON.stringify(this.state.pc.localDescription); 
                },
                (evt) => { 
                    this.state.dc = evt.channel; 
                    this.webrtc.bindDC(); 
                },
                (e) => { 
                    e.streams[0].getTracks().forEach(t => this.state.remoteStream.addTrack(t)); 
                }
            );
            const ms = await this.webrtc.getMediaIfEnabled();
            if (ms) { 
                ms.getTracks().forEach(t => this.state.pc.addTrack(t, ms)); 
                this.state.localStream = ms; 
            }
            const offer = JSON.parse(val);
            await this.state.pc.setRemoteDescription(offer);
            const answer = await this.state.pc.createAnswer();
            await this.state.pc.setLocalDescription(answer);
            el('#localSDP').value = JSON.stringify(this.state.pc.localDescription);
            this.ui.setStatus('Answer generated. Send back to the stranger.');
        } catch (e) { 
            alert('Invalid offer: ' + e.message); 
        }
    }

    // --- Screen Sharing ---
    async toggleScreenShare() {
        if (!this.state.pc) {
            this.ui.addMsg('Not connected. Start a connection first.', 'them');
            return;
        }
        
        try {
            if (this.state.screenStream) {
                // Stop screen sharing
                this.state.screenStream.getTracks().forEach(track => track.stop());
                
                // Replace with camera stream if available
                if (this.state.localStream) {
                    const videoTrack = this.state.localStream.getVideoTracks()[0];
                    if (videoTrack) {
                        const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(videoTrack);
                    }
                }
                
                this.state.screenStream = null;
                el('#screenBtn').textContent = '🖥️';
                this.ui.addMsg('Screen sharing stopped', 'me');
                
            } else {
                // Start screen sharing
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });
                
                this.state.screenStream = stream;
                
                // Replace video track with screen share
                const videoTrack = stream.getVideoTracks()[0];
                const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                
                if (sender) {
                    sender.replaceTrack(videoTrack);
                } else {
                    this.state.pc.addTrack(videoTrack, stream);
                }
                
                // Update local video
                el('#localVideo').srcObject = stream;
                
                // Listen for screen share end
                videoTrack.onended = () => {
                    this.toggleScreenShare();
                };
                
                el('#screenBtn').textContent = '⏹️';
                this.ui.addMsg('Started screen sharing', 'me');
            }
        } catch (err) {
            console.error('Error sharing screen:', err);
            this.ui.addMsg('Could not share screen: ' + err.message, 'them');
        }
    }

    // --- Shared Methods ---
    sendMessage() {
        const i = el('#msgInput');
        const text = i.value.trim();
        if (!text) return;
        
        try {
            if (this.state.dc && this.state.dc.readyState === 'open') {
                this.state.dc.send(text);
                this.ui.addMsg(text, 'me');
                i.value = '';
                return;
            }
        } catch (e) { /* continue to try tracker peer */ }
        
        // tracker peer 'send' method (some libs expose send)
        try {
            if (this.state.trackerPeer && this.state.trackerPeer.send) {
                this.state.trackerPeer.send(text);
                this.ui.addMsg(text, 'me');
                i.value = '';
                return;
            }
        } catch (e) { console.error(e); }
        
        this.ui.addMsg('Not connected to a stranger. Start a session first.', 'them');
    }

    muteToggle() { 
        if (!this.state.localStream) return; 
        const audioTracks = this.state.localStream.getAudioTracks();
        audioTracks.forEach(t => t.enabled = !t.enabled);
        
        // Toggle button appearance
        const muteBtn = el('#muteBtn');
        if (audioTracks.length > 0 && !audioTracks[0].enabled) {
            muteBtn.classList.add('active');
            muteBtn.textContent = '🔊';
        } else {
            muteBtn.classList.remove('active');
            muteBtn.textContent = '🔇';
        }
    }
    
    camToggle() { 
        if (!this.state.localStream) return; 
        const videoTracks = this.state.localStream.getVideoTracks();
        videoTracks.forEach(t => t.enabled = !t.enabled);
        
        // Toggle button appearance
        const camBtn = el('#camBtn');
        if (videoTracks.length > 0 && !videoTracks[0].enabled) {
            camBtn.classList.add('active');
            camBtn.textContent = '📹';
        } else {
            camBtn.classList.remove('active');
            camBtn.textContent = '📷';
        }
    }

    leave() {
        this.state.cleanup();
        this.ui.setStatus('Left chat.');
    }

    next() {
        this.leave();
        // if tracker mode is selected, start tracker; otherwise start manual (new offer)
        const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
        if (mode === 'tracker') this.tracker.startTrackerMode();
        else this.start();
    }

    copyLocal() {
        const ta = el('#localSDP');
        if (!ta) return;
        ta.select(); 
        ta.setSelectionRange(0, 99999);
        document.execCommand('copy');
    }

    saveLog() {
        const text = els('.msg').map(n => (n.classList.contains('me') ? 'Me: ' : 'Stranger: ') + n.textContent).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = `chat-${new Date().toISOString()}.txt`; 
        a.click(); 
        URL.revokeObjectURL(url);
    }

    loadSettings() {
        // Preload trackers into settings UI
        const trackers = localStorage.getItem('trackers') || this.tracker.getDefaultTrackers().join('\n');
        if (el('#trackerList')) el('#trackerList').value = trackers.trim();
    }

    // --- UI Bindings ---
    bindGlobalEvents() {
        // Main control buttons
        el('#startBtn').addEventListener('click', () => {
            const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
            if (mode === 'manual') this.start();
            else this.tracker.startTrackerMode();
        });
        
        el('#applyAnswerBtn').addEventListener('click', () => this.applyAnswer());
        el('#generateAnswerBtn').addEventListener('click', () => this.generateAnswer());
        el('#copyOfferBtn').addEventListener('click', () => this.copyLocal());
        el('#haveOfferBtn').addEventListener('click', () => { el('#remoteSDP').focus(); });
        
        // Chat controls
        el('#sendBtn').addEventListener('click', () => this.sendMessage());
        el('#msgInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
                e.preventDefault();
            }
        });
        
        // Session controls
        el('#nextBtn').addEventListener('click', () => this.next());
        el('#leaveBtn').addEventListener('click', () => this.leave());
        
        // Media controls
        el('#muteBtn').addEventListener('click', () => this.muteToggle());
        el('#camBtn').addEventListener('click', () => this.camToggle());
        el('#screenBtn').addEventListener('click', () => this.toggleScreenShare());
        
        // Settings
        el('#saveTrackersBtn').addEventListener('click', () => this.tracker.saveTrackers());
        el('#restoreDefaultTrackersBtn').addEventListener('click', () => this.tracker.restoreDefaultTrackers());
        
        // Utility
        el('#downloadBtn').addEventListener('click', () => this.saveLog());
        // In bindGlobalEvents method, add these new event listeners:

        // Call buttons
        el('#voiceCallBtn').addEventListener('click', () => this.startVoiceCall());
        el('#videoCallBtn').addEventListener('click', () => this.startVideoCall());
        el('#endCallBtn').addEventListener('click', () => this.endCall());
    }
}

// --- Initialize the app ---
document.addEventListener('DOMContentLoaded', () => new SignalingManager());