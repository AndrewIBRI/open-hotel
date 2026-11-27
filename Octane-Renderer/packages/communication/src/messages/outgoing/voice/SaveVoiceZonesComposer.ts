import { IMessageComposer } from '@octane/api';

/** Custom voice composer (6107): saves the room's audio zones (admin only).
 *
 *  Formato: same, other, outside, videoGlobal, count;
 *  por zona: name, x, y, width, height, mode, [same, other, outside se mode === 1].
 *  mode 0 = herda os fatores globais da sala; mode 1 = fatores próprios da zona.
 */
export class SaveVoiceZonesComposer implements IMessageComposer<(string | number | boolean)[]>
{
    private _data: (string | number | boolean)[];

    constructor(factors: { same: number; other: number; outside: number }, videoGlobal: boolean, zones: {
        name: string; x: number; y: number; width: number; height: number;
        factorMode?: number;
        factors?: { same: number; other: number; outside: number } | null;
    }[])
    {
        this._data = [ factors.same, factors.other, factors.outside, videoGlobal, zones.length ];

        for(const zone of zones)
        {
            this._data.push(zone.name, zone.x, zone.y, zone.width, zone.height);

            // Só envia os 3 ints extras quando a zona realmente é custom — o servidor
            // lê condicionalmente com base no modo.
            const custom = zone.factorMode === 1 ? (zone.factors ?? null) : null;

            this._data.push(custom ? 1 : 0);

            if(custom) this._data.push(custom.same, custom.other, custom.outside);
        }
    }

    public getMessageArray(): (string | number | boolean)[]
    {
        return this._data;
    }

    public dispose(): void
    {
        this._data = null;
    }
}
