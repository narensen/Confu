import type { RealtimeChannel } from "@supabase/supabase-js";
import { displayName } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";
import { ICE_SERVERS, VOICE_CAP, isSpeaking, shouldOffer } from "@/lib/voice";

// One private room's voice. The channel only carries "who is here" and the
// WebRTC handshake. Audio goes browser to browser and is never uploaded.
//
// Every join gets its own session id (sid), sent with everything. A page
// that reloaded, or rejoined, is a new sid: offers, answers and ICE meant for
// the old one are ignored instead of tearing down the new connection, and a
// peer whose sid changed is rebuilt from scratch.

export type VoicePerson = {
  id: string;
  name: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  connecting: boolean;
  me: boolean;
};

type Tracked = { name: string; muted: boolean; deafened: boolean; speaking: boolean; sid: string; at: number };

type Signal =
  | { kind: "hello"; from: string; sid: string; name: string }
  | { kind: "bye"; from: string; sid: string }
  | { kind: "offer" | "answer"; from: string; sid: string; to: string; toSid: string; sdp: string }
  | { kind: "ice"; from: string; sid: string; to: string; toSid: string; candidate: RTCIceCandidateInit };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  ice: RTCIceCandidateInit[];
  remoteSet: boolean;
  remoteSid: string;
  offerer: boolean;
  startedAt: number;
};

const STALL_MS = 15_000; // an offer that hasn't connected by then is tried again
const MAX_TRIES = 4;

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function asTracked(value: unknown): Tracked | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = str(row.name, 40).trim();
  return {
    name: name || "Someone",
    muted: row.muted === true,
    deafened: row.deafened === true,
    speaking: row.speaking === true,
    sid: str(row.sid, 64),
    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
  };
}

function asSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const from = str(row.from, 64);
  const sid = str(row.sid, 64);
  if (!from || !sid) return null;
  if (row.kind === "bye") return { kind: "bye", from, sid };
  if (row.kind === "hello") return { kind: "hello", from, sid, name: str(row.name, 40) };
  const to = str(row.to, 64);
  const toSid = str(row.toSid, 64);
  if (!to || !toSid) return null;
  if ((row.kind === "offer" || row.kind === "answer") && typeof row.sdp === "string" && row.sdp) {
    return { kind: row.kind, from, sid, to, toSid, sdp: row.sdp };
  }
  if (row.kind === "ice" && row.candidate && typeof row.candidate === "object") {
    return { kind: "ice", from, sid, to, toSid, candidate: row.candidate as RTCIceCandidateInit };
  }
  return null;
}

// TURN relays from the server (/api/voice/ice), so voice gets through
// networks that block direct connections. Public STUN if that fails.
async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/voice/ice", { cache: "no-store" });
    if (!res.ok) return ICE_SERVERS;
    const json = (await res.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(json.iceServers) && json.iceServers.length ? json.iceServers : ICE_SERVERS;
  } catch {
    return ICE_SERVERS;
  }
}

