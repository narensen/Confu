import type { RealtimeChannel } from "@supabase/supabase-js";
import { setInVoice, touchPresence } from "@/lib/friends";
import { displayName } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";
import { ICE_SERVERS, VOICE_CAP, isSpeaking, shouldOffer } from "@/lib/voice";

// One private room's voice. The channel only carries "who is here" and the
// WebRTC handshake. Audio goes browser to browser and is never uploaded.

export type VoicePerson = {
  id: string;
  name: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  connecting: boolean;
  me: boolean;
};

type Tracked = { name: string; muted: boolean; deafened: boolean; speaking: boolean };

type Signal =
  | { kind: "hello"; from: string }
  | { kind: "offer"; from: string; to: string; sdp: string }
  | { kind: "answer"; from: string; to: string; sdp: string }
  | { kind: "ice"; from: string; to: string; candidate: RTCIceCandidateInit }
  | { kind: "bye"; from: string };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  ice: RTCIceCandidateInit[];
  remoteSet: boolean;
};

function asTracked(value: unknown): Tracked | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
  return {
    name: name || "Someone",
    muted: row.muted === true,
    deafened: row.deafened === true,
    speaking: row.speaking === true,
  };
}

function asSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const from = typeof row.from === "string" ? row.from : "";
  const to = typeof row.to === "string" ? row.to : "";
  const sdp = typeof row.sdp === "string" ? row.sdp : "";
  if (!from) return null;
  if (row.kind === "hello" || row.kind === "bye") return { kind: row.kind, from };
  if ((row.kind === "offer" || row.kind === "answer") && to && sdp) return { kind: row.kind, from, to, sdp };
  if (row.kind === "ice" && to && row.candidate && typeof row.candidate === "object") {
    return { kind: "ice", from, to, candidate: row.candidate as RTCIceCandidateInit };
  }
  return null;
}

export class VoiceSession {
  private channel: RealtimeChannel | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Uint8Array(0);
  private peers = new Map<string, Peer>();
  private presence = new Map<string, Tracked>();
  private earlyIce = new Map<string, RTCIceCandidateInit[]>();
  private retries = new Map<string, number>();
  private audioOn = false;
  private muted = false;
  private deafened = false;
  private speaking = false;
  private pendingLoud = false;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private joinGen = 0;
  private userId = "";
  private name = "Someone";
  private ready: Promise<void>;
  private resolveReady: (() => void) | null = null;

  constructor(
    private slug: string,
    private host: HTMLElement,
    private onChange: (people: VoicePerson[]) => void,
    private onError: (message: string) => void,
    private onHear: (needsTap: boolean) => void,
  ) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  watch() {
    if (this.channel || this.closed) return;
    void this.bind();
  }

