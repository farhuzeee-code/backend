import { roomStore } from '../src/sockets/roomStore.js';
import { User } from '../src/models/User.js';
import { Call } from '../src/models/Call.js';
import { Settings } from '../src/models/Settings.js';
import { Invoice } from '../src/models/Invoice.js';

console.log('--- AQELEO Backend Internal Unit Validation ---');

// 1. Validate RoomStore logic
const room1 = roomStore.createOrJoinRoom('room-test-1', {
  userId: 'user1',
  name: 'Alice',
  socketId: 'sock-1',
});
console.log('RoomStore creation:', room1.roomId === 'room-test-1' && room1.participants.length === 1 ? 'PASS' : 'FAIL');

const room2 = roomStore.createOrJoinRoom('room-test-1', {
  userId: 'user2',
  name: 'Bob',
  socketId: 'sock-2',
});
console.log('RoomStore join 2nd user:', room2.participants.length === 2 ? 'PASS' : 'FAIL');

const allActive = roomStore.getAllActiveRooms();
console.log('RoomStore active rooms:', allActive.length === 1 && allActive[0].activeCount === 2 ? 'PASS' : 'FAIL');

// 2. Validate leave logic
const left = roomStore.removeParticipant('room-test-1', 'sock-1');
console.log('RoomStore remove participant:', left.room.participants.length === 1 ? 'PASS' : 'FAIL');

roomStore.removeParticipant('room-test-1', 'sock-2');
console.log('RoomStore auto cleanup empty room:', roomStore.getAllActiveRooms().length === 0 ? 'PASS' : 'FAIL');

// 3. Verify Mongoose model schemas compile
console.log('Mongoose User Model compiled:', typeof User === 'function' ? 'PASS' : 'FAIL');
console.log('Mongoose Call Model compiled:', typeof Call === 'function' ? 'PASS' : 'FAIL');
console.log('Mongoose Settings Model compiled:', typeof Settings === 'function' ? 'PASS' : 'FAIL');
console.log('Mongoose Invoice Model compiled:', typeof Invoice === 'function' ? 'PASS' : 'FAIL');

console.log('--- Internal Backend Unit Validation Complete ---');
process.exit(0);
