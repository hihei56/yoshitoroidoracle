import { findByProps, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";

// userId -> override image URL
export const vstorage = storage as {
    overrides: Record<string, string>;
};

const avatarUtils = findByProps("getUserAvatarURL", "getUserAvatarSource");
const UserStore = findByStoreName("UserStore");

const urlExt = (url: string) => {
    try {
        return new URL(url).pathname.split(".").pop()?.toLowerCase();
    } catch {
        return undefined;
    }
};

export default function patchAvatars() {
    vstorage.overrides ??= {};

    const unpatches = [
        // Makes Discord treat the user as having an animated avatar hash,
        // so avatar-decoration/animation code paths don't immediately bail out.
        after("getUser", UserStore, ([id], user) => {
            if (!user || !vstorage.overrides[id]) return;
            if (urlExt(vstorage.overrides[id]) !== "gif") return;

            const avatar = user.avatar ?? "0";
            if (!avatar.startsWith("a_")) user.avatar = `a_${avatar}`;
        }),

        after("getUserAvatarURL", avatarUtils, ([user, animate]) => {
            const override = user?.id && vstorage.overrides[user.id];
            if (!override) return;

            if (!animate && urlExt(override) === "gif") {
                return override.replace(/\.gif($|\?)/, ".png$1");
            }
            return override;
        }),

        after("getUserAvatarSource", avatarUtils, ([user, animate]) => {
            const override = user?.id && vstorage.overrides[user.id];
            if (!override) return;

            const uri = !animate && urlExt(override) === "gif"
                ? override.replace(/\.gif($|\?)/, ".png$1")
                : override;
            return { uri };
        }),
    ];

    return () => unpatches.forEach(unpatch => unpatch());
}
