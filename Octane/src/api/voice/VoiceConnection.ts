import { LocalParticipant, ParticipantEvent, RemoteAudioTrack, RemoteParticipant, Room, RoomEvent, Track, VideoPresets, VideoQuality } from 'livekit-client';
import { useVoiceStore } from '../../state/voiceStore';

/**
 * Thin singleton around a LiveKit room (docs/PLANO-VOZ-CAMERA.md).
 *
 * Spatial voice: while the room is not in "assembleia" mode the emulator-side
 * zone rules apply; this class only publishes/subscribes tracks — the server
 * decides who connects where. Remote mic audio is auto-attached to <audio>
 * elements so browsers play it without extra UI.
 */

/**
 * Fator preventivo para participantes cuja zona ainda não foi calculada
 * (ex.: migração/assinatura de faixa antes do primeiro tick espacial).
 * Nunca usar 1 aqui: isso deixaria ouvir, em volume cheio, alguém que ainda
 * não foi enquadrado em nenhuma zona — exatamente o vazamento de som que o
 * tick espacial corrige. O hook sobrescreve esse valor com o fator real.
 */
const SPATIAL_DEFAULT_FACTOR = 0.05;
/** Maps browser getUserMedia/getDisplayMedia failures to short pt-BR hints. */
const describeMediaError = (error: unknown): string =>
{
    const name = (error as { name?: string; message?: string })?.name ?? '';

    if(name.includes('NotAllowed') || name.includes('Permission')) return 'Permissão negada no navegador — libere mic/câmera nas configurações do site (ícone do cadeado na barra de endereço).';
    if(name.includes('NotFound')) return 'Nenhum dispositivo encontrado.';
    if(name.includes('NotReadable')) return 'O dispositivo está em uso por outro aplicativo.';
    if(name.includes('getDisplayMedia') || name.includes('AbortError')) return 'Compartilhamento de tela cancelado.';

    return 'Falha ao acessar o dispositivo: ' + (name || 'erro desconhecido');
};

class VoiceConnection
{
    private _room: Room = null;

    public async connect(url: string, token: string): Promise<void>
    {
        const store = useVoiceStore.getState();

        if(!url || !token) return;

        this.disconnect();

        // Qualidade máxima: captura até 1080p e encoding generoso (padrão
        // LiveKit é 640x480 @ 500kbps — borrado em monitores 4K).
        const room = new Room({
            dynacast: false,
            // adaptiveStream: quem recebe pede a camada compatível com o tamanho
            // da janela (economiza banda/PC fraco); qualidade manual/fullscreen
            // sobrepõe via publication.setVideoQuality.
            adaptiveStream: true,
            videoCaptureDefaults: { resolution: VideoPresets.h1080 },
            publishDefaults: { videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 } },
        });

        // sem isto o singleton nunca tem a referência da sala e todo
        // mic/câmera/tela cai no early-return silencioso de _localParticipant()
        this._room = room;

        this._bind(room);

        store.setConnecting(true);

