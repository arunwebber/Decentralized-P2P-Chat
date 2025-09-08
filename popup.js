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
        this.poolClient = null;
        this.poolPeer = null;
        
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
        try { if (this.poolPeer) this.poolPeer.destroy && this.poolPeer.destroy(); } catch (_) { }
        try { if (this.poolClient) this.poolClient.destroy && this.poolClient.destroy(); } catch (_) { }
        if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); }
        if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); }

        this.pc = null;
        this.dc = null;
        this.localStream = null;
        this.remoteStream = null;
        this.screenStream = null;
        this.connected = false;
        this.poolClient = null;
        this.poolPeer = null;
        el('#remoteVideo').srcObject = null;
        el('#localVideo').srcObject = null;
        
        // Hide chat controls
        this.disableChatControls();
        
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

    // Add these methods to ChatState class
    enableChatControls() {
        els('#chatControls button').forEach(btn => btn.disabled = false);
    }

    disableChatControls() {
        els('#chatControls button').forEach(btn => btn.disabled = true);
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

    bindDC(signalManager) {  // Add parameter
        if (!this.state.dc) return;
        
        this.state.dc.onopen = () => { 
            this.ui.setStatus('Connected'); 
            this.ui.addMsg('You are now connected to a stranger. Say hi!', 'them');
            // Enable chat controls when connected
            this.state.enableChatControls();
        };
        
        this.state.dc.onclose = () => { 
            this.ui.setStatus('Channel closed');
            // Disable chat controls when disconnected
            this.state.disableChatControls();
        };
        
        this.state.dc.onmessage = (e) => { 
            // Handle different types of messages
            if (typeof e.data === 'string') {
                try {
                    const data = JSON.parse(e.data);
                    
                    // Handle control messages
                    if (data.type === 'control') {
                        signalManager.handleControlMessage(data);
                        return;
                    }
                    
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
        // Check both regular DC and SimplePeer connections
        let canSend = false;
        
        if (this.state.dc) {
            // For manual connections with DataChannel
            if (this.state.dc.readyState === 'open') {
                canSend = true;
            }
            // For pool connections with SimplePeer
            else if (this.state.poolPeer && this.state.poolPeer.connected) {
                canSend = true;
            }
        }
        
        if (!canSend) {
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
            // For SimplePeer, check if connected
            if (this.state.poolPeer && !this.state.poolPeer.connected) {
                this.ui.addMsg('Connection lost during file transfer', 'them');
                this.ui.hideFileProgress();
                return;
            }
            
            // For regular DC, check bufferedAmount
            if (this.state.dc.bufferedAmount && this.state.dc.bufferedAmount > 65536) {
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

// --- Class 5: PoolManager --- (Changed from TrackerManager)
class PoolManager {
    constructor(state, ui) {
        this.state = state;
        this.ui = ui;
    }
    
    getDefaultPools() {
        return [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.fastcast.nz',
            'wss://tracker.webtorrent.dev'
        ];
    }
    
    getPoolsList() {
        const saved = localStorage.getItem('pools');
        if (saved && saved.trim()) return saved.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        return this.getDefaultPools();
    }
    
    savePools() {
        const list = (el('#poolList') && el('#poolList').value) ? el('#poolList').value.trim() : '';
        localStorage.setItem('pools', list);
        this.ui.addMsg('Pool list saved.', 'them');
        this.ui.setStatus('Pool list saved');
    }
    
    restoreDefaultPools() {
        el('#poolList').value = this.getDefaultPools().join('\n');
        this.savePools();
    }
    
    startPoolMode() {
        // Detection of browser globals
        const TrackerClient = window.Client || window.bittorrentTrackerClient || window.BittorrentTrackerClient || window.bittorrentTracker || null;
        const SimplePeerGlobal = window.SimplePeer || window.SimplePeerDefault || window.SimplePeerLib || null;
        
        if (!TrackerClient || !SimplePeerGlobal) {
            this.ui.addMsg('Pool libraries not found. To enable Pool mode, add browser builds of simple-peer and bittorrent-tracker to lib/.', 'them');
            this.ui.setStatus('Pool unavailable');
            return;
        }
        
        // Safe destroy any existing client/pc
        if (this.state.poolClient && this.state.poolClient.destroy) {
            try { this.state.poolClient.destroy(); } catch (_) {}
            this.state.poolClient = null;
        }
        if (this.state.poolPeer && this.state.poolPeer.destroy) {
            try { this.state.poolPeer.destroy(); } catch (_) {}
            this.state.poolPeer = null;
        }
        
        // Set up global handler for pool signals
        window.poolSignalData = (signal, isInitiator) => {
            // Show signal in manual exchange area
            el('#localSDP').value = JSON.stringify(signal);
            
            if (isInitiator) {
                this.ui.setStatus('Pool: Found someone! Copy your offer and share it');
                this.ui.addMsg('Found a stranger! You are the initiator. Copy your offer above and share it with them.', 'them');
            } else {
                this.ui.setStatus('Pool: Someone found you! Copy your answer and share it');
                this.ui.addMsg('A stranger found you! Wait for their offer, paste it below, then share your answer.', 'them');
            }
            
            // Show manual exchange UI
            const manualBox = el('.manualBox');
            if (manualBox) manualBox.style.display = 'block';
            
            // Enable the appropriate buttons
            if (!isInitiator) {
                // They need to wait for an offer first
                el('#generateAnswerBtn').style.display = 'inline-block';
            }
        };
        
        // Prepare announce list
        const announce = this.getPoolsList();
        const peerId = 'p-' + Math.random().toString(36).substr(2, 9);
        const infoHash = 'strangerchatroom00000001';
        
        try {
            const client = new TrackerClient({
                infoHash,
                peerId,
                announce
            });
            
            this.state.poolClient = client;
            this.ui.setStatus('Looking for strangers in the pool...');
            this.ui.addMsg('Joining the pool, searching for someone to chat with...', 'them');
            
            client.on('error', (err) => {
                console.warn('pool error', err);
                this.ui.addMsg('Pool error: ' + (err && err.message ? err.message : err), 'them');
                this.ui.setStatus('Pool error');
            });
            
            client.on('warning', (err) => {
                console.warn('pool warning', err);
            });
            
            client.on('peer', (peer) => {
                console.log('Pool matched with peer');
                if (this.state.poolPeer) {
                    return;
                }
                
                this.state.poolPeer = peer;
                this.bindPoolPeer(peer);
            });
            
            client.start();
        } catch (e) {
            console.error('failed to start pool client', e);
            this.ui.addMsg('Failed to start pool: ' + e.message, 'them');
            this.ui.setStatus('Pool init failed');
        }
    }

    // In PoolManager class, remove the duplicate bindPoolPeer and keep only this one:
    bindPoolPeer(peer) {
        this.state.poolPeer = peer;
        
        // Store reference to signalManager for control messages
        const signalManager = window.signalManager || this;
        
        // SimplePeer events
        peer.on('connect', () => {
            console.log('Pool peer connected!');
            this.ui.setStatus('Connected (pool)');
            this.ui.addMsg('Connected to stranger! You can now chat.', 'them');
            
            // IMPORTANT: Set the data channel reference
            this.state.dc = peer;
            this.state.connected = true;
            this.state.enableChatControls();
            
            // Clear the signal data
            el('#localSDP').value = '';
            el('#remoteSDP').value = '';
            
            // Hide manual box since we're connected
            const manualBox = el('.manualBox');
            if (manualBox) manualBox.style.display = 'none';
        });
        
        peer.on('data', (data) => {
            try {
                let messageText;
                
                // Handle different data types
                if (typeof data === 'string') {
                    messageText = data;
                } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
                    // Convert buffer to string
                    messageText = new TextDecoder().decode(data);
                } else {
                    messageText = data.toString();
                }
                
                // Try to parse as JSON for control messages
                try {
                    const parsed = JSON.parse(messageText);
                    
                    if (parsed.type === 'control') {
                        // Call handleControlMessage on the main signalManager
                        if (window.signalManager && window.signalManager.handleControlMessage) {
                            window.signalManager.handleControlMessage(parsed);
                        }
                        return;
                    }
                    
                    if (parsed.type === 'file-metadata') {
                        this.state.fileState.receiving = true;
                        this.state.fileState.metadata = parsed;
                        this.state.fileState.chunks = [];
                        this.state.fileState.receivedSize = 0;
                        this.ui.showFileProgress(parsed.name, false);
                        return;
                    }
                    
                    if (parsed.type === 'file-complete') {
                        if (this.state.fileState.receiving) {
                            const blob = new Blob(this.state.fileState.chunks, { 
                                type: this.state.fileState.metadata.mimeType 
                            });
                            const url = URL.createObjectURL(blob);
                            this.ui.addFileLink(this.state.fileState.metadata.name, url);
                            this.ui.hideFileProgress();
                            this.state.fileState.receiving = false;
                        }
                        return;
                    }
                } catch {
                    // Not JSON, treat as regular message
                }
                
                // Regular text message
                this.ui.addMsg(messageText, 'them');
                
            } catch (e) {
                console.error('Error handling peer data:', e);
                // If it's binary data for file transfer
                if (data instanceof ArrayBuffer && this.state.fileState.receiving) {
                    this.state.fileState.chunks.push(data);
                    this.state.fileState.receivedSize += data.byteLength;
                    
                    const progress = Math.round((this.state.fileState.receivedSize / this.state.fileState.metadata.size) * 100);
                    this.ui.updateFileProgress(progress);
                }
            }
        });
        
        peer.on('stream', (stream) => {
            console.log('Received stream from peer');
            this.state.remoteStream = stream;
            el('#remoteVideo').srcObject = stream;
        });
        
        peer.on('error', (err) => {
            console.error('Pool peer error:', err);
            this.ui.addMsg('Connection error: ' + err.message, 'them');
            this.ui.setStatus('Pool error');
        });
        
        peer.on('close', () => {
            console.log('Pool peer disconnected');
            this.ui.setStatus('Disconnected');
            this.ui.addMsg('Stranger disconnected.', 'them');
            this.state.disableChatControls();
            this.state.cleanup();
        });
        
        // Store reference for WebRTC manager
        this.state.pc = peer;
    }
}

// --- Class 6: SignalingManager (Main Orchestrator) ---
class SignalingManager {
    constructor() {
        this.state = new ChatState();
        this.ui = new UIHandler(this.state);
        this.webrtc = new WebRTCManager(this.state, this.ui);
        this.fileTransfer = new FileTransferManager(this.state, this.ui);
        this.pool = new PoolManager(this.state, this.ui);  // Changed from this.tracker
        
        window.signalManager = this;
        this.bindGlobalEvents();
        this.loadSettings();
        this.state.disableChatControls();
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
                this.webrtc.bindDC(this); 
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
        this.webrtc.bindDC(this);
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

    // Add this method to handle incoming control messages
    handleControlMessage(data) {
        switch (data.action) {
            case 'voice-call-start':
                this.ui.addMsg('Stranger started a voice call', 'them');
                el('#voiceCallBtn').style.display = 'none';
                el('#endCallBtn').style.display = 'inline-block';
                break;
                
            case 'video-call-start':
                this.ui.addMsg('Stranger started a video call', 'them');
                el('#videoCallBtn').style.display = 'none';
                el('#endCallBtn').style.display = 'inline-block';
                break;
                
            case 'call-end':
                this.ui.addMsg('Stranger ended the call', 'them');
                el('#voiceCallBtn').style.display = 'inline-block';
                el('#videoCallBtn').style.display = 'inline-block';
                el('#endCallBtn').style.display = 'none';
                break;
                
            case 'mute-toggle':
                this.ui.addMsg(data.muted ? 'Stranger muted their microphone' : 'Stranger unmuted their microphone', 'them');
                break;
                
            case 'camera-toggle':
                this.ui.addMsg(data.cameraOff ? 'Stranger turned off their camera' : 'Stranger turned on their camera', 'them');
                break;
                
            case 'screen-share-toggle':
                this.ui.addMsg(data.sharing ? 'Stranger started screen sharing' : 'Stranger stopped screen sharing', 'them');
                break;
        }
    }

    // Helper method to send control messages
// Helper method to send control messages
    sendControlMessage(action, data = {}) {
        let messageSent = false;
        
        // Try regular DataChannel first
        if (this.state.dc && this.state.dc.readyState === 'open') {
            this.state.dc.send(JSON.stringify({
                type: 'control',
                action: action,
                ...data
            }));
            messageSent = true;
        }
        // Try pool peer connection
        else if (this.state.poolPeer && this.state.poolPeer.connected && this.state.dc) {
            this.state.dc.send(JSON.stringify({
                type: 'control',
                action: action,
                ...data
            }));
            messageSent = true;
        }
        
        if (!messageSent) {
            console.warn('Cannot send control message - not connected');
        }
    }

    async startVoiceCall() {
        if (!this.state.poolPeer && !this.state.pc) {
            this.ui.addMsg('Not connected. Cannot start call.', 'them');
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            if (this.state.poolPeer) {
                // For pool connections using SimplePeer
                this.state.poolPeer.addStream(stream);
            } else if (this.state.pc && this.state.pc.addTrack) {
                // For manual connections
                const audioTrack = stream.getAudioTracks()[0];
                const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                
                if (sender) {
                    sender.replaceTrack(audioTrack);
                } else {
                    this.state.pc.addTrack(audioTrack, stream);
                }
            }
            
            this.state.localStream = stream;
            el('#voiceCallBtn').style.display = 'none';
            el('#endCallBtn').style.display = 'inline-block';
            this.ui.addMsg('Voice call started', 'me');
            this.sendControlMessage('voice-call-start');
        } catch (err) {
            console.error('Error starting voice call:', err);
            this.ui.addMsg('Could not start voice call: ' + err.message, 'them');
        }
    }

    async startVideoCall() {
        if (!this.state.poolPeer && !this.state.pc) {
            this.ui.addMsg('Not connected. Cannot start call.', 'them');
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            
            // Update local video
            el('#localVideo').srcObject = stream;
            
            if (this.state.poolPeer) {
                // For pool connections using SimplePeer
                this.state.poolPeer.addStream(stream);
            } else if (this.state.pc && this.state.pc.addTrack) {
                // For manual connections
                stream.getTracks().forEach(track => {
                    const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                    
                    if (sender) {
                        sender.replaceTrack(track);
                    } else {
                        this.state.pc.addTrack(track, stream);
                    }
                });
            }
            
            this.state.localStream = stream;
            el('#videoCallBtn').style.display = 'none';
            el('#endCallBtn').style.display = 'inline-block';
            this.ui.addMsg('Video call started', 'me');
            this.sendControlMessage('video-call-start');
            
        } catch (err) {
            console.error('Error starting video call:', err);
            this.ui.addMsg('Could not start video call: ' + err.message, 'them');
        }
    }

    endCall() {
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => {
                track.stop();
            });
            
            // For manual connections, remove tracks
            if (this.state.pc && this.state.pc.getSenders) {
                this.state.localStream.getTracks().forEach(track => {
                    const sender = this.state.pc.getSenders().find(s => s.track === track);
                    if (sender && this.state.pc.connectionState === 'connected') {
                        try {
                            sender.replaceTrack(null);
                        } catch (e) {
                            console.error('Error replacing track:', e);
                        }
                    }
                });
            }
            
            // For pool connections, removeStream
            if (this.state.poolPeer && this.state.poolPeer.removeStream) {
                this.state.poolPeer.removeStream(this.state.localStream);
            }
            
            this.state.localStream = null;
            el('#localVideo').srcObject = null;
        }
        
        el('#voiceCallBtn').style.display = 'inline-block';
        el('#videoCallBtn').style.display = 'inline-block';
        el('#endCallBtn').style.display = 'none';
        this.ui.addMsg('Call ended', 'me');
        this.sendControlMessage('call-end');
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
                    this.webrtc.bindDC(this); 
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
        // Check for both pool and manual connections
        if (!this.state.poolPeer && !this.state.pc) {
            this.ui.addMsg('Not connected. Start a connection first.', 'them');
            return;
        }
        
        try {
            if (this.state.screenStream) {
                // Stop screen sharing
                this.state.screenStream.getTracks().forEach(track => track.stop());
                
                // For pool connections
                if (this.state.poolPeer && this.state.localStream) {
                    this.state.poolPeer.removeStream(this.state.screenStream);
                    this.state.poolPeer.addStream(this.state.localStream);
                    el('#localVideo').srcObject = this.state.localStream;
                }
                // For manual connections
                else if (this.state.pc && this.state.localStream) {
                    const videoTrack = this.state.localStream.getVideoTracks()[0];
                    if (videoTrack) {
                        const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(videoTrack);
                    }
                }
                
                this.state.screenStream = null;
                el('#screenBtn').textContent = '🖥️';
                this.ui.addMsg('Screen sharing stopped', 'me');
                this.sendControlMessage('screen-share-toggle', { sharing: false });
                
            } else {
                // Start screen sharing
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: true
                });
                
                this.state.screenStream = stream;
                
                // For pool connections
                if (this.state.poolPeer) {
                    if (this.state.localStream) {
                        this.state.poolPeer.removeStream(this.state.localStream);
                    }
                    this.state.poolPeer.addStream(stream);
                }
                // For manual connections
                else if (this.state.pc) {
                    const videoTrack = stream.getVideoTracks()[0];
                    const sender = this.state.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        this.state.pc.addTrack(videoTrack, stream);
                    }
                }
                
                // Update local video
                el('#localVideo').srcObject = stream;
                
                // Listen for screen share end
                stream.getVideoTracks()[0].onended = () => {
                    this.toggleScreenShare();
                };
                
                el('#screenBtn').textContent = '⏹️';
                this.ui.addMsg('Started screen sharing', 'me');
                this.sendControlMessage('screen-share-toggle', { sharing: true });
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
        } catch (e) { /* continue to try pool peer */ }
        
        // pool peer 'send' method (some libs expose send)
        try {
            if (this.state.poolPeer && this.state.poolPeer.send) {
                this.state.poolPeer.send(text);
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
        // Notify peer
        const isMuted = audioTracks.length > 0 && !audioTracks[0].enabled;
        this.sendControlMessage('mute-toggle', { muted: isMuted });
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
        // Notify peer
        const isCameraOff = videoTracks.length > 0 && !videoTracks[0].enabled;
        this.sendControlMessage('camera-toggle', { cameraOff: isCameraOff });
    }

    leave() {
        this.state.cleanup();
        this.ui.setStatus('Left chat.');
    }

    next() {
        this.leave();
        // if pool mode is selected, start pool; otherwise start manual (new offer)
        const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
        if (mode === 'pool') this.pool.startPoolMode();
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
        // Preload pools into settings UI
        const pools = localStorage.getItem('pools') || this.pool.getDefaultPools().join('\n');
        if (el('#poolList')) el('#poolList').value = pools.trim();
    }

    // --- UI Bindings ---
    bindGlobalEvents() {
        // Main control buttons
        el('#startBtn').addEventListener('click', () => {
            const mode = (el('input[name="sigMode"]:checked') || {}).value || 'manual';
            if (mode === 'manual') this.start();
            else this.pool.startPoolMode();
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
        el('#savePoolsBtn').addEventListener('click', () => this.pool.savePools());
        el('#restoreDefaultPoolsBtn').addEventListener('click', () => this.pool.restoreDefaultPools());
        
        // Utility
        el('#downloadBtn').addEventListener('click', () => this.saveLog());
        
        // Call buttons
        el('#voiceCallBtn').addEventListener('click', () => this.startVoiceCall());
        el('#videoCallBtn').addEventListener('click', () => this.startVideoCall());
        el('#endCallBtn').addEventListener('click', () => this.endCall());
    }
}

// --- Initialize the app ---
document.addEventListener('DOMContentLoaded', () => new SignalingManager());