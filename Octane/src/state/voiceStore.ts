import { createOctaneStore } from './createOctaneStore';

/** One audio zone rectangle (tile coords), edited by admins in-game. */
/** Percentuais de volume (0-100) aplicados às três situações de uma zona. */
export interface VoiceZoneFactors
{
    same: number;
    other: number;
    outside: number;
}

export interface VoiceZoneArea
{
    id: number;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 0 = herda os fatores globais da sala; 1 = fatores próprios da zona. */
    factorMode: number;
    /** Preenchido somente quando factorMode === 1. */
    factors: VoiceZoneFactors | null;
}

/** One video tile in the transmission window (local preview or remote stream). */
export interface VoiceVideo
{
    /** Unique key: participantIdentity + ':' + source. */
    id: string;
    /** LiveKit participant identity (user-<id>) or 'Eu'. */
    identity: string;
    /** 'camera' | 'screen' */
    source: 'camera' | 'screen';
    /** The video MediaStreamTrack to render in a <video> element. */
    track: MediaStreamTrack;
    /** True when the track is our own local publish (no audio, show "Você"). */
    local: boolean;
    /** RemoteTrackPublication do LiveKit (controle de qualidade no receptor). */
    publication?: { setVideoQuality?: (quality: unknown) => void } | null;
}

/**
 * In-room voice state (LiveKit self-hosted, docs/PLANO-VOZ-CAMERA.md):
 * HUD switches, spatial ("proximity") mode vs "assembleia" (everyone hears
 * everyone) and the mute-on-blur user preference.
 */
interface VoiceState {
    /** LiveKit server url + access token handed by the emulator. */
    url: string;
    token: string;
    connected: boolean;
    connecting: boolean;
    /** "Assembleia" mode: everyone in the room hears everyone. */
    assembly: boolean;
    micOn: boolean;
    camOn: boolean;
    screenOn: boolean;
    /** Other people currently in the voice call. */
    remoteCount: number;
    /** Mute the mic automatically when the window loses focus, but only when nobody is listening. */
    autoMuteOnBlur: boolean;
    /** True while the auto-mute is active (focus left, mic forced off). */
    autoMuted: boolean;
    /** Last permission/device error message, shown in the settings menu. */
    error: string;
    /** Audio/video devices detected in the browser. */
    devices: MediaDeviceInfo[];
    /** Selected devices (persisted). */
    micDeviceId: string;
    speakerDeviceId: string;
    /** Remote audio volume, 0..1 (persisted). */
    volume: number;
    /** Video tiles currently published in the room (local + remote). */
    videos: VoiceVideo[];
    /** Window ids the user closed manually ('camera', 'screen:<identity>'). */
    hiddenWindows: Set<string>;
    /** Room audio zones (spatial voice) + whether this user may edit them. */
    zones: VoiceZoneArea[];
    canEditZones: boolean;
    /** Whether the audio-zone editor (admin) is open. */
    zoneEditorOpen: boolean;
    /** Per-room spatial volume factors (percent, server-configured). */
    zoneFactors: { same: number; other: number; outside: number };
    /** Modo global: transmissões (câmera/tela) visíveis na sala toda, fora das zonas. */
    videoGlobal: boolean;
    /** Identidades cujo vídeo está visível (mesma zona); null = todos visíveis. */
    videoVisible: Set<string> | null;
    /** LiveKit identities that already have a spatial factor applied. */
    spatialApplied: Set<string>;
    /** Raw floor heightmap of the current room (for the zone editor grid). */
    zoneTilemap: string;
    /** Display name of the current room (for the HUD location badge). */
    roomName: string;
    /** Index of the zone the user currently stands in, -1 when outside any zone. */
    currentZone: number;
    /** Quem está em qual zona (incl. eu): para o menu de pessoas e o contador de zona. */
    zonePeople: { zone: number; names: string[] }[];
    /** Mostra/oculta os textos de sala/zona sob os ícones de voz (olho no menu). */
    zoneInfoVisible: boolean;

    setUrl: (url: string) => void;
    setToken: (token: string) => void;
    setConnected: (connected: boolean) => void;
    setConnecting: (connecting: boolean) => void;
    setAssembly: (assembly: boolean) => void;
    setMicOn: (micOn: boolean) => void;
    setCamOn: (camOn: boolean) => void;
    setScreenOn: (screenOn: boolean) => void;
    setRemoteCount: (remoteCount: number) => void;
    setAutoMuteOnBlur: (autoMuteOnBlur: boolean) => void;
    setAutoMuted: (autoMuted: boolean) => void;
    setError: (error: string) => void;
    setDevices: (devices: MediaDeviceInfo[]) => void;
    setMicDeviceId: (micDeviceId: string) => void;
    setSpeakerDeviceId: (speakerDeviceId: string) => void;
    setVolume: (volume: number) => void;
    /** Adds/updates a video tile; auto-opens the matching window. */
    addVideo: (video: VoiceVideo) => void;
    removeVideo: (id: string) => void;
    clearVideos: () => void;
    /** Shows/hides one video window ('camera' or 'screen:<identity>'). */
    setWindowHidden: (id: string, hidden: boolean) => void;
    setZones: (zones: VoiceZoneArea[]) => void;
    setCanEditZones: (canEdit: boolean) => void;
    setZoneEditorOpen: (open: boolean) => void;
    setZoneFactors: (factors: { same: number; other: number; outside: number }) => void;
    setVideoGlobal: (videoGlobal: boolean) => void;
    setVideoVisible: (visible: Set<string> | null) => void;
    setZoneTilemap: (tilemap: string) => void;
    setRoomName: (roomName: string) => void;
    setCurrentZone: (currentZone: number) => void;
    setZonePeople: (zonePeople: { zone: number; names: string[] }[]) => void;
    setZoneInfoVisible: (visible: boolean) => void;
}