        try
        {
            await room.connect(url, token);

            console.log('[Octane] [Voice] CONECTADO ao LiveKit', room.name);

            useVoiceStore.getState().setConnected(true);
            useVoiceStore.getState().setConnecting(false);
            useVoiceStore.getState().setError('');

            // Toggles clicados antes de conectar: aplica agora.
            const pending = useVoiceStore.getState();
            const wantMic = pending.micOn;
            const wantCam = pending.camOn;
            const wantScreen = pending.screenOn;

            useVoiceStore.getState().setMicOn(wantMic);
            useVoiceStore.getState().setCamOn(wantCam);
            useVoiceStore.getState().setScreenOn(wantScreen);

            if(wantMic) this.setMicEnabled(true);
            if(wantCam) this.setCameraEnabled(true);
            if(wantScreen) this.setScreenShareEnabled(true);
            this._refreshRemoteCount();
            this.refreshDevices();
        }
        catch (error)
        {
            console.error('[Octane] [Voice] FALHA ao conectar ao LiveKit:', error);
            console.error('[Octane] [Voice] url tentada:', url, '| token (20 chars):', token?.slice(0, 20));

            useVoiceStore.getState().setConnecting(false);
            useVoiceStore.getState().setConnected(false);

            throw error;
        }
    }

    public disconnect(): void
    {
        if(this._room)
        {
            this._room.disconnect();

            this._room = null;
        }

        useVoiceStore.getState().setConnected(false);
        useVoiceStore.getState().setConnecting(false);
        useVoiceStore.getState().setMicOn(false);
        useVoiceStore.getState().setCamOn(false);
        useVoiceStore.getState().setScreenOn(false);
        useVoiceStore.getState().setRemoteCount(0);
    }

    public get isConnected(): boolean
    {
        return !!this._room && this._room.state === 'connected';
    }

    public async setMicEnabled(enabled: boolean): Promise<boolean>
    {
        const participant = this._localParticipant();

        if(!participant)
        {
            console.warn('[Octane] [Voice] ignorado: sem sala LiveKit conectada (participant=null)');

            return false;
        }

        try
        {
            console.log('[Octane] [Voice] setMicrophoneEnabled(' + enabled + ') — pedindo permissão ao navegador…');
            await participant.setMicrophoneEnabled(enabled);
            console.log('[Octane] [Voice] mic ' + (enabled ? 'LIGADO' : 'DESLIGADO'), participant.getTrackPublication(Track.Source.Microphone)?.track);
        }
        catch (error)
        {
            console.error('[Octane] [Voice] ERRO no microfone:', error);

            useVoiceStore.getState().setError(describeMediaError(error));

            return false;
        }

        useVoiceStore.getState().setMicOn(enabled);
        useVoiceStore.getState().setAutoMuted(false);

        return true;
    }

    public async setCameraEnabled(enabled: boolean): Promise<boolean>
    {
        const participant = this._localParticipant();

        if(!participant)
        {
            console.warn('[Octane] [Voice] ignorado: sem sala LiveKit conectada (participant=null)');

            return false;
        }

        try
        {
            console.log('[Octane] [Voice] setCameraEnabled(' + enabled + ') — pedindo permissão ao navegador…');
            await participant.setCameraEnabled(enabled);
            console.log('[Octane] [Voice] câmera ' + (enabled ? 'LIGADA' : 'DESLIGADA'));
        }
        catch (error)
        {
            console.error('[Octane] [Voice] ERRO na câmera:', error);

            useVoiceStore.getState().setError(describeMediaError(error));

            return false;
        }

        useVoiceStore.getState().setCamOn(enabled);

        // keep the transmission window in sync with the local camera
        const cameraPub = participant.getTrackPublication(Track.Source.Camera);

        if(enabled && cameraPub?.track) this._upsertVideo(cameraPub.track, participant.identity, 'camera', true);
        else this._removeVideo(participant.identity, 'camera');

        return true;
    }

    public async setScreenShareEnabled(enabled: boolean): Promise<boolean>
    {
        const participant = this._localParticipant();

        if(!participant)
        {
            console.warn('[Octane] [Voice] ignorado: sem sala LiveKit conectada (participant=null)');

            return false;
        }

        try
        {
            console.log('[Octane] [Voice] setScreenShareEnabled(' + enabled + ') — abrindo seletor do navegador…');
            await participant.setScreenShareEnabled(
                enabled,
                { audio: true, resolution: VideoPresets.h2160 },
                { videoEncoding: { maxBitrate: 12_000_000, maxFramerate: 30 } });
            console.log('[Octane] [Voice] tela ' + (enabled ? 'COMPARTILHADA' : 'PARADA'));
        }
        catch (error)
        {
            console.error('[Octane] [Voice] ERRO no compartilhamento de tela:', error);

            useVoiceStore.getState().setError(describeMediaError(error));
            useVoiceStore.getState().setScreenOn(!enabled); // revert (e.g. picker cancelled)

            return false;
        }

        useVoiceStore.getState().setScreenOn(enabled);

        // keep the transmission window in sync with the local screen share
        const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);

        if(enabled && screenPub?.track) this._upsertVideo(screenPub.track, participant.identity, 'screen', true);
        else this._removeVideo(participant.identity, 'screen');

        return true;
    }

    /** Lists the browser's mic/camera/speaker devices (labels need prior permission). */
    public async refreshDevices(): Promise<void>
    {
        try
        {
            const devices = await navigator.mediaDevices.enumerateDevices();

            useVoiceStore.getState().setDevices(devices);
        }
        catch
        {
            // without permission the list comes back empty-labeled; not fatal
        }
    }

    public async setMicDevice(deviceId: string): Promise<void>
    {
        const store = useVoiceStore.getState();

        if(this.isConnected && this._room.switchActiveDevice)
        {
            try
            {
                await this._room.switchActiveDevice('audioinput', deviceId);
            }
            catch (error)
            {
                store.setError(describeMediaError(error));
            }
        }

        store.setMicDeviceId(deviceId);
    }

    public async setSpeakerDevice(deviceId: string): Promise<void>
    {
        const store = useVoiceStore.getState();

        if(this.isConnected && this._room.switchActiveDevice)
        {
            try
            {
                await this._room.switchActiveDevice('audiooutput', deviceId);
            }
            catch (error)
            {
                store.setError(describeMediaError(error));
            }
        }

        store.setSpeakerDeviceId(deviceId);
    }

    /** Per-participant spatial factor (audio zones); 1 = full volume. */
    private _spatialFactors: Map<string, number> = new Map();

    /**
     * Applies base volume × spatial factor to every subscribed remote
     * mic/screen-audio track (optionally only one participant).
     */
    private _applyVolume(identity?: string): void
    {
        const base = useVoiceStore.getState().volume;

        for(const participant of Array.from(this._room?.remoteParticipants.values() ?? []))
        {
            if(identity && participant.identity !== identity) continue;

            const factor = this._spatialFactors.get(participant.identity) ?? SPATIAL_DEFAULT_FACTOR;

            let appliedAny = false;

            for(const publication of participant.trackPublications.values())
            {
                const track = publication?.track as RemoteAudioTrack | undefined;

                if(!track || track.kind !== 'audio' || typeof track.setVolume !== 'function') continue;

                track.setVolume(base * factor);
                appliedAny = true;

                if((publication.source as string) !== Track.Source.Microphone)
                {
                    console.log(`[Zonas] atenção: áudio de ${participant.identity} veio com source="${String(publication.source)}" (não Microphone)`);
                }
            }

            if(!appliedAny)
            {
                console.log(`[Zonas] volume NÃO aplicado a ${participant.identity}: nenhuma track de áudio publicada/subscrita ainda`);
            }
        }
    }

    /** Applies the saved volume to every subscribed remote mic/screen-audio track. */
    public setVolume(volume: number): void
    {
        useVoiceStore.getState().setVolume(volume);

        this._applyVolume();
    }

    /**
     * Spatial audio (audio zones): 1.0 same zone, 0.1 other zone,
     * 0.35 outside any zone. Applied per remote participant.
     */
    public setSpatialVolume(identity: string, factor: number): void
    {
        if(this._spatialFactors.get(identity) === factor) return;

        this._spatialFactors.set(identity, factor);

        const name = this.getRemoteParticipants().find((p) => p.identity === identity)?.name ?? identity;

        console.log(`[Zonas] volume de ${name}: ${Math.round(factor * 100)}%`);

        this._applyVolume(identity);
    }

    /** Reapplies the spatial factor when a new remote track subscribes. */
    public refreshSpatialVolume(identity: string): void
    {
        this._applyVolume(identity);
    }

    /**
     * Snapshot dos participantes remotos (identidade LiveKit + nome exibido).
     * Usado pelo tick espacial para alcançar também quem não tem tile no
     * engine, e pelo badge de contagem para listar quem está na sala.
     */
    public getRemoteParticipants(): { identity: string; name: string }[]
    {
        if(!this._room) return [];

        return Array.from(this._room.remoteParticipants.values()).map((participant) => ({
            identity: participant.identity,
            name: participant.name
        }));
    }

    /**
     * Aplica em lote os fatores calculados pelo hook espacial e remove as
     * entradas de participantes que saíram da sala. Todo participante remoto
     * deve receber um fator: deixar de processar alguém mantinha o fator
     * antigo (ou o default 1) e vazava som de fora da zona.
     */
    public applySpatialFactors(factors: Map<string, number>): void
    {
        const present = new Set(this.getRemoteParticipants().map((participant) => participant.identity));

        for(const [identity, factor] of factors)
        {
            if(present.has(identity)) this.setSpatialVolume(identity, factor);
        }

        // Participantes desconectados: descarta o fator antigo para não
        // ressuscitá-lo se a identidade voltar a aparecer na sala.
        for(const identity of Array.from(this._spatialFactors.keys()))
        {
            if(!present.has(identity)) this._spatialFactors.delete(identity);
        }
    }

    /** Registers/updates a video tile in the transmission window. */
    private _upsertVideo(track: Track, identity: string, source: 'camera' | 'screen', local: boolean, publication?: unknown): void
    {
        const streamTrack = (track as unknown as { mediaStreamTrack?: MediaStreamTrack }).mediaStreamTrack;

        if(!streamTrack) return;

        const qualityPublication = publication as { setVideoQuality?: (quality: VideoQuality) => void } | undefined;

        useVoiceStore.getState().addVideo({ id: identity + ':' + source, identity, source, track: streamTrack, local, publication: qualityPublication ?? null });

        console.log('[Octane] [Voice] vídeo na janela:', identity, source, local ? '(local)' : '(remoto)');
    }

    private _removeVideo(identity: string, source: 'camera' | 'screen'): void
    {
        useVoiceStore.getState().removeVideo(identity + ':' + source);
    }

    private _localParticipant(): LocalParticipant
    {
        return this._room?.localParticipant ?? null;
    }

    private _refreshRemoteCount(): void
    {
        useVoiceStore.getState().setRemoteCount(this._room ? Array.from(this._room.remoteParticipants.values()).length : 0);
    }

    private _bind(room: Room): void
    {
        room.on(RoomEvent.ParticipantConnected, () => this._refreshRemoteCount());
        room.on(RoomEvent.ParticipantDisconnected, () => this._refreshRemoteCount());

        room.on(RoomEvent.TrackSubscribed, (track: Track, publication: unknown, participant: RemoteParticipant) =>
        {
            console.log('[Octane] [Voice] track remoto recebido:', track.source, track.kind);

            if(track.source === Track.Source.Microphone)
            {
                track.attach(); // creates + plays an <audio> element automatically

                const { volume } = useVoiceStore.getState();
                const remote = track as RemoteAudioTrack;
                const spatialFactor = this._spatialFactors.get(participant.identity) ?? SPATIAL_DEFAULT_FACTOR;

                // Aplica JÁ o fator espacial: aplicar volume cheio e esperar o
                // tick corrigir deixava som 100% por um blip (pior: se o fator
                // não mudasse, o early-return de setSpatialVolume nunca
                // re-aplicava e o som ficava no máximo para sempre).
                if(typeof remote.setVolume === 'function') remote.setVolume(volume * spatialFactor);

                this._refreshRemoteCount();
            }
            else if(track.source === Track.Source.Camera)
            {
                this._upsertVideo(track, participant.identity, 'camera', false, publication);
            }
            else if(track.source === Track.Source.ScreenShare)
            {
                this._upsertVideo(track, participant.identity, 'screen', false, publication);
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: Track, _publication: unknown, participant: RemoteParticipant) =>
        {
            if(track.source === Track.Source.Microphone)
            {
                track.detach().forEach((element) => element.remove());
            }
            else if(track.source === Track.Source.Camera)
            {
                this._removeVideo(participant.identity, 'camera');
            }
            else if(track.source === Track.Source.ScreenShare)
            {
                this._removeVideo(participant.identity, 'screen');
            }
        });

        // Mute/unmute também abre/fecha o pop-up do outro lado: alguns clientes
        // apenas silenciam o track (sem unpublish), então TrackSubscribed/Unsubscribed
        // não disparam e o pop-up ficaria preso na tela.
        room.on(RoomEvent.TrackMuted, (publication: { source?: Track.Source }, participant: RemoteParticipant) =>
        {
            if(publication?.source === Track.Source.Camera) this._removeVideo(participant.identity, 'camera');
        });

        room.on(RoomEvent.TrackUnmuted, (publication: { source?: Track.Source }, participant: RemoteParticipant) =>
        {
            if(publication?.source === Track.Source.Camera) this._upsertVideo((publication as { track?: Track }).track, participant.identity, 'camera', false, publication);
        });

        room.on(RoomEvent.Disconnected, () =>
        {
            this._room = null;

            useVoiceStore.getState().setConnected(false);
            useVoiceStore.getState().setMicOn(false);
            useVoiceStore.getState().setCamOn(false);
            useVoiceStore.getState().setScreenOn(false);
            useVoiceStore.getState().setRemoteCount(0);
            useVoiceStore.getState().clearVideos();
            this._spatialFactors.clear();
        });

        for(const participant of Array.from(room.remoteParticipants.values()))
        {
            participant.on(ParticipantEvent.TrackSubscribed, (track: Track, publication: unknown) =>
            {
                if(track.source === Track.Source.Microphone)
                {
                    track.attach();
                    this.refreshSpatialVolume(participant.identity);
                }
                else if(track.source === Track.Source.Camera) this._upsertVideo(track, participant.identity, 'camera', false, publication);
                else if(track.source === Track.Source.ScreenShare) this._upsertVideo(track, participant.identity, 'screen', false, publication);
            });

            participant.on(ParticipantEvent.TrackUnsubscribed, (track: Track) =>
            {
                if(track.source === Track.Source.Microphone)
                {
                    track.detach().forEach((element) => element.remove());
                }
                else if(track.source === Track.Source.Camera)
                {
                    this._removeVideo(participant.identity, 'camera');
                }
                else if(track.source === Track.Source.ScreenShare)
                {
                    this._removeVideo(participant.identity, 'screen');
                }
            });
        }
    }
}

export const voiceConnection = new VoiceConnection();
