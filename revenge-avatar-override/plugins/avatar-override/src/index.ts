import { logger } from "@vendetta";

import patchAvatars from "./patcher";
import Settings from "./Settings";

let unpatch: () => void;

export default {
    onLoad: () => {
        unpatch = patchAvatars();
        logger.log("[AvatarOverride] loaded");
    },
    onUnload: () => {
        unpatch?.();
        logger.log("[AvatarOverride] unloaded");
    },
    settings: Settings,
};
