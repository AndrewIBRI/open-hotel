package polaris.messages.incoming.voice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import polaris.hotel.rooms.Room;
import polaris.hotel.voice.VoiceZone;
import polaris.messages.ClientMessage;
import polaris.messages.incoming.MessageHandler;

import java.util.ArrayList;
import java.util.List;

/**
 * Admin saves the room's audio zones (full replacement). Validates rank,
 * clamps values, persists and broadcasts the new set to the whole room so
 * every client updates its spatial audio.
 */
public class SaveVoiceZonesEvent extends MessageHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(SaveVoiceZonesEvent.class);

    private static final int MAX_ZONES = 32;

    @Override
    public void handle() throws Exception {
        final Room room = this.currentRoom();
        if (room == null) return;

        if (!room.canEditVoiceZones(this.client.getUser())) return;

        // Spatial volume factors (percent), then the zones themselves.
        final Integer sameFactor = this.packet.readInt();
        final Integer otherFactor = this.packet.readInt();
        final Integer outsideFactor = this.packet.readInt();

        if (sameFactor == null || otherFactor == null || outsideFactor == null) return;

        // Vídeo global: transmissões (câmera/tela) visíveis na sala toda, fora das zonas.
        final Boolean videoGlobal = this.packet.readBoolean();

        room.setVoiceFactors(sameFactor, otherFactor, outsideFactor);

        if (videoGlobal != null) room.setVoiceVideoGlobal(videoGlobal);

        final Integer count = this.packet.readInt();

        if (count == null || count < 0 || count > MAX_ZONES) return;

        final List<VoiceZone> zones = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            final String name = this.packet.readString();
            final int x = this.packet.readInt();
            final int y = this.packet.readInt();
            final int width = this.packet.readInt();
            final int height = this.packet.readInt();

            // Por zona: modo (0=herda, 1=custom) e, se custom, os 3 fatores.
            final Integer modeValue = this.packet.readInt();
            final boolean customRequested = modeValue != null && modeValue == VoiceZone.MODE_CUSTOM;

            Integer customSame = null;
            Integer customOther = null;
            Integer customOutside = null;

            if (customRequested) {
                customSame = this.packet.readInt();
                customOther = this.packet.readInt();
                customOutside = this.packet.readInt();
            }

            // Um pacote mal formado (modo custom sem fatores) cai para o padrão,
            // mantendo a leitura dos 3 ints -> o restante do pacote não desalinha.
            final int mode = customRequested && customSame != null && customOther != null && customOutside != null
                    ? VoiceZone.MODE_CUSTOM
                    : VoiceZone.MODE_GLOBAL;

            if (name == null || name.isBlank()) continue;

            zones.add(new VoiceZone(
                    zones.size() + 1,
                    name.substring(0, Math.min(64, name.length())),
                    clamp(x), clamp(y), clamp(width), clamp(height),
                    mode, customSame, customOther, customOutside));
        }

        room.setVoiceZones(zones);
        LOGGER.info("User `{}` saved {} audio zone(s) in room {}", this.client.getUser().getUserInfo().getUsername(), zones.size(), room.getId());
    }

    private static int clamp(int value) {
        if (value < 0) return 0;
        if (value > 500) return 500;

        return value;
    }
}