const newSid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export class VoiceSession {
  private channel: RealtimeChannel | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Uint8Array(0);
  private peers = new Map<string, Peer>();
  private presence = new Map<string, Tracked>();
  // The latest sid heard from each person (presence lags behind "hello").
  private heard = new Map<string, { sid: string; at: number; name: string }>();
  private earlyIce = new Map<string, RTCIceCandidateInit[]>();
  private tries = new Map<string, number>();
  private audioOn = false;
  private sid = "";
  private muted = false;
  private deafened = false;
  private speaking = false;
  private pendingLoud = false;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private joinGen = 0;
  private userId = "";
  private name = "Someone";
  private subscribed = false;
  private iceServers: RTCIceServer[] = ICE_SERVERS;
  private ready: Promise<void>;
  private resolveReady: (() => void) | null = null;

  constructor(
    readonly slug: string,
    private host: HTMLElement,
    private onChange: (people: VoicePerson[]) => void,
    private onError: (message: string | null) => void,
    private onHear: (needsTap: boolean) => void,
    // False once a newer session has taken over, so a page that's closing
    // can't tear down the channel the new one just opened.
    private isCurrent: () => boolean = () => true,
  ) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  watch() {
    if (this.channel || this.closed) return;
    void this.bind();
  }

  private alive() {
    return !this.closed && this.isCurrent();
  }

  private async bind() {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!this.alive()) return;
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
    if (!this.alive()) return;
    // supabase.channel() returns an existing channel with the same topic. One
    // left by a session that's still closing would be torn down under us.
    // A session that lost the race must not remove the channel the new one owns.
    const stale = supabase.getChannels().find((c) => c.topic === `realtime:voice:${this.slug}`);
    if (!this.alive()) return;
    if (stale) await supabase.removeChannel(stale).catch(() => {});
    if (!this.alive()) return;

    const channel = supabase.channel(`voice:${this.slug}`, {
      config: { broadcast: { self: false }, presence: { key: id } },
    });
    this.channel = channel;
    if (!this.alive()) {
      this.channel = null;
      return;
    }
    channel
      .on("presence", { event: "sync" }, () => this.onPresence())
      .on("presence", { event: "join" }, () => this.onPresence())
      .on("presence", { event: "leave" }, () => this.onPresence())
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        void this.onSignal(payload);
      })
      .subscribe((status) => {
        if (!this.alive()) return;
        if (status === "SUBSCRIBED") {
          this.resolveReady?.();
          // A reconnect drops what we'd announced: say it again.
          if (this.subscribed && this.audioOn) this.announce();
          this.subscribed = true;
          this.onError(null);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.onError("Voice lost its connection. Reconnecting…");
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
    const ice = loadIceServers();
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

    this.iceServers = await ice;
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
    this.sid = newSid();
    this.audioOn = true;
    this.speaking = false;
    this.applyMic();
    await this.publish();
    this.announce();
    this.watchdog = setInterval(() => this.checkStalled(), 4000);
    // One hello is easy to miss: both people reloading at once subscribe
    // after the other's hello has already gone. Keep introducing yourself.
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = setInterval(() => this.announce(), 3000);
    this.emit();
  }

  // Start muted or deafened (rejoining after a reload keeps what you had).
  preset(muted: boolean, deafened: boolean) {
    this.muted = muted;
    this.deafened = deafened;
  }

  async leave() {
    this.joinGen += 1;
    if (!this.audioOn) return;
    this.send({ kind: "bye", from: this.userId, sid: this.sid });
    this.audioOn = false;
    this.speaking = false;
    this.pendingLoud = false;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = null;
    await this.channel?.untrack().catch(() => {});
    this.stopAudio();
    this.closePeers();
    this.sid = "";
    this.emit();
  }

  // The page is going away (reload, closing the tab): tell the others now,
  // rather than leaving them on "Connecting" until the connection times out.
  goodbye() {
    if (!this.audioOn) return;
    this.send({ kind: "bye", from: this.userId, sid: this.sid });
    void this.channel?.untrack().catch(() => {});
  }

  // force: this session is the one being discarded (nobody replaced it), so
  // its channel has to go even though it is no longer "current".
  async close(opts?: { force?: boolean }) {
    this.closed = true;
    const channel = this.channel;
    await this.leave();
    if (this.channel !== channel) return;
    this.channel = null;
    if (channel && (opts?.force || this.isCurrent())) await createClient().removeChannel(channel).catch(() => {});
  }

  setMuted(on: boolean) {
    if (this.deafened) return;
    this.muted = on;
    if (on) this.speaking = false;
    if (!this.audioOn) return;
    this.applyMic();
    void this.publish();
    this.emit();
  }

  setDeafened(on: boolean) {
    this.deafened = on;
    if (on) this.speaking = false;
    if (!this.audioOn) return;
    this.applyMic();
    for (const peer of this.peers.values()) peer.audio.muted = on;
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

  get inVoice() {
    return this.audioOn;
  }

  private async untilReady() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Couldn't reach voice. Check your connection and try again.")), 10_000);
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
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async publish() {
    if (!this.channel || !this.audioOn) return;
    await this.channel
      .track({
        name: this.name,
        sid: this.sid,
        at: Date.now(),
        muted: this.muted || this.deafened,
        deafened: this.deafened,
        speaking: this.speaking && !this.muted && !this.deafened,
      })
      .catch(() => {});
  }

  private send(payload: Signal) {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event: "signal", payload }).catch(() => {});
  }

  private onPresence() {
    this.readPresence();
    this.connectAll();
    this.emit();
  }

  // Say who we are, and read whoever is already here. Safe to call often:
  // connectAll ignores people we're already talking to.
  private announce() {
    if (!this.audioOn || !this.channel || !this.userId || !this.sid) return;
    void this.publish();
    this.send({ kind: "hello", from: this.userId, sid: this.sid, name: this.name });
    this.readPresence();
    this.connectAll();
    this.emit();
  }

  private readPresence() {
    this.presence.clear();
    const state = this.channel?.presenceState() ?? {};
    for (const [id, metas] of Object.entries(state)) {
      if (!Array.isArray(metas)) continue;
      // A reload leaves the old page's presence beside the new one until the
      // old socket dies. The newest `at` is the page that's actually here.
      let best: Tracked | null = null;
      for (const meta of metas) {
        const tracked = asTracked(meta);
        if (tracked && (!best || tracked.at >= best.at)) best = tracked;
      }
      if (best) this.presence.set(id, best);
    }
  }

  // The sid someone is on now: whichever we learned of last.
  private sidOf(id: string) {
    const fromPresence = this.presence.get(id)?.sid ?? "";
    const fromHello = this.heard.get(id);
    if (fromHello && (!fromPresence || Date.now() - fromHello.at < 10_000)) return fromHello.sid;
    return fromPresence;
  }

  // Line up a connection with everyone in voice: rebuild any whose sid
  // changed, drop anyone who left, and offer where it's our turn.
  private connectAll() {
    if (!this.audioOn || !this.userId) return;
    for (const [id, peer] of [...this.peers]) {
      const sid = this.sidOf(id);
      const gone = !this.presence.has(id) && Date.now() - (this.heard.get(id)?.at ?? 0) > 10_000 && Date.now() - peer.startedAt > 10_000;
      if (gone || (sid && sid !== peer.remoteSid)) this.dropPeer(id);
    }
    const ids = new Set([...this.presence.keys(), ...this.heard.keys()]);
    for (const id of ids) {
      if (id === this.userId || this.peers.has(id)) continue;
      const sid = this.sidOf(id);
      if (sid && shouldOffer(this.userId, id)) void this.offer(id, sid);
    }
  }

  private checkStalled() {
    if (!this.audioOn) return;
    for (const [id, peer] of [...this.peers]) {
      const state = peer.pc.connectionState;
      if (state === "connected" || !peer.offerer || Date.now() - peer.startedAt < STALL_MS) continue;
      this.retry(id, peer.remoteSid);
    }
  }

  private retry(id: string, remoteSid: string) {
    const key = `${id}|${remoteSid}`;
    const attempt = (this.tries.get(key) ?? 0) + 1;
    this.tries.set(key, attempt);
    this.dropPeer(id);
    if (this.audioOn && attempt < MAX_TRIES && shouldOffer(this.userId, id)) void this.offer(id, remoteSid);
    this.emit();
  }

  private makePeer(id: string, remoteSid: string, offerer: boolean) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.muted = this.deafened;
    this.host.appendChild(audio);
    const peer: Peer = { pc, audio, ice: [], remoteSet: false, remoteSid, offerer, startedAt: Date.now() };
    this.stream?.getTracks().forEach((track) => {
      if (this.stream) pc.addTrack(track, this.stream);
    });
    pc.onicecandidate = (event) => {
      if (!event.candidate || this.peers.get(id) !== peer) return;
      this.send({ kind: "ice", from: this.userId, sid: this.sid, to: id, toSid: remoteSid, candidate: event.candidate.toJSON() });
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
      if (this.peers.get(id) !== peer) return;
      if (pc.connectionState === "connected") this.tries.delete(`${id}|${remoteSid}`);
      if (pc.connectionState === "failed") {
        // The offerer starts again; the other side waits for its new offer.
        if (offerer) this.retry(id, remoteSid);
        else this.dropPeer(id);
      }
      this.emit();
    };
    const key = `${id}|${remoteSid}`;
    const queued = this.earlyIce.get(key);
    if (queued) {
      peer.ice.push(...queued);
      this.earlyIce.delete(key);
    }
    this.peers.set(id, peer);
    return peer;
  }

  private dropPeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
  }

  private closePeers() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.earlyIce.clear();
    this.tries.clear();
  }

  private async flushIce(peer: Peer) {
    const queued = peer.ice.splice(0);
    for (const candidate of queued) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  private async offer(id: string, remoteSid: string) {
    if (!this.audioOn || this.closed || this.peers.has(id) || !this.stream) return;
    const peer = this.makePeer(id, remoteSid, true);
    try {
      const offer = await peer.pc.createOffer();
      if (this.peers.get(id) !== peer) return;
      await peer.pc.setLocalDescription(offer);
      if (this.peers.get(id) !== peer || !offer.sdp) return;
      this.send({ kind: "offer", from: this.userId, sid: this.sid, to: id, toSid: remoteSid, sdp: offer.sdp });
      this.emit();
    } catch {
      if (this.peers.get(id) === peer) this.dropPeer(id);
    }
  }

  private async onSignal(payload: unknown) {
    const signal = asSignal(payload);
    if (!signal || this.closed || signal.from === this.userId) return;
    // Meant for someone else, or for a page of ours that's gone.
    if ("to" in signal && (signal.to !== this.userId || signal.toSid !== this.sid)) return;

    if (signal.kind === "bye") {
      // A reloading page says bye for the sid that's going away. That must
      // not forget a hello from the page that just replaced it.
      const known = this.heard.get(signal.from);
      if (!known || known.sid === signal.sid) this.heard.delete(signal.from);
      if (this.peers.get(signal.from)?.remoteSid === signal.sid) this.dropPeer(signal.from);
      const meta = this.presence.get(signal.from);
      if (meta?.sid === signal.sid) this.presence.delete(signal.from);
      this.emit();
      return;
    }
    if (signal.kind === "hello") {
      const prev = this.heard.get(signal.from);
      this.heard.set(signal.from, { sid: signal.sid, at: Date.now(), name: signal.name || prev?.name || "" });
      this.connectAll();
      this.emit();
      return;
    }
    if (!this.audioOn) return;
    const prev = this.heard.get(signal.from);
    this.heard.set(signal.from, { sid: signal.sid, at: Date.now(), name: prev?.name ?? "" });

    if (signal.kind === "offer") {
      // Only the lower id offers; an offer the other way round is ignored.
      if (!shouldOffer(signal.from, this.userId)) return;
      this.dropPeer(signal.from);
      const peer = this.makePeer(signal.from, signal.sid, false);
      try {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        if (this.peers.get(signal.from) !== peer) return;
        peer.remoteSet = true;
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        if (this.peers.get(signal.from) !== peer) return;
        await peer.pc.setLocalDescription(answer);
        if (this.peers.get(signal.from) !== peer || !answer.sdp) return;
        this.send({ kind: "answer", from: this.userId, sid: this.sid, to: signal.from, toSid: signal.sid, sdp: answer.sdp });
      } catch {
        if (this.peers.get(signal.from) === peer) this.dropPeer(signal.from);
      }
      this.emit();
      return;
    }

    if (signal.kind === "ice") {
      const peer = this.peers.get(signal.from);
      if (peer && peer.remoteSid === signal.sid) {
        if (peer.remoteSet) void peer.pc.addIceCandidate(signal.candidate).catch(() => {});
        else peer.ice.push(signal.candidate);
        return;
      }
      // ICE often arrives before the offer that creates the connection.
      const key = `${signal.from}|${signal.sid}`;
      const queued = this.earlyIce.get(key) ?? [];
      if (queued.length < 60) queued.push(signal.candidate);
      this.earlyIce.set(key, queued);
      return;
    }

    // An answer: only for the offer we sent to that page.
    const peer = this.peers.get(signal.from);
    if (!peer || !peer.offerer || peer.remoteSid !== signal.sid || peer.pc.signalingState !== "have-local-offer") return;
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      peer.remoteSet = true;
      await this.flushIce(peer);
    } catch {
      if (this.peers.get(signal.from) === peer) this.retry(signal.from, peer.remoteSid);
    }
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
    // Presence can lag a reload. A hello is enough to show them and to start
    // the connection; presence fills in mute and speaking once it catches up.
    for (const [id, hello] of this.heard) {
      if (id === this.userId || this.presence.has(id)) continue;
      rest.push({
        id,
        name: hello.name || "Someone",
        muted: false,
        deafened: false,
        speaking: false,
        connecting: this.audioOn && this.peers.get(id)?.pc.connectionState !== "connected",
        me: false,
      });
    }
    rest.sort((a, b) => a.name.localeCompare(b.name));
    this.onChange([...people, ...rest]);
  }
}
