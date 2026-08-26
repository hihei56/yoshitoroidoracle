import { findByStoreName } from "@vendetta/metro";
import { ReactNative as RN } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { showConfirmationAlert, showInputAlert } from "@vendetta/ui/alerts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";

import { vstorage } from "./patcher";

const { FormRow, FormSection, FormText } = Forms;

const UserStore = findByStoreName("UserStore");

const setOverride = (userId: string, url: string) => {
    vstorage.overrides = { ...vstorage.overrides, [userId]: url.trim() };
};

const removeOverride = (userId: string) => {
    const next = { ...vstorage.overrides };
    delete next[userId];
    vstorage.overrides = next;
};

const promptForUrl = (userId: string, current?: string) => {
    showInputAlert({
        title: current ? "画像URLを編集" : "画像URLを入力",
        placeholder: "https://example.com/avatar.png",
        initialValue: current,
        confirmText: current ? "更新" : "追加",
        confirmColor: "brand" as ButtonColors,
        onConfirm: (url: string) => {
            if (!url?.trim()) return;
            setOverride(userId, url);
        },
        cancelText: "キャンセル",
    });
};

const promptForUser = () => {
    showInputAlert({
        title: "ユーザーIDを入力",
        placeholder: "例: 123456789012345678",
        confirmText: "次へ",
        confirmColor: "brand" as ButtonColors,
        onConfirm: (id: string) => {
            const userId = id?.trim();
            if (!userId || !/^\d{15,25}$/.test(userId)) return;
            promptForUrl(userId);
        },
        cancelText: "キャンセル",
    });
};

const confirmRemove = (userId: string, label: string) => {
    showConfirmationAlert({
        title: "削除の確認",
        content: `${label} のアバターオーバーライドを削除しますか?`,
        confirmText: "削除",
        confirmColor: "red" as ButtonColors,
        onConfirm: () => removeOverride(userId),
        cancelText: "キャンセル",
    });
};

export default function Settings() {
    useProxy(vstorage);

    const entries = Object.entries(vstorage.overrides ?? {});

    return (
        <RN.ScrollView style={{ flex: 1 }}>
            <FormSection title="使い方">
                <FormText style={{ padding: 16 }}>
                    ユーザーIDと画像URLを登録すると、そのユーザーのアバターがあなたの端末上でのみ指定した画像に置き換わります。相手や他のユーザーには一切送信・共有されません。
                </FormText>
            </FormSection>

            <FormSection title="登録">
                <FormRow
                    label="ユーザーを追加"
                    subLabel="ユーザーIDと画像URLを指定します"
                    leading={<FormRow.Icon source={getAssetIDByName("PlusLargeIcon")} />}
                    onPress={promptForUser}
                />
            </FormSection>

            <FormSection title={`登録済み (${entries.length})`}>
                {entries.length === 0 && (
                    <FormText style={{ padding: 16, color: semanticColors.TEXT_MUTED }}>
                        まだ何も登録されていません
                    </FormText>
                )}
                {entries.map(([userId, url]) => {
                    const user = UserStore?.getUser?.(userId);
                    const label = user?.username ?? userId;

                    return (
                        <FormRow
                            key={userId}
                            label={label}
                            subLabel={user?.username ? userId : "タップして編集・長押しで削除"}
                            leading={
                                <RN.Image
                                    source={{ uri: url }}
                                    style={{ width: 32, height: 32, borderRadius: 16 }}
                                />
                            }
                            trailing={<FormRow.Arrow />}
                            onPress={() => promptForUrl(userId, url)}
                            onLongPress={() => confirmRemove(userId, label)}
                        />
                    );
                })}
            </FormSection>
        </RN.ScrollView>
    );
}
