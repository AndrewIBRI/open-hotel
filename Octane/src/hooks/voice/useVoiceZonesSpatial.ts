import { useEffect, useRef } from 'react';
import { GetRoomEngine, GetSessionDataManager, RoomObjectCategory } from '@octane/renderer';
import { GetRoomSession } from '../../api';
import { voiceConnection } from '../../api/voice/VoiceConnection';
import { useVoiceStore, VoiceZoneArea, VoiceZoneFactors } from '../../state/voiceStore';

const SPATIAL_TICK_MS = 500;

/** Default volume levels: same zone = full, other zone = bleed, outside = muffled. */
const DEFAULT_SAME = 100;
const DEFAULT_OTHER = 0;
const DEFAULT_OUTSIDE = 1;
const FACTOR_FULL = 1;

interface UserTile
{
    webID: number;
    x: number;
    y: number;
}

/**
 * Última posição conhecida por webID. Enquanto o avatar caminha/carrega, o
 * objeto de sala pode não expor getLocation(): sem cache o usuário era
 * ignorado no tick e ficava com o fator de volume anterior (som vazando).
 */
const lastKnownLocation = new Map<number, { x: number; y: number }>();

/** Zona anterior do usuário local (para logar entrada/saída). */
let previousZone = -2;

/** Extrai o webID da identidade LiveKit (user-<id>). */
const webIdOf = (identity: string): number =>
{
    const webID = parseInt(identity.replace(/^user-/, ''), 10);

    return Number.isFinite(webID) && webID > 0 ? webID : -1;
};

