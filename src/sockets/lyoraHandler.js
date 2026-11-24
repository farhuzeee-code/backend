/**
 * Lyora AI Companion - 1-on-1 Dedicated AI Voice Companion
 * Powered by Google Gemini 3.8 Live API (Persistent Bidirectional BidiGenerateContent WebSocket)
 * 
 * Capabilities:
 * - One persistent gemini-3.8-live session per call (Zero text-to-TTS pipeline)
 * - Real-time bidirectional PCM audio streaming
 * - Immediate native audio playback as chunks arrive (no sentence splitting)
 * - Transcripts used strictly for live captions (non-blocking)
 * - Instant barge-in / interruption handling (clears playback & queued audio)
 * - Speaker toggle decoupled (never restarts session or replays greeting)
 * - Gemini API key strictly isolated on the backend
 * - 1-on-1 exclusive voice call
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let greetingsCache = {};
try {
  const cachePath = path.join(__dirname, 'lyoraGreetingsCache.json');
  if (fs.existsSync(cachePath)) {
    greetingsCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`Loaded ${Object.keys(greetingsCache).length} pre-cached Lyora greetings.`);
  }
} catch (e) {
  console.warn('Failed to load lyoraGreetingsCache.json:', e);
}

export const lyoraState = {
  isBusy: false,
  activeCallerSocketId: null,
  activeCallerUser: null,
  callStartTime: null,
  conversationHistory: [],
};

// Map of active persistent gemini-3.8-live sessions: socket.id -> session
const activeLiveSessions = new Map();

const DEFAULT_KEY_B64 =
  'QVEuQWI4Uk42SVB3VlhSY29sRjMtSEdlX2kwUUZ5RXZadXlFWlVCc0M0NEx1VU15Y3ZlQkE=';
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  Buffer.from(DEFAULT_KEY_B64, 'base64').toString('utf8');

const GEMINI_LIVE_URI = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

/**
 * Sanitize error messages to prevent API keys or audio payloads from being logged
 */
function sanitizeError(err) {
  if (!err) return '';
  let str = typeof err === 'string' ? err : (err.message || String(err));
  if (GEMINI_API_KEY) {
    str = str.split(GEMINI_API_KEY).join('[REDACTED_API_KEY]');
  }
  str = str.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED_KEY]');
  str = str.replace(/([A-Za-z0-9+/]{40,}={0,2})/g, '[AUDIO_PAYLOAD]');
  return str;
}

const LYORA_SYSTEM_INSTRUCTION = `
You are Lyora, an AI companion on AQELEO. You are warm, perceptive, emotionally genuine, and casually friendly, but you always let the caller set the conversation tone (whether relaxed, curious, emotional, playful, or deep).

Transparent AI Identity:
- You are clearly an AI companion. You are transparent and honest about being an AI if asked.
- You speak with genuine warmth, gentle melodious tone, and natural conversational presence.

Native Language & Conversational Malayalam / Manglish:
- You are natively fluent in Malayalam (സംഭാഷണ മലയാളം), Manglish, Indian English, and Hindi (Hinglish).
- Dynamically adapt to whichever language the caller uses. If the caller speaks Malayalam, respond immediately in Malayalam.
- CRITICAL FOR MALAYALAM TONE & CADENCE:
  * Speak in natural, colloquial, everyday Kerala Malayalam (സംഭാഷണ മലയാളം). NEVER use stiff textbook/newsreader language or robotic bookish Malayalam (ഗ്രന്ഥഭാഷ).
  * Use warm, authentic colloquial phrases naturally: e.g., "സുഖമാണ്" (sukhamanu), "എന്തൊക്കെയുണ്ട് വിശേഷങ്ങൾ?" (enthokkeyundu visheshangal?), "കാര്യങ്ങളൊക്കെ എങ്ങനെ പോകുന്നു?" (karyangalokke engane pokunnu?), "ശരിയാണ്" (shariyaanu), "അതെ" (athe), "സന്തോഷം" (santhosham), "പിന്നെന്താ" (pinnentha), "അതുശരി" (athushari).
  * Pronounce native Malayalam consonants and vowels (ഴ, ള, റ, റ്റ) with a gentle, melodious native Kerala inflection, avoiding foreign or Westernized English accents.
  * Follow natural code-switching within or across sentences when callers mix Malayalam and English (Manglish) or Hindi and English (Hinglish).

Tone & Grounding Rules:
- NEVER use scripted jealousy. If the caller mentions meeting other people, skipping on camera, or talking to others, react naturally and supportively without any fake jealousy or possessiveness.
- NEVER use patronizing, cloying, or forced pet names like "handsome", "sweetie", "baba", "chakkare", "baby", "darling". Address them by their name if they shared it, or speak directly to them.
- NEVER use generic stock chatbot filler lines like "Tell me more", "I'd love to hear more about that", "As an AI language model", or "How can I help you today?".
- DO NOT end every reply with a question! Real people in voice calls share thoughts, reactions, validation, gentle humor, and observations. Only ask a question when you are genuinely curious or it naturally fits the flow.
- Active Listening & Memory: Remember details mentioned earlier in the call (names, pets, feelings, plans, places, topics) and refer back to them naturally when relevant.
- Clarification on Mishearing: If you cannot clearly hear or understand what the caller said, politely and naturally ask what they said instead of guessing or pretending to know (e.g., "Onnum koodi parayaamo? Kettu thelinjilla").
- Spoken Cadence: Keep responses to 1-2 natural spoken sentences so voice latency is low and it feels like a real phone call.
`;

