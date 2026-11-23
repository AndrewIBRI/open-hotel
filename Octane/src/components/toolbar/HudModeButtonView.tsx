import { FC, useEffect, useState } from 'react';

export type HudMode = 'full' | 'simple' | 'clean';

const STORAGE_KEY = 'hud.mode';

export const readHudMode = (): HudMode =>
{
    const value = localStorage.getItem(STORAGE_KEY);

    return value === 'simple' || value === 'clean' ? value : 'full';
};

export const writeHudMode = (mode: HudMode) =>
{
    localStorage.setItem(STORAGE_KEY, mode);
    document.body.dataset.hudMode = mode;
};

const NEXT_MODE: Record<HudMode, HudMode> = { full: 'simple', simple: 'clean', clean: 'full' };

const LABELS: Record<HudMode, string> = { full: 'HUD completo', simple: 'HUD simples', clean: 'HUD limpo' };

/** Botão no canto superior direito: alterna os 3 modos de HUD (completo / simples / limpo). */
export const HudModeButtonView: FC<{}> = () =>
{
    const [ mode, setMode ] = useState<HudMode>(readHudMode);

    useEffect(() =>
    {
        document.body.dataset.hudMode = mode;
    }, [ mode ]);

    return (
        <button
            type="button"
            className="hud-mode-button"
            data-mode={ mode }
            title="Alternar modo do HUD"
            onClick={ () =>
            {
                const next = NEXT_MODE[mode];

                setMode(next);
                writeHudMode(next);
            } }>
            { LABELS[mode] }
        </button>
    );
};
