import { Call } from '../models/Call.js';
import { roomStore } from './roomStore.js';

/**
 * Configure WebRTC Signaling & Admin Monitoring on Socket.io instance
 * @param {import('socket.io').Server} io
 */
export const setupSignaling = (io) => {
  // Helper to broadcast active calls list to all connected admin monitors
  const broadcastActiveCalls = () => {
    const activeCalls = roomStore.getAllActiveRooms();
    io.of('/admin-monitor').emit('active-calls-updated', activeCalls);
    io.to('admin-monitor-room').emit('active-calls-updated', activeCalls);
  };

  // Dedicated namespace for Admin Monitor
  const adminNamespace = io.of('/admin-monitor');
  adminNamespace.on('connection', (socket) => {
    // Send immediate snapshot of all active rooms
    socket.emit('active-calls-updated', roomStore.getAllActiveRooms());

    socket.on('disconnect', () => {
      // Admin disconnected, nothing to clean up
    });
  });

  // Main namespace for WebRTC Peer Signaling
  io.on('connection', (socket) => {
    // Admin client joining monitor room via main namespace (fallback)
    socket.on('join-admin-monitor', () => {
      socket.join('admin-monitor-room');
      socket.emit('active-calls-updated', roomStore.getAllActiveRooms());
    });

    /**
     * Join room
     * payload: { roomId, user: { _id, name, avatar } }
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

      // If this is the second participant, a call has officially connected!
      if (room.participants.length === 2) {
        const caller = room.participants[0];
        const callee = room.participants[1];

        try {
          // Create or update database record for this call
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

      // Notify other peers in the room
      socket.to(normalizedRoomId).emit('user-joined', {
        participant,
        existingParticipants: room.participants,
      });

      // Send current room state back to joining peer
      socket.emit('room-joined', {
        roomId: normalizedRoomId,
        participants: room.participants,
        isInitiator: room.participants.length === 1,
      });

      // Broadcast update to Admin monitors
      broadcastActiveCalls();
    });

    /**
     * WebRTC SDP Offer Relay
     */
    socket.on('offer', ({ roomId, sdp }) => {
      socket.to(roomId).emit('offer', {
        sdp,
        senderSocketId: socket.id,
        senderUser: socket.data.user,
      });
    });

    /**
     * WebRTC SDP Answer Relay
     */
    socket.on('answer', ({ roomId, sdp }) => {
      socket.to(roomId).emit('answer', {
        sdp,
        senderSocketId: socket.id,
      });
    });

    /**
     * WebRTC ICE Candidate Relay
     */
    socket.on('ice-candidate', ({ roomId, candidate }) => {
      socket.to(roomId).emit('ice-candidate', {
        candidate,
        senderSocketId: socket.id,
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
      if (!normalizedRoomId) return;

      await handleRoomExit(normalizedRoomId, socket.id, 'completed');
    });

    /**
     * Disconnect handler (handles sudden dropped calls - Perspective #8)
     */
    socket.on('disconnect', async () => {
      const socketId = socket.id;
      const roomMatch = roomStore.findRoomBySocketId(socketId);

      if (roomMatch) {
        await handleRoomExit(roomMatch.roomId, socketId, 'dropped');
      }
    });

    /**
     * Helper to process room exit, database record update, and peer notifications
     */
    const handleRoomExit = async (roomId, socketId, exitStatus) => {
      const room = roomStore.getRoom(roomId);
      if (!room) return;

      const leavingParticipant = room.participants.find((p) => p.socketId === socketId);
      const remainingParticipants = room.participants.filter((p) => p.socketId !== socketId);

      // Notify remaining peer in room
      if (exitStatus === 'dropped') {
        socket.to(roomId).emit('peer-disconnected', {
          socketId,
          name: leavingParticipant?.name || 'Peer',
          reason: 'Network disconnect or window closed unexpectedly',
          canReconnect: true,
        });
      } else {
        socket.to(roomId).emit('peer-left', {
          socketId,
          name: leavingParticipant?.name || 'Peer',
        });
      }

      // If call document was created, update it in MongoDB
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

      // Remove participant from memory
      roomStore.removeParticipant(roomId, socketId);
      socket.leave(roomId);

      // Broadcast active calls to admin monitors
      broadcastActiveCalls();
    };
  });

  // Export termination function for Admin controller
  return {
    broadcastActiveCalls,
    terminateRoom: async (roomId, reason = 'Terminated by Administrator') => {
      const room = roomStore.getRoom(roomId);
      if (!room) return false;

      // Notify all sockets in room
      io.to(roomId).emit('call-terminated', {
        reason,
        timestamp: Date.now(),
      });

      // Update DB record
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

      // Disconnect all sockets from room
      io.in(roomId).socketsLeave(roomId);
      roomStore.deleteRoom(roomId);
      broadcastActiveCalls();
      return true;
    },
  };
};

