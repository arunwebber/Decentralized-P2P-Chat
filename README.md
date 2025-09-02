# Stranger P2P Chat Decentralized 
Anonymous, browser-based WebRTC chat extension with **manual signaling** (serverless) and Omegle-style controls.

## How to Install (Chrome/Edge)
1. Download and unzip this folder.
2. Go to `chrome://extensions` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Pin the extension and click the icon to open the popup.

## How to Use (Manual Signaling)
- Click **Start (Create Offer)** → copy the JSON from **Your Offer** and send it to your partner via any channel.
- Your partner pastes it into **Paste Remote SDP** and clicks **Generate Answer** → they send back their JSON.
- You paste that into **Paste Remote SDP** and click **Apply Answer**.
- When connected, chat via text (and optional audio/video if enabled).

## Notes
- STUN defaults to `stun:stun.stunprotocol.org:3478`. You can change it in Settings.
- This MVP avoids any central signaling server by using copy/paste. You can later add WebSocket or tracker-based rendezvous.
- Logs can be saved/printed from the footer buttons.
