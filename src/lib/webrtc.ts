export type SignalingMessage = {
  type: 'CALL_REQUEST' | 'CALL_ACCEPT' | 'CALL_REJECT' | 'OFFER' | 'ANSWER' | 'ICE' | 'HANGUP'
  from?: string
  to?: string
  payload?: unknown
}

export class AudioCall {
  private socket?: WebSocket
  private peer?: RTCPeerConnection
  private stream?: MediaStream
  private remoteAudio?: HTMLAudioElement

  async start(callId: string, signalingUrl: string, initiator: boolean, onState?: (state: string) => void) {
    this.remoteAudio = document.createElement('audio')
    this.remoteAudio.autoplay = true
    this.remoteAudio.setAttribute('playsinline', 'true')
    document.body.appendChild(this.remoteAudio)

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    })

    for (const track of this.stream.getTracks()) this.peer.addTrack(track, this.stream)

    this.peer.ontrack = (event) => {
      if (this.remoteAudio) this.remoteAudio.srcObject = event.streams[0]
    }

    this.peer.onicecandidate = (event) => {
      if (event.candidate && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ICE', payload: event.candidate.toJSON() }))
      }
    }

    this.socket = new WebSocket(signalingUrl)
    this.socket.onopen = async () => {
      onState?.('connected')
      if (initiator) {
        const offer = await this.peer!.createOffer({ offerToReceiveAudio: true })
        await this.peer!.setLocalDescription(offer)
        this.socket!.send(JSON.stringify({ type: 'OFFER', payload: offer }))
      }
    }

    this.socket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as SignalingMessage
      if (!this.peer) return

      if (message.type === 'OFFER') {
        await this.peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit)
        const answer = await this.peer.createAnswer()
        await this.peer.setLocalDescription(answer)
        this.socket!.send(JSON.stringify({ type: 'ANSWER', payload: answer }))
      } else if (message.type === 'ANSWER') {
        await this.peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit)
      } else if (message.type === 'ICE') {
        try { await this.peer.addIceCandidate(message.payload as RTCIceCandidateInit) } catch { /* stale candidate */ }
      } else if (message.type === 'HANGUP') {
        onState?.('ended')
        this.stop()
      }
    }

    this.socket.onclose = () => onState?.('disconnected')
    this.socket.onerror = () => onState?.('error')
  }

  hangup() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'HANGUP' }))
    this.stop()
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.peer?.close()
    this.socket?.close()
    this.remoteAudio?.remove()
    this.stream = undefined
    this.peer = undefined
    this.socket = undefined
    this.remoteAudio = undefined
  }
}