const STORAGE_KEY = 'octane:voice:auto-mute-on-blur';

const loadPref = (key: string, fallback: string): string =>
{
    try
    {
        return window.localStorage.getItem('octane:voice:' + key) ?? fallback;
    }
    catch
    {
        return fallback;
    }
};

const savePref = (key: string, value: string): void =>
{
    try
    {
        window.localStorage.setItem('octane:voice:' + key, value);
    }
    catch
    {
        // storage can be blocked; the preference just won't persist
    }
};

const loadAutoMuteOnBlur = (): boolean =>
{
    try
    {
        return window.localStorage.getItem(STORAGE_KEY) === '1';
    }
    catch
    {
        return false;
    }
};

export const useVoiceStore = createOctaneStore<VoiceState>()((set) => ({
    url: '',
    token: '',
    connected: false,
    connecting: false,
    assembly: false,
    micOn: false,
    camOn: false,
    screenOn: false,
    remoteCount: 0,
    autoMuteOnBlur: loadAutoMuteOnBlur(),
    autoMuted: false,
    error: '',
    devices: [],
    micDeviceId: loadPref('mic-device', ''),
    speakerDeviceId: loadPref('speaker-device', ''),
    volume: parseFloat(loadPref('volume', '1')) || 1,
    videos: [],
    hiddenWindows: new Set<string>(),
    zones: [],
    canEditZones: false,
    zoneEditorOpen: false,
    zoneFactors: { same: 100, other: 0, outside: 1 },
    videoGlobal: false,
    videoVisible: null,
    spatialApplied: new Set<string>(),
    zoneTilemap: '',
    roomName: '',
    currentZone: -1,
    zonePeople: [],
    zoneInfoVisible: (() =>
    {
        try
        {
            return window.localStorage.getItem('octane:voice:zone-info-visible') !== '0';
        }
        catch
        {
            return true;
        }
    })(),

    addVideo: (video) => set((state) =>
    {
        const videos = state.videos.filter((existing) => existing.id !== video.id);

        videos.push(video);

        // A new stream arriving reopens its own window (unless the user closed it
        // after the SAME stream started — hiddenWindows only clears on new adds
        // for that id, so a manual close during playback is respected).
        const hiddenWindows = new Set(state.hiddenWindows);

        if(video.source === 'camera' && !hiddenWindows.has(video.id)) hiddenWindows.delete('camera');
        else hiddenWindows.delete(video.id);

        return { videos, hiddenWindows };
    }),
    removeVideo: (id) => set((state) => ({ videos: state.videos.filter((video) => video.id !== id) })),
    clearVideos: () => set({ videos: [], hiddenWindows: new Set<string>() }),
    setWindowHidden: (id, hidden) => set((state) =>
    {
        const hiddenWindows = new Set(state.hiddenWindows);

        if(hidden) hiddenWindows.add(id);
        else hiddenWindows.delete(id);

        return { hiddenWindows };
    }),
    setZones: (zones) => set({ zones }),
    setCanEditZones: (canEditZones) => set({ canEditZones }),
    setZoneEditorOpen: (zoneEditorOpen) => set({ zoneEditorOpen }),
    setZoneFactors: (zoneFactors) => set({ zoneFactors }),
    setVideoGlobal: (videoGlobal) => set({ videoGlobal }),
    setVideoVisible: (videoVisible) => set({ videoVisible }),
    setZoneTilemap: (zoneTilemap) => set({ zoneTilemap }),
    setRoomName: (roomName) => set({ roomName }),
    setCurrentZone: (currentZone) => set({ currentZone }),
    setZonePeople: (zonePeople) => set({ zonePeople }),
    setZoneInfoVisible: (zoneInfoVisible) =>
    {
        try
        {
            window.localStorage.setItem('octane:voice:zone-info-visible', zoneInfoVisible ? '1' : '0');
        }
        catch
        {
            // storage can be blocked; the preference just won't persist
        }

        set({ zoneInfoVisible });
    },

    setError: (error) => set({ error }),
    setDevices: (devices) => set({ devices }),
    setMicDeviceId: (micDeviceId) => { savePref('mic-device', micDeviceId); set({ micDeviceId }); },
    setSpeakerDeviceId: (speakerDeviceId) => { savePref('speaker-device', speakerDeviceId); set({ speakerDeviceId }); },
    setVolume: (volume) => { savePref('volume', String(volume)); set({ volume }); },

    setUrl: (url) => set({ url }),
    setToken: (token) => set({ token }),
    setConnected: (connected) => set({ connected }),
    setConnecting: (connecting) => set({ connecting }),
    setAssembly: (assembly) => set({ assembly }),
    setMicOn: (micOn) => set({ micOn }),
    setCamOn: (camOn) => set({ camOn }),
    setScreenOn: (screenOn) => set({ screenOn }),
    setRemoteCount: (remoteCount) => set({ remoteCount }),
    setAutoMuteOnBlur: (autoMuteOnBlur) =>
    {
        try
        {
            window.localStorage.setItem(STORAGE_KEY, autoMuteOnBlur ? '1' : '0');
        }
        catch
        {
            // storage can be blocked; the preference just won't persist
        }

        set({ autoMuteOnBlur });
    },
    setAutoMuted: (autoMuted) => set({ autoMuted })
}));
