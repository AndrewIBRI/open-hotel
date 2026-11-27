package polaris.messages.outgoing.voice;

import polaris.hotel.voice.VoiceZone;
import polaris.messages.ServerMessage;
import polaris.messages.outgoing.MessageComposer;
import polaris.messages.outgoing.Outgoing;

import java.util.List;

/**
 * The room's audio zones + whether the receiving user may edit them.
 * Structure: roomId, canEdit, sameFactor, otherFactor, outsideFactor (percent),
 * videoGlobal, count, then per zone: id, name, x, y, width, height, mode,
 * followed by sameFactor, otherFactor, outsideFactor only when mode == 1.
 */
public class VoiceZonesComposer extends MessageComposer {
    private final int roomId;
    private final boolean canEdit;
    private final int sameFactor;
    private final int otherFactor;
    private final int outsideFactor;
    private final boolean videoGlobal;
    private final List<VoiceZone> zones;

    public VoiceZonesComposer(int roomId, boolean canEdit, int sameFactor, int otherFactor, int outsideFactor, boolean videoGlobal, List<VoiceZone> zones) {
        this.roomId = roomId;
        this.canEdit = canEdit;
        this.sameFactor = sameFactor;
        this.otherFactor = otherFactor;
        this.outsideFactor = outsideFactor;
        this.videoGlobal = videoGlobal;
        this.zones = zones == null ? List.of() : zones;
    }

    @Override
    protected ServerMessage composeInternal() {
        this.response.init(Outgoing.VoiceZonesComposer);
        this.response.appendInt(this.roomId);
        this.response.appendBoolean(this.canEdit);
        this.response.appendInt(this.sameFactor);
        this.response.appendInt(this.otherFactor);
        this.response.appendInt(this.outsideFactor);
        this.response.appendBoolean(this.videoGlobal);
        this.response.appendInt(this.zones.size());

        for (VoiceZone zone : this.zones) {
            this.response.appendInt(zone.id());
            this.response.appendString(zone.name());
            this.response.appendInt(zone.x());
            this.response.appendInt(zone.y());
            this.response.appendInt(zone.width());
            this.response.appendInt(zone.height());
            this.response.appendInt(zone.factorMode());

            if (zone.isCustom()) {
                this.response.appendInt(zone.sameFactor());
                this.response.appendInt(zone.otherFactor());
                this.response.appendInt(zone.outsideFactor());
            }
        }

        return this.response;
    }
}
