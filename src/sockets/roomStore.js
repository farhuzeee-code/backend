/**
 * In-memory active calls store
 * roomId -> {
 *   roomId: string,
 *   callDocId: string | null,
 *   callerId: string | null,
 *   calleeId: string | null,
 *   startTime: number,
 *   participants: Array<{ userId: string, name: string, socketId: string }>,
 *   sockets: Set<string>
 * }
 */
class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  createOrJoinRoom(roomId, participant) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        callDocId: null,
        callerId: participant.userId || null,
        calleeId: null,
        startTime: Date.now(),
        participants: [],
        sockets: new Set(),
      };
      this.rooms.set(roomId, room);
    }

    // Add socket to set
    room.sockets.add(participant.socketId);

    // Update or add participant
    const existingIndex = room.participants.findIndex(
      (p) => p.socketId === participant.socketId || (participant.userId && p.userId === participant.userId)
    );

    if (existingIndex >= 0) {
      room.participants[existingIndex] = {
        ...room.participants[existingIndex],
        ...participant,
      };
    } else {
      room.participants.push(participant);
      if (room.participants.length === 2 && !room.calleeId) {
        room.calleeId = participant.userId || null;
      }
    }

    return room;
  }

  removeParticipant(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.sockets.delete(socketId);
    const removedParticipant = room.participants.find((p) => p.socketId === socketId);
    room.participants = room.participants.filter((p) => p.socketId !== socketId);

    // If no participants remain, delete room
    if (room.participants.length === 0) {
      this.rooms.delete(roomId);
    }

    return { room, removedParticipant };
  }

  deleteRoom(roomId) {
    return this.rooms.delete(roomId);
  }

  findRoomBySocketId(socketId) {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.sockets.has(socketId) || room.participants.some((p) => p.socketId === socketId)) {
        return { roomId, room };
      }
    }
    return null;
  }

  getAllActiveRooms() {
    const list = [];
    for (const [roomId, room] of this.rooms.entries()) {
      list.push({
        roomId,
        callDocId: room.callDocId,
        callerId: room.callerId,
        calleeId: room.calleeId,
        startTime: room.startTime,
        durationSeconds: Math.floor((Date.now() - room.startTime) / 1000),
        participants: room.participants.map((p) => ({
          userId: p.userId,
          name: p.name,
          socketId: p.socketId,
        })),
        activeCount: room.participants.length,
      });
    }
    return list;
  }
}

export const roomStore = new RoomStore();

