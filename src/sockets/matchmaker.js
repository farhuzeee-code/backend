/**
 * Matchmaker Engine for 1-on-1 Random Video & Audio Calling
 * Supports gender preference filtering, call type matching (video/audio),
 * and instant skip/next-partner routing.
 */
class Matchmaker {
  constructor() {
    // Array of waiting user requests:
    // [{ socketId, user: { _id, name, avatar }, myGender, targetGender, callType, queuedAt }]
    this.queue = [];
    // Map of active paired sessions:
    // socketId -> { partnerSocketId, roomId, matchedAt }
    this.activePairs = new Map();
  }

  /**
   * Enqueue a user and try to find an immediate match
   * @param {string} socketId 
   * @param {Object} payload { user, myGender, targetGender, callType }
   * @returns {{ matched: boolean, userA?: Object, userB?: Object, roomId?: string, queueSize?: number }}
   */
  enqueue(socketId, payload) {
    // Remove if already in queue
    this.dequeue(socketId);

    const candidate = {
      socketId,
      user: payload.user || { name: 'Anonymous', avatar: '' },
      myGender: payload.myGender || 'unspecified',
      targetGender: payload.targetGender || 'any',
      callType: payload.callType || 'video', // 'video' | 'audio'
      queuedAt: Date.now(),
    };

    // Attempt to find a mutually compatible match from the waiting queue
    const matchIndex = this.findMatch(candidate);

    if (matchIndex !== -1) {
      const partner = this.queue.splice(matchIndex, 1)[0];
      const roomId = `match_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      this.activePairs.set(candidate.socketId, { partnerSocketId: partner.socketId, roomId });
      this.activePairs.set(partner.socketId, { partnerSocketId: candidate.socketId, roomId });

      return {
        matched: true,
        userA: candidate,
        userB: partner,
        roomId,
      };
    }

    // No match found yet, place candidate in waiting queue
    this.queue.push(candidate);
    return {
      matched: false,
      queueSize: this.queue.length,
    };
  }

  /**
   * Compatibility matching logic
   */
  findMatch(candidate) {
    for (let i = 0; i < this.queue.length; i++) {
      const waiting = this.queue[i];

      // Prevent matching with self
      if (waiting.socketId === candidate.socketId) continue;

      // Must have matching call type (video with video, audio with audio)
      if (waiting.callType !== candidate.callType) continue;

      // Gender preference matching:
      // Does waiting user accept candidate's gender?
      const waitingAcceptsCandidate =
        waiting.targetGender === 'any' ||
        waiting.targetGender === candidate.myGender;

      // Does candidate accept waiting user's gender?
      const candidateAcceptsWaiting =
        candidate.targetGender === 'any' ||
        candidate.targetGender === waiting.myGender;

      if (waitingAcceptsCandidate && candidateAcceptsWaiting) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Remove a socket from the waiting queue
   */
  dequeue(socketId) {
    const idx = this.queue.findIndex((item) => item.socketId === socketId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Disconnect an active paired call (skip / next / exit)
   */
  handleSkip(socketId) {
    const pair = this.activePairs.get(socketId);
    if (!pair) return null;

    const partnerSocketId = pair.partnerSocketId;
    const roomId = pair.roomId;

    this.activePairs.delete(socketId);
    this.activePairs.delete(partnerSocketId);

    return {
      partnerSocketId,
      roomId,
    };
  }

  /**
   * Check if socket is in an active match pair
   */
  getActivePair(socketId) {
    return this.activePairs.get(socketId);
  }

  /**
   * Return waiting queue statistics
   */
  getWaitingStats() {
    return {
      totalInQueue: this.queue.length,
      videoQueue: this.queue.filter((q) => q.callType === 'video').length,
      audioQueue: this.queue.filter((q) => q.callType === 'audio').length,
      activePairsCount: Math.floor(this.activePairs.size / 2),
    };
  }
}

export const matchmaker = new Matchmaker();

