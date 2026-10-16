export function normalizeTikTokChatMessage(data) {
  const user = data.user ?? {};
  const username = String(user.displayId ?? user.uniqueId ?? "desconhecido");

  return {
    username,
    nickname: String(user.nickname ?? user.uniqueId ?? username),
    comment: String(data.content ?? data.comment ?? ""),
    userId: String(user.id ?? user.userId ?? user.uniqueId ?? ""),
  };
}
