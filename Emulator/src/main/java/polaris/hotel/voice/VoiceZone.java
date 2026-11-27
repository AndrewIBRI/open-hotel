package polaris.hotel.voice;

/**
 * A rectangular audio zone on the room floor (tile coordinates).
 * Zones are edited in-game by admins (editor styled after the floor plan
 * editor) and drive the client-side spatial audio: players in the same
 * zone hear each other, other zones bleed, outside tiles are muffled.
 *
 * Cada zona pode usar os fatores globais da sala (MODE_GLOBAL) ou os seus
 * próprios (MODE_CUSTOM). Os fatores próprios são persistidos junto da zona.
 */
public record VoiceZone(int id, String name, int x, int y, int width, int height,
                        int factorMode, Integer sameFactor, Integer otherFactor, Integer outsideFactor) {

    public static final int MODE_GLOBAL = 0;
    public static final int MODE_CUSTOM = 1;

    /** Garante que "custom" sem os três fatores volta a herdar do padrão. */
    public VoiceZone {
        if (factorMode != MODE_CUSTOM || sameFactor == null || otherFactor == null || outsideFactor == null) {
            factorMode = MODE_GLOBAL;
            sameFactor = null;
            otherFactor = null;
            outsideFactor = null;
        } else {
            sameFactor = clampPercent(sameFactor);
            otherFactor = clampPercent(otherFactor);
            outsideFactor = clampPercent(outsideFactor);
        }
    }

    public boolean isCustom() {
        return factorMode == MODE_CUSTOM;
    }

    private static int clampPercent(int value) {
        if (value < 0) return 0;
        if (value > 100) return 100;

        return value;
    }
}
