import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { GetGuestRoomResultEvent } from '@octane/renderer';
import { useMessageEvent } from '../../../../hooks';
import { classNames } from '../../../../layout';
import { useVoice } from '../../../../hooks/voice/useVoice';
import { useVoiceZonesSpatial } from '../../../../hooks/voice/useVoiceZonesSpatial';
import { GetRoomSession } from '../../../../api';
import { voiceConnection } from '../../../../api/voice/VoiceConnection';
import { useVoiceStore } from '../../../../state/voiceStore';
import '../../../../css/room/VoiceWidget.css';

/** Nomes dos participantes remotos para a listinha do badge de contagem. */
const getPeople = (): { identity: string; name: string }[] =>
{
    const userDataManager = GetRoomSession()?.userDataManager;

    return voiceConnection.getRemoteParticipants().map((participant) =>
    {
        if(participant.name) return { identity: participant.identity, name: participant.name };

        const webID = parseInt(participant.identity.replace(/^user-/, ''), 10);
        const name = Number.isFinite(webID) && webID > 0
            ? (userDataManager?.getUserData(webID)?.name || participant.identity)
            : participant.identity;

        return { identity: participant.identity, name };
    });
};

/**
 * HUD do sistema de voz de sala (docs/PLANO-VOZ-CAMERA.md): microfone,
 * câmera, compartilhamento de tela, indicador do modo "assembleia" e um
 * menu de configuração (dispositivos de áudio + volume).
 * Sob os ícones: texto fixo com a sala + nº de pessoas e outro com a zona
 * atual + nº de pessoas na zona (clicável: abre a lista por zona).
 * O olho "Visualizar zona" no menu mostra/oculta esses textos.
 * Clique com o botão direito no microfone alterna o mute automático
 * ao perder o foco (só quando ninguém está ouvindo).
 */
