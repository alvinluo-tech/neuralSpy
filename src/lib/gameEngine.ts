export enum PlayerRole {
  CIVILIAN = "civilian",
  SPY = "spy",
  WHITEBOARD = "whiteboard",
}

export const WHITEBOARD_GUESS_PENDING_MARKER = "[WHITEBOARD_GUESS_PENDING]";

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const secureRandomInt = (maxExclusive: number) => {
  if (maxExclusive <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 4294967296;
  const threshold = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    cryptoApi.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= threshold);

  return value % maxExclusive;
};

const shuffle = <T,>(source: T[]) => {
  const list = [...source];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

export type RoleAssignablePlayer = {
  id: string;
};

export const isWhiteboardRole = (player: {
  is_undercover: boolean;
  current_word: string | null;
}) => {
  return !player.is_undercover && player.current_word === null;
};

export const sanitizeRoomSummary = (summary: string | null | undefined) => {
  return (summary ?? "").replace(WHITEBOARD_GUESS_PENDING_MARKER, "").trim();
};

export const detectWinnerByRole = (
  players: Array<{
    is_alive: boolean;
    is_undercover: boolean;
    current_word: string | null;
  }>,
) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveWhiteboard = players.filter((player) => player.is_alive && isWhiteboardRole(player)).length;
  const aliveCivilian = players.filter(
    (player) => player.is_alive && !player.is_undercover && player.current_word !== null,
  ).length;

  if (aliveUndercover + aliveWhiteboard === 0) return "平民" as const;
  if (aliveUndercover + aliveWhiteboard >= aliveCivilian) return "卧底" as const;
  return null;
};

export const validateAndAssignRoles = (
  playerIds: string[],
  spyCount: number,
  whiteCount: number,
  options?: {
    firstSpeakerPlayerId?: string;
  },
) => {
  const totalPlayers = playerIds.length;
  if (totalPlayers < 3) {
    throw new Error("至少 3 人才能开局。");
  }

  const normalizedSpyCount = clamp(Math.trunc(spyCount), 1, Math.max(totalPlayers - 1, 1));
  const whiteboardByMode = totalPlayers === 3 ? 0 : Math.max(0, Math.trunc(whiteCount));
  const maxWhiteboardBySeats = Math.max(totalPlayers - normalizedSpyCount - 1, 0);
  const finalWhiteCount = clamp(whiteboardByMode, 0, Math.min(2, maxWhiteboardBySeats));
  const civilianCount = totalPlayers - normalizedSpyCount - finalWhiteCount;

  if (civilianCount <= normalizedSpyCount + finalWhiteCount) {
    throw new Error("坏人太多啦，平民会没命的！");
  }

  const rolePool: PlayerRole[] = [
    ...Array(normalizedSpyCount).fill(PlayerRole.SPY),
    ...Array(finalWhiteCount).fill(PlayerRole.WHITEBOARD),
    ...Array(civilianCount).fill(PlayerRole.CIVILIAN),
  ];

  const protectedIndex = options?.firstSpeakerPlayerId
    ? playerIds.findIndex((id) => id === options.firstSpeakerPlayerId)
    : -1;

  let assignedRoles = shuffle(rolePool);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (protectedIndex < 0 || assignedRoles[protectedIndex] !== PlayerRole.WHITEBOARD) {
      break;
    }
    assignedRoles = shuffle(rolePool);
  }

  if (protectedIndex >= 0 && assignedRoles[protectedIndex] === PlayerRole.WHITEBOARD) {
    const nextCivilianIndex = assignedRoles.findIndex((role) => role === PlayerRole.CIVILIAN);
    if (nextCivilianIndex >= 0) {
      [assignedRoles[protectedIndex], assignedRoles[nextCivilianIndex]] = [
        assignedRoles[nextCivilianIndex],
        assignedRoles[protectedIndex],
      ];
    }
  }

  const roleByPlayerId: Record<string, PlayerRole> = {};
  playerIds.forEach((id, index) => {
    roleByPlayerId[id] = assignedRoles[index];
  });

  const spyIds = playerIds.filter((id) => roleByPlayerId[id] === PlayerRole.SPY);
  const whiteboardIds = playerIds.filter((id) => roleByPlayerId[id] === PlayerRole.WHITEBOARD);

  return {
    roleByPlayerId,
    spyIds,
    whiteboardIds,
    civilianCount,
    finalWhiteCount,
    normalizedSpyCount,
  };
};
