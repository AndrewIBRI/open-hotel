import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { VideoQuality } from 'livekit-client';
import { DraggableWindowPosition, OctaneCardContentView, OctaneCardHeaderView, OctaneCardView } from '../../../../common';
import { useVoiceStore, VoiceVideo } from '../../../../state/voiceStore';
import { GetRoomSession } from '../../../../api';
import { voiceConnection } from '../../../../api/voice/VoiceConnection';
import '../../../../css/room/VoiceWidget.css';

type QualityChoice = 'auto' | 'low' | 'medium' | 'high';

const QUALITY_VALUES: Record<QualityChoice, VideoQuality> = {
    auto: VideoQuality.HIGH, // auto = teto HIGH, adaptiveStream ajusta ao tamanho da janela
    low: VideoQuality.LOW,
    medium: VideoQuality.MEDIUM,
    high: VideoQuality.HIGH,
};

/** Seletor de qualidade (estilo YouTube) para o stream remoto. Em tela cheia força a máxima. */
const QualityControl: FC<{ video: VoiceVideo; getStageEl: () => HTMLDivElement | null }> = ({ video, getStageEl }) =>
{
    const [ choice, setChoice ] = useState<QualityChoice>('auto');
    const choiceRef = useRef<QualityChoice>('auto');

    const apply = useCallback((next: QualityChoice) =>
    {
        video.publication?.setVideoQuality?.(QUALITY_VALUES[next]);
    }, [ video ]);

    const onChoice = useCallback((event: React.ChangeEvent<HTMLSelectElement>) =>
    {
        const next = event.target.value as QualityChoice;

        choiceRef.current = next;
        setChoice(next);
        apply(next);
    }, [ apply ]);

    // Em tela cheia o stream vai na melhor camada possível; ao sair, volta ao escolhido.
    useEffect(() =>
    {
        const onFullscreenChange = () =>
        {
            if(document.fullscreenElement && document.fullscreenElement === getStageEl()) apply('high');
            else if(!document.fullscreenElement) apply(choiceRef.current);
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);

        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, [ apply, getStageEl ]);

    return (
        <label className="octane-video-window__quality" title="Qualidade do stream (Auto segue o tamanho da janela e a rede)">
            Qualidade
            <select value={ choice } onChange={ onChoice } disabled={ !video.publication?.setVideoQuality }>
                <option value="auto">Auto</option>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta (máxima)</option>
            </select>
        </label>
    );
};

/** Nome de exibição do participante ("Você" para o próprio). */
const displayName = (video: VoiceVideo): string =>
{
    if(video.local) return 'Você';

    const webID = parseInt(video.identity.replace(/^user-/, ''), 10);

    if(!Number.isFinite(webID) || webID <= 0) return video.identity;

    return GetRoomSession()?.userDataManager.getUserData(webID)?.name || video.identity;
};

/** Vídeo espacial: só aparece na janela quem está na MESMA zona que eu
 *  (área aberta comum conta como "mesma zona"). Local sempre aparece.
 *  videoVisible === null significa "todos" (sem zonas, assembleia ou modo global). */
const isVideoVisible = (video: VoiceVideo, videoVisible: Set<string> | null): boolean =>
{
    if(video.local) return true;

    if(!videoVisible) return true;

    return videoVisible.has(video.identity);
};

/** Renders one video MediaStreamTrack in a <video> element. */
const VideoTile: FC<{ video: VoiceVideo; className?: string; showLabel?: boolean; onMetadata?: (element: HTMLVideoElement) => void; autoAspect?: boolean }> = ({ video, className, showLabel = true, onMetadata, autoAspect }) =>
{
    const videoRef = useRef<HTMLVideoElement>(null);
    const metadataRef = useRef(onMetadata);
    const [ aspect, setAspect ] = useState<number>(0);

    metadataRef.current = onMetadata;

    useEffect(() =>
    {
        const element = videoRef.current;

        if(!element) return;

        element.srcObject = new MediaStream([ video.track ]);
        element.play().catch(() =>
        {
            // autoplay pode falhar sem gesto; o próximo play (interação) recupera
        });

        return () =>
        {
            element.srcObject = null;
        };
    }, [ video.track ]);

    return (
        <div
            className={ 'octane-video-window__tile' + (className ? ' ' + className : '') }
            style={ autoAspect && aspect > 0 ? { aspectRatio: String(aspect) } : undefined }>
            <video
                ref={ videoRef }
                className="octane-video-window__video"
                autoPlay
                muted={ video.local }
                playsInline
                onLoadedMetadata={ () =>
                {
                    const element = videoRef.current as HTMLVideoElement;

                    if(element.videoWidth > 0 && element.videoHeight > 0) setAspect(element.videoWidth / element.videoHeight);
                    metadataRef.current?.(element);
                } } />
            { showLabel &&
                <span className="octane-video-window__label">
                    { displayName(video) } · { video.source === 'camera' ? 'Câmera' : 'Tela' }
                </span> }
        </div>
    );
};

const VolumeControl: FC<{}> = () =>
{
    const { volume, setVolume } = useVoiceStore();

    const onVolume = useCallback((event: React.ChangeEvent<HTMLInputElement>) =>
    {
        const parsed = parseFloat(event.target.value);

        setVolume(parsed);
        voiceConnection.setVolume(parsed);
    }, []);

    return (
        <label className="octane-video-window__volume">
            🔊 { Math.round(volume * 100) }%
            <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ volume }
                onChange={ onVolume } />
        </label>
    );
};