export const VoiceWidgetView: FC<{}> = (props) =>
{
    const { requestToken, disconnect, toggleMic, toggleCam, toggleScreen, refreshDevices, setMicDevice, setSpeakerDevice, setVolume } = useVoice();
    useVoiceZonesSpatial();

    const { connected, connecting, micOn, camOn, screenOn, assembly, remoteCount, autoMuteOnBlur, autoMuted, error, devices, micDeviceId, speakerDeviceId, volume, setAutoMuteOnBlur, canEditZones, setZoneEditorOpen, setRoomName, zones, currentZone, roomName, zonePeople, zoneInfoVisible, setZoneInfoVisible } = useVoiceStore();

    // Nome da sala atual (badge de localização do HUD).
    useMessageEvent<GetGuestRoomResultEvent>(GetGuestRoomResultEvent, (event) =>
    {
        const parser = event.getParser();

        if(!parser.roomEnter) return;

        const session = GetRoomSession();

        if(!session || parser.data.roomId !== session.roomId) return;

        setRoomName(parser.data.roomName || '');
    });

    const [ menuOpen, setMenuOpen ] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const [ peopleOpen, setPeopleOpen ] = useState(false);
    const peopleRef = useRef<HTMLDivElement>(null);
    const people = peopleOpen ? getPeople() : [];

    const hasZoneData = zones.length > 0 && zonePeople.length > 0;

    // Grupos do menu de pessoas: quem está em qual zona (inclusive eu).
    // Sem zonas (assembleia): um grupo só, "Sala".
    const groups: { title: string; names: string[] }[] = hasZoneData
        ? zonePeople.map((group) => ({ title: group.zone >= 0 && zones[group.zone] ? zones[group.zone].name : 'Fora de zona', names: group.names }))
        : (people.length > 0
            ? [ { title: 'Sala', names: [ `${ roomName || 'Sala' }: ${ people.map((person) => person.name).join(', ') }` ] } ]
            : []);

    // Contadores: sala toda (incl. eu) e só a minha zona.
    const roomCount = remoteCount + 1;
    const zoneGroup = zonePeople.find((group) => group.zone === currentZone);
    const zoneCount = zoneGroup ? zoneGroup.names.length : 1;
    const zoneTitle = currentZone >= 0 && zones[currentZone] ? zones[currentZone].name : 'Fora de zona';
    const showZoneInfo = zoneInfoVisible && (roomName !== '' || zones.length > 0);

    // Se a sala esvazia, a listinha não fica flutuando sem o badge.
    useEffect(() =>
    {
        if(remoteCount === 0) setPeopleOpen(false);
    }, [ remoteCount ]);

    useEffect(() =>
    {
        if(!peopleOpen) return;

        const onOutside = (event: MouseEvent) =>
        {
            if(peopleRef.current && !peopleRef.current.contains(event.target as Node)) setPeopleOpen(false);
        };

        window.addEventListener('mousedown', onOutside);

        return () => window.removeEventListener('mousedown', onOutside);
    }, [ peopleOpen ]);

    useEffect(() =>
    {
        requestToken();

        return () => disconnect();
    }, [ requestToken, disconnect ]);

    useEffect(() =>
    {
        if(!menuOpen) return;

        refreshDevices();

        const onOutside = (event: MouseEvent) =>
        {
            if(menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
        };

        window.addEventListener('mousedown', onOutside);

        return () => window.removeEventListener('mousedown', onOutside);
    }, [ menuOpen, refreshDevices ]);

    const mics = devices.filter((device) => device.kind === 'audioinput' && device.label);
    const speakers = devices.filter((device) => device.kind === 'audiooutput' && device.label);

    const onVolume = useCallback((event: React.ChangeEvent<HTMLInputElement>) =>
    {
        setVolume(parseFloat(event.target.value));
    }, [ setVolume ]);

    return (
        <div className="octane-voice-widget">
            <div className="octane-voice-widget__buttons">
                <button
                    type="button"
                    className={ classNames('octane-voice-widget__button', (micOn || autoMuted) && 'is-active', error && !micOn && 'is-error') }
                    disabled={ !connected && !connecting }
                    onClick={ toggleMic }
                    onContextMenu={ (event) =>
                        {
                            event.preventDefault();

                            setAutoMuteOnBlur(!autoMuteOnBlur);
                        } }
                    title={ autoMuteOnBlur ? 'Mute automático ao perder foco: LIGADO' : 'Mute automático ao perder foco: DESLIGADO' }>
                    <i className="octane-icon icon-mic" />
                    { autoMuted && <span className="octane-voice-widget__badge">Zz</span> }
                </button>
                <button
                    type="button"
                    className={ classNames('octane-voice-widget__button', camOn && 'is-active', error && !camOn && 'is-error') }
                    disabled={ !connected && !connecting }
                    onClick={ toggleCam }
                    title="Câmera">
                    <i className="octane-icon icon-camera" />
                </button>
                <button
                    type="button"
                    className={ classNames('octane-voice-widget__button', screenOn && 'is-active') }
                    disabled={ !connected && !connecting }
                    onClick={ toggleScreen }
                    title="Compartilhar tela">
                    <i className="octane-icon icon-screenshare" />
                </button>
                <div className="octane-voice-widget__settings" ref={ menuRef }>
                    <button
                        type="button"
                        className={ classNames('octane-voice-widget__button', 'is-settings', menuOpen && 'is-active') }
                        onClick={ () => setMenuOpen(!menuOpen) }
                        title="Configurações de voz">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 4a8.6 8.6 0 0 0-.1-1.28l2.02-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.38.96a8.7 8.7 0 0 0-2.22-1.28L15.5.32A.5.5 0 0 0 15 0H9a.5.5 0 0 0-.5.42l-.36 2.54A8.7 8.7 0 0 0 5.92 4.2l-2.38-.96a.5.5 0 0 0-.6.22L1.02 6.78a.5.5 0 0 0 .12.64l2.02 1.58a8.6 8.6 0 0 0 0 2.56L1.14 13.14a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.38-.96a8.7 8.7 0 0 0 2.22 1.28l.36 2.54a.5.5 0 0 0 .5.42h6a.5.5 0 0 0 .5-.42l.36-2.54a8.7 8.7 0 0 0 2.22-1.28l2.38.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.58c.06-.42.1-.85.1-1.28z" transform="translate(0 2)" />
                        </svg>
                    </button>
                    { menuOpen &&
                        <div className="octane-voice-widget__menu">
                            <div className="octane-voice-widget__menu-status">
                                { connecting && 'Conectando…' }
                                { connected && !error && 'Voz conectada ✓' }
                                { !connected && !connecting && 'Desconectado' }
                            </div>
                            { error &&
                                <div className="octane-voice-widget__menu-error">{ error }</div> }
                            <button
                                type="button"
                                className={ classNames('octane-voice-widget__zones-button', 'octane-voice-widget__eye-button', zoneInfoVisible && 'is-active') }
                                onClick={ () => setZoneInfoVisible(!zoneInfoVisible) }
                                title={ zoneInfoVisible ? 'Ocultar os textos de zona' : 'Mostrar os textos de zona' }>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M12 5c-5 0-9.3 3.1-11 7.4C2.7 16.9 7 20 12 20s9.3-3.1 11-7.6C21.3 8.1 17 5 12 5zm0 12a4.4 4.4 0 1 1 0-8.8 4.4 4.4 0 0 1 0 8.8zm0-7a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z" />
                                    { !zoneInfoVisible &&
                                        <path d="M2.1 3.5 3.5 2.1 21.9 20.5l-1.4 1.4z" /> }
                                </svg>
                                Visualizar zona
                            </button>
                            <label className="octane-voice-widget__menu-label">
                                Microfone
                                <select value={ micDeviceId } onChange={ (event) => setMicDevice(event.target.value) }>
                                    <option value="">Padrão do sistema</option>
                                    { mics.map((device) =>
                                        <option key={ device.deviceId } value={ device.deviceId }>{ device.label }</option>) }
                                </select>
                            </label>
                            <label className="octane-voice-widget__menu-label">
                                Alto-falante
                                <select value={ speakerDeviceId } onChange={ (event) => setSpeakerDevice(event.target.value) }>
                                    <option value="">Padrão do sistema</option>
                                    { speakers.map((device) =>
                                        <option key={ device.deviceId } value={ device.deviceId }>{ device.label }</option>) }
                                </select>
                            </label>
                            <label className="octane-voice-widget__menu-label">
                                Volume dos outros: { Math.round(volume * 100) }%
                                <input type="range" min="0" max="1" step="0.05" value={ volume } onChange={ onVolume } />
                            </label>
                            <div className="octane-voice-widget__menu-check">
                                <input
                                    id="octane-voice-automute"
                                    type="checkbox"
                                    checked={ autoMuteOnBlur }
                                    onChange={ () => setAutoMuteOnBlur(!autoMuteOnBlur) } />
                                <label htmlFor="octane-voice-automute">Mute automático ao perder o foco</label>
                            </div>
                            { canEditZones &&
                                <button
                                    type="button"
                                    className="octane-voice-widget__zones-button"
                                    onClick={ () => setZoneEditorOpen(true) }>
                                    Zonas de áudio…
                                </button> }
                        </div> }
                </div>
            </div>
            { showZoneInfo &&
                <button
                    type="button"
                    className="octane-voice-widget__zoneinfo"
                    onClick={ () => setPeopleOpen(!peopleOpen) }
                    title="Pessoas por zona">
                    <span className="octane-voice-widget__zoneinfo-room">{ roomName || 'Sala' } · { roomCount }</span>
                    <span className="octane-voice-widget__zoneinfo-zone">{ zoneTitle } · { zoneCount }</span>
                </button> }
            { assembly &&
                <div className="octane-voice-widget__assembly">
                    Modo assembleia
                </div> }
            <div className="octane-voice-widget__people" ref={ peopleRef }>
                { peopleOpen &&
                    <div className="octane-voice-widget__menu octane-voice-widget__people-list">
                        <div className="octane-voice-widget__menu-status">Pessoas por zona</div>
                        { groups.length > 0
                            ? groups.map((group) =>
                                <div key={ group.title } className="octane-voice-widget__zone-group">
                                    <div className="octane-voice-widget__zone-group-title">{ group.title } · { group.names.length }</div>
                                    { group.names.map((name, index) =>
                                        <div key={ `${ name }-${ index }` } className="octane-voice-widget__person">{ name }</div>) }
                                </div>)
                            : <div className="octane-voice-widget__menu-error">Ninguém além de você</div> }
                    </div> }
            </div>
        </div>
    );
};