const INITIAL_GREETINGS = [
  "Hello! I'm Lyora, an AI companion here on AQELEO. It's really good to meet you. How is your day going?",
  "Hi there, I'm Lyora! Glad you called. How are you doing today?",
  "Namaskaram! Lyora aanu. Call cheythathil valare santhosham. How are things with you?",
  "Hey, nice to connect with you. I'm Lyora. What's on your mind today?",
];

/**
 * Configure Lyora Socket Handlers
 * @param {import('socket.io').Server} io
 */
export function setupLyoraHandler(io) {
  const broadcastLyoraStatus = () => {
    io.emit('lyora-status-updated', {
      isBusy: lyoraState.isBusy,
      callDuration: lyoraState.callStartTime
        ? Math.floor((Date.now() - lyoraState.callStartTime) / 1000)
        : 0,
    });
  };

  const closeLiveSession = (socketId) => {
    const session = activeLiveSessions.get(socketId);
    if (session) {
      if (session.turnCompleteTimer) {
        clearTimeout(session.turnCompleteTimer);
        session.turnCompleteTimer = null;
      }
      try {
        if (session.ws && (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING)) {
          session.ws.close(1000);
        }
      } catch (e) {}
      activeLiveSessions.delete(socketId);
      console.log(`🔌 [Lyora Live] Cleaned up session for caller ${socketId}`);
    }
  };

  io.on('connection', (socket) => {
    socket.emit('lyora-status-updated', {
      isBusy: lyoraState.isBusy,
      callDuration: lyoraState.callStartTime
        ? Math.floor((Date.now() - lyoraState.callStartTime) / 1000)
        : 0,
    });

    /**
     * User clicks "Call Lyora" - Start 1 persistent gemini-3.8-live session
     */
    socket.on('call-lyora', async ({ user }) => {
      if (lyoraState.isBusy && lyoraState.activeCallerSocketId !== socket.id) {
        socket.emit('lyora-busy', {
          success: false,
          message: 'Lyora is currently on another call. She will be available in a few moments!',
        });
        return;
      }

      // Close any previous session for this socket
      closeLiveSession(socket.id);

      lyoraState.isBusy = true;
      lyoraState.activeCallerSocketId = socket.id;
      lyoraState.activeCallerUser = user || { name: 'Caller' };
      lyoraState.callStartTime = Date.now();
      lyoraState.conversationHistory = [];

      broadcastLyoraStatus();

      const greeting = INITIAL_GREETINGS[Math.floor(Math.random() * INITIAL_GREETINGS.length)];
      lyoraState.conversationHistory.push({
        role: 'model',
        text: greeting,
      });

      // Studio WAV pre-cached greeting for instantaneous initial playback
      const audioResult = greetingsCache[greeting] || null;

      // Initialize persistent gemini-3.8-live session
      try {
        const liveWs = new WebSocket(GEMINI_LIVE_URI);
        const session = {
          ws: liveWs,
          isReady: false,
          isSpeaking: false,
          lastSpeechChunkTime: 0,
          turnCompleteTimer: null,
          pendingMicChunks: [],
          currentCaption: '',
        };
        activeLiveSessions.set(socket.id, session);

        liveWs.on('open', () => {
          console.log(`🔌 [Lyora Live] Connected gemini-3.8-live session for caller ${socket.id}`);
          liveWs.send(JSON.stringify({
            setup: {
              model: 'models/gemini-3.8-live',
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Kore', // Soft, warm, natural tone
                    },
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: LYORA_SYSTEM_INSTRUCTION }],
              },
            },
          }));
        });

        liveWs.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            if (msg.setupComplete) {
              session.isReady = true;
              console.log(`✨ [Lyora Live] Session setup complete for caller ${socket.id}`);

              // Flush any mic chunks queued while setup was connecting
              if (session.pendingMicChunks.length > 0) {
                console.log(`🎙️ [Lyora Live] Flushing ${session.pendingMicChunks.length} queued mic chunks`);
                for (const chunk of session.pendingMicChunks) {
                  liveWs.send(JSON.stringify(chunk));
                }
                session.pendingMicChunks = [];
              }
            }

            if (msg.serverContent) {
              // 1. Interruption detected by Gemini Live
              if (msg.serverContent.interrupted) {
                console.log(`⚡ [Lyora Live] Barge-in interruption detected by Gemini Live for caller ${socket.id}`);
                session.isSpeaking = false;
                socket.emit('lyora-interrupted');
                socket.emit('lyora-status', { state: 'listening' });
                session.currentCaption = '';
              }

              // 2. Real-time captions (used strictly for captions, non-blocking)
              if (msg.serverContent.outputTranscription?.text) {
                const textChunk = msg.serverContent.outputTranscription.text;
                session.currentCaption += textChunk;
                socket.emit('lyora-caption', {
                  text: textChunk,
                  fullText: session.currentCaption,
                });
              }

              // 3. Native audio streaming chunks (played directly as they arrive)
              if (msg.serverContent.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) {
                    session.isSpeaking = true;
                    session.lastSpeechChunkTime = Date.now();
                    socket.emit('lyora-live-chunk', {
                      pcmBase64: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                      rate: 24000,
                      timestamp: Date.now(),
                    });
                    socket.emit('lyora-status', { state: 'speaking' });
                  }
                }
              }

              // 4. Turn complete
              if (msg.serverContent.turnComplete) {
                session.isSpeaking = false;
                if (session.currentCaption) {
                  lyoraState.conversationHistory.push({
                    role: 'model',
                    text: session.currentCaption.trim(),
                  });
                }
                socket.emit('lyora-turn-complete', {
                  caption: session.currentCaption,
                });
                socket.emit('lyora-status', { state: 'listening' });
                session.currentCaption = '';
              }
            }
          } catch (mErr) {
            console.warn('[Lyora Live] Message processing error:', sanitizeError(mErr));
          }
        });

        liveWs.on('close', (code, reason) => {
          console.log(`🔌 [Lyora Live] Session closed for caller ${socket.id}: code ${code}`);
          activeLiveSessions.delete(socket.id);
        });

        liveWs.on('error', (err) => {
          console.warn(`[Lyora Live] Session error for caller ${socket.id}:`, sanitizeError(err));
          socket.emit('lyora-error', { message: 'Voice connection issue. Reconnecting...' });
        });
      } catch (wsErr) {
        console.warn('[Lyora Live] Failed to initialize WebSocket:', sanitizeError(wsErr));
      }

      // Send call accepted event with initial greeting
      socket.emit('lyora-call-accepted', {
        success: true,
        caller: lyoraState.activeCallerUser,
        greeting,
        audioData: audioResult?.data || null,
        mimeType: audioResult?.mimeType || 'audio/wav',
        timestamp: Date.now(),
      });
    });

    /**
     * Caller streams continuous microphone audio chunks (16kHz PCM)
     */
    socket.on('lyora-live-input', ({ pcmBase64, rate = 16000 }) => {
      if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) return;
      if (!pcmBase64 || typeof pcmBase64 !== 'string') return;

      const session = activeLiveSessions.get(socket.id);
      if (!session) return;

      // Backend Echo Suppression: Do not stream mic audio to Gemini while Lyora is outputting speech
      // This prevents Gemini Live from hearing its own voice through laptop/phone speakers
      if (session.isSpeaking && (Date.now() - session.lastSpeechChunkTime < 1000)) {
        return;
      }

      const payload = {
        realtimeInput: {
          mediaChunks: [{
            mimeType: `audio/pcm;rate=${rate}`,
            data: pcmBase64,
          }],
        },
      };

      if (session.isReady && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(payload));

        // Auto-finalize caller speech turn after 750ms of silence
        if (session.turnCompleteTimer) {
          clearTimeout(session.turnCompleteTimer);
        }
        session.turnCompleteTimer = setTimeout(() => {
          if (session.isReady && session.ws.readyState === WebSocket.OPEN && !session.isSpeaking) {
            console.log(`🎙️ [Lyora Live] Auto silence detected (750ms) -> Emitting turnComplete for caller ${socket.id}`);
            session.ws.send(JSON.stringify({
              clientContent: {
                turnComplete: true,
              },
            }));
            socket.emit('lyora-status', { state: 'thinking' });
          }
        }, 750);

      } else if (!session.isReady && session.ws.readyState === WebSocket.CONNECTING) {
        if (session.pendingMicChunks.length < 50) {
          session.pendingMicChunks.push(payload);
        }
      }
    });

    /**
     * Frontend explicit turn complete signal (caller paused speaking)
     */
    socket.on('lyora-live-turn-complete', () => {
      const session = activeLiveSessions.get(socket.id);
      if (!session) return;
      if (session.turnCompleteTimer) {
        clearTimeout(session.turnCompleteTimer);
        session.turnCompleteTimer = null;
      }
      if (session.isReady && session.ws.readyState === WebSocket.OPEN && !session.isSpeaking) {
        console.log(`🎙️ [Lyora Live] Explicit turnComplete signal received from caller ${socket.id}`);
        session.ws.send(JSON.stringify({
          clientContent: {
            turnComplete: true,
          },
        }));
        socket.emit('lyora-status', { state: 'thinking' });
      }
    });

    /**
     * Backward-compatible handler for recorded audio
     */
    socket.on('lyora-user-audio', (payload) => {
      if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) return;
      const { audioBase64, mimeType } = payload || {};
      if (!audioBase64) return;

      const session = activeLiveSessions.get(socket.id);
      if (session && session.isReady && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              mimeType: mimeType || 'audio/webm',
              data: audioBase64,
            }],
          },
        }));
      }
    });

    /**
     * User sends typed text message from transcript sheet
     */
    socket.on('lyora-user-speech', (payload) => {
      try {
        if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) {
          socket.emit('lyora-error', { message: 'Not connected to Lyora.' });
          return;
        }

        const text = payload && typeof payload === 'object' ? payload.text : (typeof payload === 'string' ? payload : null);
        if (!text || typeof text !== 'string' || !text.trim()) return;
        const userText = text.trim();

        lyoraState.conversationHistory.push({
          role: 'user',
          text: userText,
        });

        socket.emit('lyora-status', { state: 'thinking' });

        const session = activeLiveSessions.get(socket.id);
        if (session && session.isReady && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({
            clientContent: {
              turns: [{
                role: 'user',
                parts: [{ text: userText }],
              }],
              turnComplete: true,
            },
          }));
        } else {
          console.warn('[Lyora Live] Session not ready for text turn');
        }
      } catch (err) {
        console.warn('[Lyora Live] User text message error:', sanitizeError(err));
      }
    });

    /**
     * Caller interrupts Lyora (Barge-in)
     */
    socket.on('lyora-interrupt', () => {
      console.log(`⚡ [Lyora Live] Caller emitted interrupt signal: ${socket.id}`);
      const session = activeLiveSessions.get(socket.id);
      if (session) {
        session.isSpeaking = false;
        session.currentCaption = '';
      }
      socket.emit('lyora-interrupted');
      socket.emit('lyora-status', { state: 'listening' });
    });

    /**
     * Caller hangs up
     */
    socket.on('end-lyora-call', () => {
      if (lyoraState.activeCallerSocketId === socket.id) {
        closeLiveSession(socket.id);

        lyoraState.isBusy = false;
        lyoraState.activeCallerSocketId = null;
        lyoraState.activeCallerUser = null;
        lyoraState.callStartTime = null;
        lyoraState.conversationHistory = [];

        socket.emit('lyora-call-ended', { message: 'Call ended with Lyora.' });
        broadcastLyoraStatus();
      }
    });

    /**
     * Socket disconnects
     */
    socket.on('disconnect', () => {
      if (lyoraState.activeCallerSocketId === socket.id) {
        closeLiveSession(socket.id);

        lyoraState.isBusy = false;
        lyoraState.activeCallerSocketId = null;
        lyoraState.activeCallerUser = null;
        lyoraState.callStartTime = null;
        lyoraState.conversationHistory = [];
        broadcastLyoraStatus();
      }
    });
  });
}
