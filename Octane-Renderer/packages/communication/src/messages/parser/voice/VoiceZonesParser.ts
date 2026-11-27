import { IMessageDataWrapper, IMessageParser } from '@octane/api';

/** Fatores de volume de uma zona (percentuais). */
export interface VoiceZoneFactorValues
{
    same: number;
    other: number;
    outside: number;
}

export interface IZone
{
    id: number;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 0 = herda os fatores globais da sala; 1 = fatores próprios desta zona. */
    factorMode: number;
    /** Preenchido somente quando factorMode === 1; null = usar os padrões. */
    factors: VoiceZoneFactorValues | null;
}

/** Incoming 6106 — VoiceZonesComposer (admin) or room state.
 *
 *  roomId, canEdit, same, other, outside, videoGlobal, count,
 *  por zona: id, name, x, y, w, h, mode, [same, other, outside se mode === 1].
 */
export class VoiceZonesParser implements IMessageParser
{
    private _roomId: number = 0;
    private _canEdit: boolean = false;
    private _factors: VoiceZoneFactorValues = { same: 100, other: 10, outside: 35 };
    private _videoGlobal: boolean = false;
    private _zones: IZone[] = [];

    public get roomId(): number { return this._roomId; }
    public get canEdit(): boolean { return this._canEdit; }
    public get factors(): VoiceZoneFactorValues { return this._factors; }

    /** Compat: getters individuais usados por useVoice.ts. */
    public get sameFactor(): number { return this._factors.same; }
    public get otherFactor(): number { return this._factors.other; }
    public get outsideFactor(): number { return this._factors.outside; }

    public get videoGlobal(): boolean { return this._videoGlobal; }
    public get zones(): IZone[] { return this._zones; }

    public flush(): boolean
    {
        this._roomId = 0;
        this._canEdit = false;
        this._factors = { same: 100, other: 10, outside: 35 };
        this._videoGlobal = false;
        this._zones = [];

        return true;
    }

    public parse(wrapper: IMessageDataWrapper): boolean
    {
        if(!wrapper) return false;

        this.flush();

        this._roomId = wrapper.readInt();
        this._canEdit = wrapper.readBoolean();

        this._factors = {
            same: wrapper.readInt(),
            other: wrapper.readInt(),
            outside: wrapper.readInt()
        };

        this._videoGlobal = wrapper.readBoolean();

        const count = wrapper.readInt();

        for(let i = 0; i < count; i++)
        {
            const id = wrapper.readInt();
            const name = wrapper.readString();
            const x = wrapper.readInt();
            const y = wrapper.readInt();
            const width = wrapper.readInt();
            const height = wrapper.readInt();
            const factorMode = wrapper.readInt();

            let factors: VoiceZoneFactorValues | null = null;

            if(factorMode === 1)
            {
                factors = {
                    same: wrapper.readInt(),
                    other: wrapper.readInt(),
                    outside: wrapper.readInt()
                };
            }

            this._zones.push({ id, name, x, y, width, height, factorMode, factors });
        }

        return true;
    }
}