  private async bind() {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (this.closed) return;
    const id = data.user?.id;
    if (!id) {
      this.onError("Sign in again to use voice.");
      return;
    }
    this.userId = id;
    try {
      this.name = await displayName();
    } catch {
      this.name = "Someone";
    }
    if (this.closed) return;

    const channel = supabase.channel(`voice:${this.slug}`, {
      config: { broadcast: { self: false }, presence: { key: id } },
    });
    this.channel = channel;
    if (this.closed) {
      void supabase.removeChannel(channel);
      this.channel = null;
      return;
    }
    channel
      .on("presence", { event: "sync" }, () => {
        this.readPresence();
        if (this.audioOn) this.ensureOffers();
        this.emit();
      })
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        void this.onSignal(payload);
      })
      .subscribe((status) => {
        if (this.closed) return;
        if (status === "SUBSCRIBED") this.resolveReady?.();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.onError("Couldn't reach voice. Check your connection and try again.");
        }
      });
  }

  async join() {
    if (this.closed || this.audioOn) return;
    const gen = ++this.joinGen;
    await this.untilReady();
    if (this.closed || gen !== this.joinGen) return;
    const others = [...this.presence.keys()].filter((id) => id !== this.userId);
    if (others.length >= VOICE_CAP) throw new Error("Voice is full. Up to 8 people can talk.");
    if (!window.isSecureContext) throw new Error("Voice needs a secure page (https).");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("The microphone is blocked. Allow it for this site, then try again.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new Error("No microphone found.");
      throw new Error("Couldn't start the microphone.");
    }
    if (this.closed || gen !== this.joinGen) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (!this.audioOn) return;
        this.onError("The microphone stopped. Join voice again when it's available.");
        void this.leave();
      });
    }
    this.startMeter(stream);
    this.audioOn = true;
    this.muted = false;
    this.deafened = false;
    this.speaking = false;
    await this.publish();
    this.send({ kind: "hello", from: this.userId });
    this.ensureOffers();
    this.emit();
    setInVoice(true);
    void touchPresence();
  }

  async leave() {
    this.joinGen += 1;
    if (!this.audioOn) return;
    this.audioOn = false;
    this.speaking = false;
    this.pendingLoud = false;
    this.send({ kind: "bye", from: this.userId });
    await this.channel?.untrack();
    this.stopAudio();
    this.closePeers();
    setInVoice(false);
    void touchPresence();
    this.emit();
  }

  async close() {
    this.closed = true;
    await this.leave();
    const channel = this.channel;
    this.channel = null;
    if (channel) await createClient().removeChannel(channel);
  }

  setMuted(on: boolean) {
    if (!this.audioOn || this.deafened) return;
    this.muted = on;
    if (on) this.speaking = false;
    this.applyMic();
    void this.publish();
    this.emit();
  }

  setDeafened(on: boolean) {
    if (!this.audioOn) return;
    this.deafened = on;
    if (on) this.speaking = false;
    this.applyMic();
    for (const peer of this.peers.values()) peer.audio.volume = on ? 0 : 1;
    void this.publish();
    this.emit();
  }

  hear() {
    for (const peer of this.peers.values()) {
      void peer.audio.play().then(
        () => this.onHear(false),
        () => this.onHear(true),
      );
    }
  }

  get isMuted() {
    return this.muted;
  }

  get isDeafened() {
    return this.deafened;
  }

  private async untilReady() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Couldn't reach voice. Check your connection and try again.")), 8000);
    });
    try {
      await Promise.race([this.ready, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private startMeter(stream: MediaStream) {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    this.analyser = analyser;
    this.samples = new Uint8Array(analyser.fftSize);
    this.meter = setInterval(() => this.meterSpeaking(), 100);
  }

  private meterSpeaking() {
    if (!this.analyser || !this.audioOn) return;
    this.analyser.getByteTimeDomainData(this.samples);
    const loud = !this.muted && !this.deafened && isSpeaking(this.samples);
    if (loud === this.pendingLoud) return;
    this.pendingLoud = loud;
    if (this.speakTimer) clearTimeout(this.speakTimer);
    this.speakTimer = setTimeout(() => {
      if (!this.audioOn || this.pendingLoud === this.speaking) return;
      this.speaking = this.pendingLoud;
      void this.publish();
      this.emit();
    }, 140);
  }

  private applyMic() {
    const enabled = !this.muted && !this.deafened;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  private stopAudio() {
    if (this.speakTimer) clearTimeout(this.speakTimer);
    this.speakTimer = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.analyser = null;
    void this.ctx?.close();
    this.ctx = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async publish() {
    if (!this.channel || !this.audioOn) return;
    await this.channel.track({
      name: this.name,
      muted: this.muted || this.deafened,
      deafened: this.deafened,
      speaking: this.speaking && !this.muted && !this.deafened,
    });
  }

  private send(payload: Signal) {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event: "signal", payload });
  }

  private readPresence() {
    this.presence.clear();
    const state = this.channel?.presenceState() ?? {};
    for (const [id, metas] of Object.entries(state)) {
      const latest = Array.isArray(metas) ? metas[metas.length - 1] : null;
      const tracked = asTracked(latest);
      if (tracked) this.presence.set(id, tracked);
    }
    if (!this.audioOn) return;
    for (const id of [...this.peers.keys()]) {
      if (!this.presence.has(id)) this.dropPeer(id);
    }
  }

  private ensureOffers() {
    if (!this.audioOn || !this.userId) return;
    for (const id of this.presence.keys()) {
      if (id === this.userId || this.peers.has(id)) continue;
      if (shouldOffer(this.userId, id)) void this.offer(id);
    }
  }

  private makePeer(id: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.volume = this.deafened ? 0 : 1;
    this.host.appendChild(audio);
    const peer: Peer = { pc, audio, ice: [], remoteSet: false };
    this.stream?.getTracks().forEach((track) => {
      if (this.stream) pc.addTrack(track, this.stream);
    });
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.send({ kind: "ice", from: this.userId, to: id, candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().then(
        () => this.onHear(false),
        () => this.onHear(true),
      );
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.retries.set(id, 0);
      if (pc.connectionState === "failed") {
        const attempt = (this.retries.get(id) ?? 0) + 1;
        this.retries.set(id, attempt);
        this.dropPeer(id);
        if (this.audioOn && attempt < 3 && shouldOffer(this.userId, id)) void this.offer(id);
      }
      this.emit();
    };
    const queued = this.earlyIce.get(id);
    if (queued) {
      peer.ice.push(...queued);
      this.earlyIce.delete(id);
    }
    this.peers.set(id, peer);
    return peer;
  }

  private dropPeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    this.peers.delete(id);
    this.earlyIce.delete(id);
  }

  private closePeers() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.earlyIce.clear();
  }

  private async flushIce(peer: Peer) {
    const queued = peer.ice.splice(0);
    for (const candidate of queued) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  private async offer(id: string) {
    if (!this.audioOn || this.closed || this.peers.has(id) || !this.stream) return;
    const peer = this.makePeer(id);
    try {
      const offer = await peer.pc.createOffer();
      if (this.closed || !this.peers.has(id)) return;
      await peer.pc.setLocalDescription(offer);
      if (!offer.sdp) return;
      this.send({ kind: "offer", from: this.userId, to: id, sdp: offer.sdp });
    } catch {
      this.dropPeer(id);
    }
  }

  private async onSignal(payload: unknown) {
    const signal = asSignal(payload);
    if (!signal || this.closed || signal.from === this.userId) return;
    if ("to" in signal && signal.to !== this.userId) return;

    if (signal.kind === "bye") {
      this.dropPeer(signal.from);
      this.emit();
      return;
    }
    if (signal.kind === "hello") {
      if (this.peers.has(signal.from)) this.dropPeer(signal.from);
      if (this.audioOn && shouldOffer(this.userId, signal.from)) void this.offer(signal.from);
      return;
    }
    if (!this.audioOn) return;

    if (signal.kind === "offer") {
      // Only the higher id answers. An offer from someone we should be calling is glare; ignore it.
      if (!shouldOffer(signal.from, this.userId)) return;
      this.dropPeer(signal.from);
      const peer = this.makePeer(signal.from);
      try {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        peer.remoteSet = true;
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        if (answer.sdp) this.send({ kind: "answer", from: this.userId, to: signal.from, sdp: answer.sdp });
      } catch {
        this.dropPeer(signal.from);
      }
      return;
    }

    if (signal.kind === "ice") {
      this.stashIce(signal.from, signal.candidate);
      return;
    }
    const peer = this.peers.get(signal.from);
    if (!peer || signal.kind !== "answer") return;
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      peer.remoteSet = true;
      await this.flushIce(peer);
    } catch {
      this.dropPeer(signal.from);
    }
  }

  // ICE often arrives before the offer that creates the peer connection.
  private stashIce(id: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(id);
    if (!peer) {
      const queued = this.earlyIce.get(id) ?? [];
      queued.push(candidate);
      this.earlyIce.set(id, queued);
      return;
    }
    if (peer.remoteSet) void peer.pc.addIceCandidate(candidate).catch(() => {});
    else peer.ice.push(candidate);
  }

  private emit() {
    const people: VoicePerson[] = [];
    if (this.audioOn) {
      people.push({
        id: this.userId || "me",
        name: this.name,
        muted: this.muted || this.deafened,
        deafened: this.deafened,
        speaking: this.speaking && !this.muted && !this.deafened,
        connecting: false,
        me: true,
      });
    }
    const rest: VoicePerson[] = [];
    for (const [id, meta] of this.presence) {
      if (id === this.userId) continue;
      const pc = this.peers.get(id)?.pc;
      rest.push({
        id,
        name: meta.name,
        muted: meta.muted,
        deafened: meta.deafened,
        speaking: meta.speaking && !meta.muted,
        connecting: this.audioOn && pc?.connectionState !== "connected",
        me: false,
      });
    }
    rest.sort((a, b) => a.name.localeCompare(b.name));
    this.onChange([...people, ...rest]);
  }
}