/**
 * Janela pop-up da CÂMERA. Só existe quando NÃO há transmissão de tela:
 * com tela compartilhada a câmera vira picture-in-picture dentro da janela
 * de transmissão (a câmera não abre janela separada — evita duplicação).
 */
export const CameraWindowView: FC<{}> = () =>
{
    const gridRef = useRef<HTMLDivElement>(null);
    // Proporção real do stream (0 até o vídeo informar); a janela se ajusta a ela.
    const [ aspect, setAspect ] = useState(0);

    const { videos, hiddenWindows, videoVisible, setWindowHidden } = useVoiceStore();

    const screens = videos.filter((video) => (video.source === 'screen') && isVideoVisible(video, videoVisible));
    const cameras = videos.filter((video) => (video.source === 'camera') && isVideoVisible(video, videoVisible));

    // A janela acompanha a proporção REAL do vídeo: altura = largura / aspecto,
    // então o vídeo encosta em TODAS as bordas (sem barras pretas). Se o
    // usuário mudar a largura, o ResizeObserver reajusta a altura.
    useEffect(() =>
    {
        const grid = gridRef.current;

        if(!grid || !aspect) return;

        const windowEl = grid.closest('.octane-video-window--camera') as HTMLElement | null;

        if(!windowEl) return;

        const fit = () =>
        {
            const width = grid.clientWidth;

            if(!width) return;

            const extra = windowEl.offsetHeight - grid.clientHeight; // header + paddings + controles

            windowEl.style.height = Math.round(width / aspect + Math.max(extra, 0)) + 'px';
        };

        const observer = new ResizeObserver(fit);

        observer.observe(grid);

        return () => observer.disconnect();
    }, [ aspect ]);

    const onCameraMetadata = useCallback((element: HTMLVideoElement) =>
    {
        if(element.videoWidth > 0 && element.videoHeight > 0) setAspect(element.videoWidth / element.videoHeight);
    }, []);

    if(!cameras.length || screens.length || hiddenWindows.has('camera')) return null;

    return (
        <OctaneCardView
            className="octane-video-window octane-video-window--camera"
            disableDrag={ false }
            style={ { pointerEvents: 'auto' } }
            theme="primary-slim"
            uniqueKey="voice-camera-window"
            windowPosition={ DraggableWindowPosition.CENTER }>
            <OctaneCardHeaderView
                headerText="Câmera"
                onCloseClick={ () => setWindowHidden('camera', true) } />
            <OctaneCardContentView className="bg-[#1b1b1f] relative" overflow="auto">
                <div ref={ gridRef } className="octane-video-window__grid">
                    { cameras.map((video, index) =>
                        <VideoTile key={ video.id } video={ video } onMetadata={ index === 0 ? onCameraMetadata : undefined } />) }
                </div>
            </OctaneCardContentView>
        </OctaneCardView>
    );
};

/**
 * UMA janela por transmissão de tela ("Transmissão – Nome"), cada uma
 * independente e controlável. Câmeras aparecem como picture-in-picture.
 */
export const ScreenWindowView: FC<{}> = () =>
{
    // Refs (sem setState — um setState em callback de ref causa loop infinito / React #185)
    const stageRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const { videos, hiddenWindows, videoVisible, setWindowHidden } = useVoiceStore();

    const screens = videos.filter((video) => (video.source === 'screen') && isVideoVisible(video, videoVisible));
    const cameras = videos.filter((video) => (video.source === 'camera') && isVideoVisible(video, videoVisible));

    const toggleFullscreen = useCallback((element: HTMLElement | null | undefined) =>
    {
        if(!element) return;

        if(document.fullscreenElement)
        {
            document.exitFullscreen().catch(() => {});
        }
        else
        {
            element.requestFullscreen().catch(() => {});
        }
    }, []);

    if(!screens.length) return null;

    return (
        <>
            { screens.map((video) =>
            {
                if(hiddenWindows.has(video.id)) return null;

                const windowKey = 'voice-screen-window-' + video.identity;

                return (
                    <OctaneCardView
                        key={ video.id }
                        className="octane-video-window octane-video-window--screen"
                        disableDrag={ false }
                        style={ { pointerEvents: 'auto' } }
                        theme="primary-slim"
                        uniqueKey={ windowKey }
                        windowPosition={ DraggableWindowPosition.CENTER }>
                        <OctaneCardHeaderView
                            headerText={ 'Transmissão – ' + displayName(video) }
                            onCloseClick={ () => setWindowHidden(video.id, true) } />
                        <OctaneCardContentView className="bg-[#1b1b1f] relative" overflow="auto">
                            <div
                                ref={ (element) => { stageRefs.current[ video.id ] = element; } }
                                className="octane-video-window__stage">
                                <div className="octane-video-window__grid octane-video-window__grid--single">
                                    <VideoTile video={ video } />
                                </div>

                                { cameras.length > 0 &&
                                    <div className="octane-video-window__pip">
                                        { cameras.map((camera) =>
                                            <VideoTile key={ 'pip-' + camera.id } video={ camera } className="octane-video-window__tile--pip" showLabel={ false } autoAspect />) }
                                    </div> }

                                <div className="octane-video-window__controls">
                                    <button
                                        className="octane-video-window__btn"
                                        type="button"
                                        onClick={ () => toggleFullscreen(stageRefs.current[ video.id ]) }
                                        title="Tela cheia">
                                        ⛶ Tela cheia
                                    </button>
                                    <QualityControl video={ video } getStageEl={ () => stageRefs.current[ video.id ] ?? null } />
                                    <VolumeControl />
                                </div>
                            </div>
                        </OctaneCardContentView>
                    </OctaneCardView>
                );
            }) }
        </>
    );
};
