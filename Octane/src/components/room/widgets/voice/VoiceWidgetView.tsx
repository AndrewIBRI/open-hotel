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
 * Clique com o botão direito no microfone alterna o mute automático
 * ao perder o foco (só quando ninguém está ouvindo).
 */
export const VoiceWidgetView: FC<{}> = (props) =>
{
    const { requestToken, disconnect, toggleMic, toggleCam, toggleScreen, refreshDevices, setMicDevice, setSpeakerDevice, setVolume } = useVoice();
    useVoiceZonesSpatial();

    const { connected, connecting, micOn, camOn, screenOn, assembly, remoteCount, autoMuteOnBlur, autoMuted, error, devices, micDeviceId, speakerDeviceId, volume, setAutoMuteOnBlur, canEditZones, setZoneEditorOpen, setRoomName, zones, currentZone, roomName } = useVoiceStore();

    // Nome da sala atual (badge de localização do HUD).
    useMessageEvent<GetGuestRoomResultEvent>(GetGuestRoomResultEvent, (event) =>
    {
        const parser = event.getParser();

        if(!parser.roomEnter) return;

        const session = GetRoomSession();

        if(!session || parser.data.roomId !== session.roomId) return;

        setRoomName(parser.data.roomName || '');
    });

    const locationLabel = roomName
        ? (currentZone >= 0 && zones[currentZone] ? `${ roomName } (${ zones[currentZone].name })` : roomName)
        : null;

    const [ menuOpen, setMenuOpen ] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const [ peopleOpen, setPeopleOpen ] = useState(false);
    const peopleRef = useRef<HTMLDivElement>(null);
    const people = peopleOpen ? getPeople() : [];

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
            { locationLabel &&
                <div className="octane-voice-widget__assembly octane-voice-widget__location">
                    { locationLabel }
                </div> }
            { assembly &&
                <div className="octane-voice-widget__assembly">
                    Modo assembleia
                </div> }
            <div className="octane-voice-widget__people" ref={ peopleRef }>
                { (remoteCount > 0) &&
                    <button
                        type="button"
                        className={ classNames('octane-voice-widget__count', peopleOpen && 'is-active') }
                        onClick={ () => setPeopleOpen(!peopleOpen) }
                        title="Pessoas na sala">
                        { remoteCount }
                    </button> }
                { peopleOpen &&
                    <div className="octane-voice-widget__menu octane-voice-widget__people-list">
                        <div className="octane-voice-widget__menu-status">Pessoas na sala</div>
                        { people.length > 0
                            ? people.map((person) =>
                                <div key={ person.identity } className="octane-voice-widget__person">{ person.name }</div>)
                            : <div className="octane-voice-widget__menu-error">Ninguém além de você</div> }
                    </div> }
            </div>
        </div>
    );
};
