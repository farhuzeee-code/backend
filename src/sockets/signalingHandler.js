import { Call } from '../models/Call.js';
import { roomStore } from './roomStore.js';
import { matchmaker } from './matchmaker.js';

/**
 * Configure WebRTC Signaling, 1-on-1 Random Matchmaking & Admin Monitoring
 * @param {import('socket.io').Server} io
 */
export const setupSignaling = (io) => {
  // Helper to broadcast active calls & match queue stats to admin monitors and users
  const broadcastActiveCalls = () => {
    const activeCalls = roomStore.getAllActiveRooms();
    const waiting = matchmaker.getWaitingStats();
    const totalOnline = io.engine ? io.engine.clientsCount : io.sockets.sockets.size;

    const queueStats = {
      ...waiting,
      totalOnline,
    };

    io.of('/admin-monitor').emit('active-calls-updated', { activeCalls, queueStats });
    io.to('admin-monitor-room').emit('active-calls-updated', { activeCalls, queueStats });
    io.emit('queue-stats-updated', queueStats);
  };

  // Dedicated namespace for Admin Monitor
  const adminNamespace = io.of('/admin-monitor');
  adminNamespace.on('connection', (socket) => {
    socket.emit('active-calls-updated', {
      activeCalls: roomStore.getAllActiveRooms(),
      queueStats: {
        ...matchmaker.getWaitingStats(),
        totalOnline: io.engine ? io.engine.clientsCount : io.sockets.sockets.size,
      },
    });
  });

  // Main namespace for WebRTC Peer Signaling & Matchmaking
  io.on('connection', (socket) => {
    // Send immediate real queue stats to connected user
    broadcastActiveCalls();

    socket.on('join-admin-monitor', () => {
      socket.join('admin-monitor-room');
      socket.emit('active-calls-updated', {
        activeCalls: roomStore.getAllActiveRooms(),
        queueStats: matchmaker.getWaitingStats(),
      });
    });

    /**
     * 1-on-1 RANDOM MATCHMAKING ENGINE
     * payload: { myGender, targetGender, callType, user }
     */
    socket.on('find-match', async ({ myGender, targetGender, callType, user }) => {
      socket.data.user = user || { name: 'Anonymous', _id: null };
      socket.data.myGender = myGender || 'unspecified';
      socket.data.targetGender = targetGender || 'any';
      socket.data.callType = callType || 'video';

      const matchResult = matchmaker.enqueue(socket.id, {
        myGender: socket.data.myGender,
        targetGender: socket.data.targetGender,
        callType: socket.data.callType,
        user: socket.data.user,
      });

      if (matchResult.matched) {
        await connectMatchedPair(matchResult.userA, matchResult.userB, matchResult.roomId);
      } else {
        socket.emit('match-searching', {
          queueSize: matchResult.queueSize,
          message: 'Searching for a compatible partner...',
        });
        broadcastActiveCalls();
      }
    });

    /**
     * Cancel match search
     */
    socket.on('cancel-match', () => {
      matchmaker.dequeue(socket.id);
      socket.emit('match-canceled');
      broadcastActiveCalls();
    });

    /**
     * Skip to Next Partner
     */
    socket.on('skip-match', async ({ myGender, targetGender, callType, user } = {}) => {
      const activePair = matchmaker.handleSkip(socket.id);
      const prevRoomId = socket.data.roomId;

      if (activePair) {
        const { partnerSocketId, roomId } = activePair;

        // Notify partner that they were skipped
        io.to(partnerSocketId).emit('partner-skipped', {
          message: 'Your partner moved to the next call.',
        });

        // Clean up room records
        await handleRoomExit(roomId, socket.id, 'skipped');
        await handleRoomExit(roomId, partnerSocketId, 'skipped');
      } else if (prevRoomId) {
        await handleRoomExit(prevRoomId, socket.id, 'skipped');
      }

      // Re-enqueue the skipping user
      const candidateUser = user || socket.data.user;
      const candidateMyGender = myGender || socket.data.myGender || 'unspecified';
      const candidateTargetGender = targetGender || socket.data.targetGender || 'any';
      const candidateCallType = callType || socket.data.callType || 'video';

      const matchResult = matchmaker.enqueue(socket.id, {
        myGender: candidateMyGender,
        targetGender: candidateTargetGender,
        callType: candidateCallType,
        user: candidateUser,
      });

      if (matchResult.matched) {
        await connectMatchedPair(matchResult.userA, matchResult.userB, matchResult.roomId);
      } else {
        socket.emit('match-searching', {
          queueSize: matchResult.queueSize,
          message: 'Searching for next partner...',
        });
        broadcastActiveCalls();
      }
    });

    /**
     * Helper to pair and connect two matched users
     */
    const connectMatchedPair = async (userA, userB, roomId) => {
      const pA = {
        userId: userA.user?._id || userA.user?.id || null,
        name: userA.user?.name || 'Anonymous',
        avatar: userA.user?.avatar || '',
        gender: userA.myGender,
        socketId: userA.socketId,
      };

      const pB = {
        userId: userB.user?._id || userB.user?.id || null,
        name: userB.user?.name || 'Anonymous',
        avatar: userB.user?.avatar || '',
        gender: userB.myGender,
        socketId: userB.socketId,
      };

      const socketA = io.sockets.sockets.get(userA.socketId);
      const socketB = io.sockets.sockets.get(userB.socketId);

      if (socketA) {
        socketA.join(roomId);
        socketA.data.roomId = roomId;
      }
      if (socketB) {
        socketB.join(roomId);
        socketB.data.roomId = roomId;
      }

      const room = roomStore.createOrJoinRoom(roomId, pA);
      roomStore.createOrJoinRoom(roomId, pB);

      // Create database call record
      try {
        const callDoc = await Call.create({
          roomId,
          participants: [pA.userId, pB.userId].filter(Boolean),
          caller: pA.userId || null,
          callee: pB.userId || null,
          startTime: new Date(room.startTime),
          status: 'active',
        });
        room.callDocId = callDoc._id.toString();
      } catch (err) {
        console.error('[Match Call DB Error]', err.message);
      }

      // Notify User A (initiator, creates offer)
      if (socketA) {
        socketA.emit('match-connected', {
          roomId,
          partner: pB,
          isInitiator: true,
          callType: userA.callType,
        });
      }

      // Notify User B (receiver, awaits offer and responds with answer)
      if (socketB) {
        socketB.emit('match-connected', {
          roomId,
          partner: pA,
          isInitiator: false,
          callType: userB.callType,
        });
      }

      broadcastActiveCalls();
    };

    /**
     * Standard Room Code Join (for direct /room/:roomId calls)
     */
    socket.on('join-room', async ({ roomId, user }) => {
      if (!roomId) return;

      const normalizedRoomId = String(roomId).trim().toLowerCase();
      const existingRoom = roomStore.getRoom(normalizedRoomId);

      // Check max participants (1-on-1 calls)
      if (existingRoom && existingRoom.participants.length >= 2) {
        socket.emit('room-full', {
          message: 'This room already has the maximum number of participants (2).',
        });
        return;
      }

      socket.join(normalizedRoomId);
      socket.data.roomId = normalizedRoomId;
      socket.data.user = user || { name: 'Anonymous', _id: null };

      const participant = {
        userId: user?._id || user?.id || null,
        name: user?.name || 'Guest User',
        avatar: user?.avatar || '',
        socketId: socket.id,
      };

      const room = roomStore.createOrJoinRoom(normalizedRoomId, participant);

      if (room.participants.length === 2) {
        const caller = room.participants[0];
        const callee = room.participants[1];

        try {
          const callDoc = await Call.create({
            roomId: normalizedRoomId,
            participants: [caller.userId, callee.userId].filter(Boolean),
            caller: caller.userId || null,
            callee: callee.userId || null,
            startTime: new Date(room.startTime),
            status: 'active',
          });
          room.callDocId = callDoc._id.toString();
        } catch (dbError) {
          console.error('[Call DB Creation Error]', dbError.message);
        }
      }

      socket.to(normalizedRoomId).emit('user-joined', {
        participant,
        existingParticipants: room.participants,
      });

      socket.emit('room-joined', {
        roomId: normalizedRoomId,
        participants: room.participants,
        isInitiator: room.participants.length === 1,
      });

      broadcastActiveCalls();
    });

    /**
     * WebRTC SDP Offer Relay
     */
    socket.on('offer', ({ roomId, sdp }) => {
      const targetRoom = roomId || socket.data.roomId;
      if (!targetRoom) return;
      console.log(`[Signaling] Relaying offer for room ${targetRoom} from socket ${socket.id}`);
      socket.to(targetRoom).emit('offer', {
        roomId: targetRoom,
        sdp,
        senderSocketId: socket.id,
        senderUser: socket.data.user,
      });
    });

    /**
     * WebRTC SDP Answer Relay
     */
    socket.on('answer', ({ roomId, sdp }) => {
      const targetRoom = roomId || socket.data.roomId;
      if (!targetRoom) return;
      console.log(`[Signaling] Relaying answer for room ${targetRoom} from socket ${socket.id}`);
      socket.to(targetRoom).emit('answer', {
        roomId: targetRoom,
        sdp,
        senderSocketId: socket.id,
      });
    });

    /**
     * WebRTC ICE Candidate Relay
     */
    socket.on('ice-candidate', ({ roomId, candidate }) => {
      const targetRoom = roomId || socket.data.roomId;
      if (!targetRoom || !candidate) return;
      socket.to(targetRoom).emit('ice-candidate', {
        roomId: targetRoom,
        candidate,
        senderSocketId: socket.id,
      });
    });

    /**
     * In-Call Real-Time Text Chat Relay (Omegle style)
     */
    socket.on('chat-message', ({ roomId, message, sender, timestamp }) => {
      if (!roomId || !message) return;
      socket.to(roomId).emit('chat-message', {
        message,
        sender: sender || socket.data.user?.name || 'Stranger',
        timestamp: timestamp || Date.now(),
      });
    });

    /**
     * Media state toggle (mute/unmute audio or video)
     */
    socket.on('media-state', ({ roomId, isMuted, isVideoOff }) => {
      socket.to(roomId).emit('media-state-changed', {
        socketId: socket.id,
        isMuted,
        isVideoOff,
      });
    });

    /**
     * Clean leave room
     */
    socket.on('leave-room', async ({ roomId }) => {
      const normalizedRoomId = roomId || socket.data.roomId;
      matchmaker.dequeue(socket.id);
      matchmaker.handleSkip(socket.id);

      if (normalizedRoomId) {
        await handleRoomExit(normalizedRoomId, socket.id, 'completed');
      }
    });

    /**
     * Disconnect handler
     */
    socket.on('disconnect', async () => {
      const socketId = socket.id;

      // Clean from matchmaker
      matchmaker.dequeue(socketId);
      const activePair = matchmaker.handleSkip(socketId);
      if (activePair) {
        io.to(activePair.partnerSocketId).emit('partner-disconnected', {
          message: 'Your partner disconnected.',
          canReconnect: false,
        });
        await handleRoomExit(activePair.roomId, socketId, 'dropped');
      }

      const roomMatch = roomStore.findRoomBySocketId(socketId);
      if (roomMatch) {
        await handleRoomExit(roomMatch.roomId, socketId, 'dropped');
      }

      broadcastActiveCalls();
    });

    /**
     * Helper to process room exit, database record update, and peer notifications
     */
    const handleRoomExit = async (roomId, socketId, exitStatus) => {
      const room = roomStore.getRoom(roomId);
      if (!room) return;

      const leavingParticipant = room.participants.find((p) => p.socketId === socketId);

      if (exitStatus === 'dropped') {
        socket.to(roomId).emit('peer-disconnected', {
          socketId,
          name: leavingParticipant?.name || 'Partner',
          reason: 'Network disconnect or window closed unexpectedly',
          canReconnect: true,
        });
      } else if (exitStatus === 'skipped') {
        // Handled by partner-skipped event
      } else {
        socket.to(roomId).emit('peer-left', {
          socketId,
          name: leavingParticipant?.name || 'Partner',
        });
      }

      if (room.callDocId) {
        try {
          const durationSeconds = Math.max(
            0,
            Math.floor((Date.now() - room.startTime) / 1000)
          );

          await Call.findByIdAndUpdate(room.callDocId, {
            endTime: new Date(),
            durationSeconds,
            status: exitStatus,
          });
        } catch (err) {
          console.error('[Call DB Finalize Error]', err.message);
        }
      }

      roomStore.removeParticipant(roomId, socketId);
      socket.leave(roomId);

      broadcastActiveCalls();
    };
  });

  return {
    broadcastActiveCalls,
    terminateRoom: async (roomId, reason = 'Terminated by Administrator') => {
      const room = roomStore.getRoom(roomId);
      if (!room) return false;

      io.to(roomId).emit('call-terminated', {
        reason,
        timestamp: Date.now(),
      });

      if (room.callDocId) {
        try {
          const durationSeconds = Math.max(
            0,
            Math.floor((Date.now() - room.startTime) / 1000)
          );
          await Call.findByIdAndUpdate(room.callDocId, {
            endTime: new Date(),
            durationSeconds,
            status: 'terminated',
          });
        } catch (err) {
          console.error('[Call DB Terminate Error]', err.message);
        }
      }

      io.in(roomId).socketsLeave(roomId);
      roomStore.deleteRoom(roomId);
      broadcastActiveCalls();
      return true;
    },
  };
};