/** Reads every avatar's tile and applies per-participant volume by zone. */
const applySpatial = () =>
{
    const state = useVoiceStore.getState();
    const remotes = voiceConnection.getRemoteParticipants();

    // Sem zonas (ou modo assembleia): todos no mesmo volume e todos visíveis.
    if(!state.zones.length || state.assembly)
    {
        useVoiceStore.setState({ currentZone: -1, videoVisible: null });

        const full = new Map<string, number>();

        for(const remote of remotes) full.set(remote.identity, FACTOR_FULL);

        // Aplica a TODOS os remotos, inclusive os que ainda não têm fator salvo.
        voiceConnection.applySpatialFactors(full);

        return;
    }

    const session = GetRoomSession();

    if(!session) return;

    const userId = GetSessionDataManager().userId;
    const userDataManager = session.userDataManager;
    const users: UserTile[] = [];

    for(const unit of GetRoomEngine().getRoomObjects(session.roomId, RoomObjectCategory.UNIT))
    {
        const userData = userDataManager.getUserDataByIndex(unit.id);

        if(!userData || userData.webID <= 0) continue;

        // Os objetos de sala expõem a posição por getLocation() (IVector3D), não por propriedade.
        const location = typeof unit.getLocation === 'function'
            ? unit.getLocation()
            : (unit as { location?: { x: number; y: number } }).location;
        const current = location
            ? { x: Math.floor(location.x), y: Math.floor(location.y) }
            : null;

        // Posição ausente/inválida (andando ou carregando): reusa a última conhecida.
        const tile = current && Number.isFinite(current.x) && Number.isFinite(current.y)
            ? current
            : lastKnownLocation.get(userData.webID);

        if(!tile) continue;

        lastKnownLocation.set(userData.webID, tile);
        users.push({ webID: userData.webID, x: tile.x, y: tile.y });
    }

    const factors = state.zoneFactors ?? { same: DEFAULT_SAME, other: DEFAULT_OTHER, outside: DEFAULT_OUTSIDE };

    const zoneOf = (zones: VoiceZoneArea[], x: number, y: number): number =>
    {
        for(let i = 0; i < zones.length; i++)
        {
            const zone = zones[i];

            if(x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) return i;
        }

        return -1;
    };

    const me = users.find((user) => user.webID === userId);

    // Sem a minha posição conhecida não dá para calcular proximidade: silencia
    // todos com o fator 'outside' para não vazar som de outra zona.
    if(!me)
    {
        const fallback = new Map<string, number>();

        for(const remote of remotes) fallback.set(remote.identity, factors.outside / 100);

        voiceConnection.applySpatialFactors(fallback);
        useVoiceStore.setState({ currentZone: -1, videoVisible: new Set<string>(), spatialApplied: new Set(fallback.keys()) });

        return;
    }

    const myZone = zoneOf(state.zones, me.x, me.y);

    // [Zonas] Log de debug: entrada/saída de zona + quem está em cada zona.
    if(myZone !== previousZone)
    {
        const zoneName = (index: number): string => (index >= 0 ? state.zones[index]?.name ?? `#${index}` : 'FORA DE ZONA');
        const inMyZone = users
            .filter((user) => user.webID !== userId && zoneOf(state.zones, user.x, user.y) === myZone)
            .map((user) => userDataManager.getUserDataByIndex(user.webID)?.name ?? `user-${user.webID}`);
        const zoneCounts: Record<string, string[]> = {};

        for(const user of users)
        {
            const key = zoneName(zoneOf(state.zones, user.x, user.y));

            (zoneCounts[key] = zoneCounts[key] ?? []).push(user.webID === userId ? `${GetSessionDataManager().userName} (eu)` : userDataManager.getUserDataByIndex(user.webID)?.name ?? `user-${user.webID}`);
        }

        console.log(`[Zonas] ${previousZone === -2 ? 'Início' : 'Mudança de zona'}: agora em "${zoneName(myZone)}" (antes: ${zoneName(previousZone)})`);
        console.log('[Zonas] Pessoas conectadas por zona:', JSON.stringify(zoneCounts), '| conectados no LiveKit:', remotes.map((r) => r.name || r.identity).join(', '));
        console.log(`[Zonas] Na minha zona ("${zoneName(myZone)}"):`, inMyZone.length ? inMyZone.join(', ') : '(ninguém)');
    }

    previousZone = myZone;

    /**
     * Fator efetivo = o da zona ONDE EU ESTOU, se ela tiver fatores próprios;
     * senão os padrões da sala. Não usamos a zona do outro participante: o
     * objetivo é personalizar cada zona ("quarto X quase não vaza som para
     * fora"), e o volume é aplicado à faixa DELE no meu receptor — então a
     * decisão tem de partir da minha zona, aquela em que eu estou.
     */
    const effectiveFactors: VoiceZoneFactors =
        myZone >= 0 && state.zones[myZone]?.factorMode === 1 && state.zones[myZone]?.factors
            ? state.zones[myZone].factors!
            : factors;

    // Indicador do HUD: em qual zona estamos agora.
    useVoiceStore.setState({ currentZone: myZone });

    const applied = new Map<string, number>();
    const visible = new Set<string>();

    // Mesma semântica de antes: "mesma zona" inclui ambos fora de zona (área
    // aberta comum); "fora de zona" é um dentro e outro fora.
    const proximity = (theirZone: number): { factor: number; sameArea: boolean } =>
    {
        if(myZone === -1 && theirZone === -1) return { factor: effectiveFactors.same / 100, sameArea: true };
        if(myZone === -1 || theirZone === -1) return { factor: effectiveFactors.outside / 100, sameArea: false };

        return { factor: (theirZone === myZone ? effectiveFactors.same : effectiveFactors.other) / 100, sameArea: theirZone === myZone };
    };

    for(const user of users)
    {
        if(user.webID === userId) continue;

        // Identidade LiveKit do usuário (ver voiceServer/token).
        const identity = `user-${user.webID}`;
        const { factor, sameArea } = proximity(zoneOf(state.zones, user.x, user.y));

        applied.set(identity, factor);

        // Vídeo segue o MESMO modelo do áudio: só visível na mesma área. O modo
        // global (videoGlobal) mostra pra sala inteira, ignorando as zonas.
        if(state.videoGlobal || sameArea) visible.add(identity);
    }

    // Participantes remotos SEM tile no engine: usam a ÚLTIMA posição
    // conhecida; sem cache recebem 'outside' (muffled) — nunca o fator full,
    // para não vazar som por engano.
    const knownIds = new Set<number>([ userId ]);

    for(const remote of remotes)
    {
        const webID = webIdOf(remote.identity);

        if(webID > 0) knownIds.add(webID);

        if(applied.has(remote.identity)) continue;

        const cached = webID > 0 ? lastKnownLocation.get(webID) : undefined;
        const factor = cached
            ? proximity(zoneOf(state.zones, cached.x, cached.y)).factor
            : effectiveFactors.outside / 100;

        applied.set(remote.identity, factor);

        if(state.videoGlobal) visible.add(remote.identity);
    }

    // Limpa posições de quem saiu da sala (mantém a minha, que é local).
    for(const webID of Array.from(lastKnownLocation.keys()))
    {
        if(!knownIds.has(webID)) lastKnownLocation.delete(webID);
    }

    voiceConnection.applySpatialFactors(applied);
    useVoiceStore.setState({ spatialApplied: new Set(applied.keys()), videoVisible: visible });
};

/**
 * Spatial voice via audio zones: a light 500ms tick reads avatar tiles from
 * the room engine and tells the LiveKit connection which volume factor each
 * remote participant should have. Mounted with the room voice widgets.
 */
export const useVoiceZonesSpatial = () =>
{
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() =>
    {
        applySpatial();
        timer.current = setInterval(applySpatial, SPATIAL_TICK_MS);

        return () =>
        {
            if(timer.current) clearInterval(timer.current);
            timer.current = null;
        };
    }, []);
};
