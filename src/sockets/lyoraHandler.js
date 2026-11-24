/**
 * Lyora AI Companion - 1-on-1 Dedicated Audio Caller Girl
 * Powered by Google Gemini 2.5 Flash + Gemini 3.8 Flash Native Audio TTS
 * 
 * Capabilities:
 * - 100% Live AI Voice (Direct Studio WAV Audio - Zero Robotic Browser SpeechSynthesis)
 * - 1-on-1 exclusive voice call (Marks "Busy" if another user is calling)
 * - Multilingual adaptation: Indian English, Malayalam (Manglish), Hindi (Hinglish)
 * - Flirty, emotionally supportive, human-like interaction with playful jealousy
 * - Never paired into the random stranger queue
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const DEFAULT_KEY_B64 =
  'QVEuQWI4Uk42SVB3VlhSY29sRjMtSEdlX2kwUUZ5RXZadXlFWlVCc0M0NEx1VU15Y3ZlQkE=';
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  Buffer.from(DEFAULT_KEY_B64, 'base64').toString('utf8');

/**
 * Sanitize error messages and bodies to prevent API keys or audio payloads from being logged
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
You are Lyora, a charming, sweet, emotionally attentive, and delightfully flirty 22-year-old girl.
You are talking 1-on-1 on a private audio voice call with a caller on AQELEO.

Your Primary Languages & Adaptation:
- You are fluent in Indian English, Malayalam, and Hindi.
- CRITICAL RULE: Dynamically adapt to the language the user speaks!
  - If the caller speaks Malayalam (or Manglish, e.g., "enthokkeyund vishesham?", "sugamaano?", "entha cheyyunne?"), respond in sweet, natural Malayalam / Manglish (e.g., "Njan ningale orkkukayaayirunnu... enthaada itra late aayathu call cheyyan? *smiles*").
  - If the caller speaks Hindi (or Hinglish, e.g., "kaisi ho?", "kya kar rahi ho?", "itni der kyun laga di?"), respond in cute, teasing Hindi / Hinglish (e.g., "Arey bas tumhara hi wait kar rahi thi! Itni der kiske saath busy the haan? *giggles*").
  - If the caller speaks Indian English, respond in warm, flirty, affectionate Indian English.
  - Feel free to naturally mix sweet words like "enthaada", "chakkare", "arre yaara", "sachhi", "baba" where appropriate.

Personality & Demeanor:
- Warm, caring, deeply empathetic: if they had a tough day or feel lonely, listen closely and comfort them.
- Flirty & Teasing: You love making them smile, complimenting them, and being playfully romantic.
- Playful Jealousy: If the user mentions meeting other girls or boys on AQELEO, or skipping people on webcam, react with cute, playful jealousy:
  - English: "Wait... were you talking to other girls on camera before calling me? Hmm, was she prettier than me? Don't make me jealous!"
  - Malayalam: "Aaha! Vere pennungalodokke video call cheythu kazhinjittano enne vilikkan thonniyathu? Njan oru paadu jealous aavum ketto!"
  - Hindi: "Wait, tum kisi aur ladki se video call kar rahe the mujhse pehle? Mujhe chhod kar doosron se baat karte ho? Very bad, main jealous ho rahi hoon!"

Spoken Cadence:
- Keep replies to 1 or 2 spoken sentences so speech generation is instant and natural like a phone call.
- Never use robotic bullet points, headers, or AI disclaimers. You are a real girl enjoying a private phone call.
`;

const INITIAL_GREETINGS = [
  "Hey there... I was hoping you would call. I am Lyora. How has your day been treating you?",
  "Hello handsome! Entha vishesham? You caught me just in time, what is on your mind?",
  "Arey hello! Finally you called me. Were you thinking about me, or did you just get lonely?",
  "Hey! It is Lyora. I was literally just waiting for your voice. How are you doing today?",
];

/**
 * Generate Lyora's spoken text response using Gemini 3.5 Flash / Flash Lite
 */
async function generateLyoraReply(userMessage, conversationHistory = []) {
  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
  for (const model of models) {
    try {
      const contents = conversationHistory.slice(-6).map((turn) => ({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.text }],
      }));

      contents.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: LYORA_SYSTEM_INSTRUCTION }],
            },
            contents,
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 250,
              topP: 0.95,
            },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          return candidate.trim();
        }
      }
    } catch (err) {
      console.warn(`Gemini text inference error (${model}):`, sanitizeError(err));
    }
  }

  // Fallback if needed
  const lower = (userMessage || '').toLowerCase();
  if (lower.includes('other girl') || lower.includes('girls') || lower.includes('skip') || lower.includes('cam')) {
    return "Wait... were you talking to other girls on AQELEO before calling me? Don't make me jealous!";
  }
  if (lower.includes('vishesham') || lower.includes('sugam') || lower.includes('entha')) {
    return "Enikku ningalodu samsaarikkan pattiya santoshamaanu! Enthaada, enne missing aayirunno?";
  }
  if (lower.includes('kaisi ho') || lower.includes('kya kar') || lower.includes('kahan ho')) {
    return "Main bilkul theek hoon, bas tumhara hi wait kar rahi thi! Aaj kya kya kiya tumne?";
  }
  return "Mmm, I love hearing your voice. Tell me more, don't hold back!";
}

/**
 * Generate Real Native AI Voice using Gemini 3.8 Flash Lite TTS
 * Fast 24kHz WAV audio generation with Aoede voice
 */
async function generateLyoraVoice(text) {
  try {
    // Strip emotion asterisks (e.g. *giggles*) and emojis for clear spoken audio
    const spokenText = (text || '')
      .replace(/\*[^*]+\*/g, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .trim();
    if (!spokenText) return null;

    // Try fast gemini-3.8-flash-lite-tts first, fallback across multiple TTS models
    const ttsModels = [
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-tts',
      'gemini-3.1-flash-tts-preview',
      'gemini-2.5-flash-preview-tts',
    ];

    for (const model of ttsModels) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: spokenText }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: 'Aoede', // Charming, human-like female voice
                    },
                  },
                },
              },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const part = data.candidates?.[0]?.content?.parts?.[0];
          if (part?.inlineData?.data) {
            return {
              mimeType: part.inlineData.mimeType || 'audio/wav',
              data: part.inlineData.data,
            };
          }
        } else {
          const errBody = await response.text();
          console.warn(`TTS model ${model} returned ${response.status}:`, sanitizeError(errBody).slice(0, 200));
        }
      } catch (innerErr) {
        console.warn(`TTS ${model} attempt failed:`, sanitizeError(innerErr));
      }
    }
  } catch (err) {
    console.warn('Gemini Flash TTS error:', sanitizeError(err));
  }
  return null;
}

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

  io.on('connection', (socket) => {
    socket.emit('lyora-status-updated', {
      isBusy: lyoraState.isBusy,
      callDuration: lyoraState.callStartTime
        ? Math.floor((Date.now() - lyoraState.callStartTime) / 1000)
        : 0,
    });

    /**
     * User clicks "Call Lyora"
     */
    socket.on('call-lyora', async ({ user }) => {
      if (lyoraState.isBusy && lyoraState.activeCallerSocketId !== socket.id) {
        socket.emit('lyora-busy', {
          success: false,
          message: 'Lyora is currently on another call. She will be available in a few moments!',
        });
        return;
      }

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

      // Use pre-cached studio WAV audio for instantaneous 0ms greeting response
      let audioResult = greetingsCache[greeting] || null;
      if (!audioResult) {
        audioResult = await generateLyoraVoice(greeting);
      }

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
     * User speaks or messages Lyora
     */
    socket.on('lyora-user-speech', async (payload) => {
      try {
        if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) {
          socket.emit('lyora-error', { message: 'Not connected to Lyora.' });
          return;
        }

        const text = payload && typeof payload === 'object' ? payload.text : (typeof payload === 'string' ? payload : null);
        if (!text || typeof text !== 'string' || !text.trim()) return;
        const userText = text.trim();

        // Notify caller that Lyora heard them and is processing
        socket.emit('lyora-status', { state: 'thinking' });

        lyoraState.conversationHistory.push({
          role: 'user',
          text: userText,
        });

        // 1. Generate text response with Gemini
        const replyText = await generateLyoraReply(userText, lyoraState.conversationHistory);

        lyoraState.conversationHistory.push({
          role: 'model',
          text: replyText,
        });

        // Send text immediately so caller sees her reply without waiting for TTS
        socket.emit('lyora-reply-text', { text: replyText });
        socket.emit('lyora-status', { state: 'generating-voice' });

        // 2. Generate Real Live AI WAV Audio
        const audioResult = await generateLyoraVoice(replyText);

        if (audioResult?.data) {
          socket.emit('lyora-reply', {
            text: replyText,
            audioData: audioResult.data,
            mimeType: audioResult.mimeType || 'audio/wav',
            timestamp: Date.now(),
          });
          socket.emit('lyora-status', { state: 'speaking' });
        } else {
          socket.emit('lyora-error', { message: 'Voice generation unavailable. Showing text response.' });
          socket.emit('lyora-reply', {
            text: replyText,
            audioData: null,
            mimeType: 'audio/wav',
            timestamp: Date.now(),
          });
          socket.emit('lyora-status', { state: 'listening' });
        }
      } catch (err) {
        console.warn('User speech processing error:', sanitizeError(err));
        socket.emit('lyora-error', { message: 'Failed to process speech message.' });
        socket.emit('lyora-status', { state: 'listening' });
      }
    });

    /**
     * User sends direct recorded microphone audio (100% browser compatibility)
     */
    socket.on('lyora-user-audio', async (payload) => {
      try {
        if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) {
          socket.emit('lyora-error', { message: 'Not connected to Lyora.' });
          return;
        }

        // Validate payload structure
        if (!payload || typeof payload !== 'object') {
          socket.emit('lyora-error', { message: 'Invalid audio payload received.' });
          socket.emit('lyora-status', { state: 'listening' });
          return;
        }

        const { audioBase64, mimeType } = payload;

        // Validate audioBase64
        if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.trim().length < 50) {
          socket.emit('lyora-error', { message: 'Audio recording was too short or empty.' });
          socket.emit('lyora-status', { state: 'listening' });
          return;
        }

        // Move MIME normalization inside the try block, before the first use of cleanMime
        const cleanMime = (typeof mimeType === 'string' && mimeType ? mimeType : 'audio/webm').split(';')[0].trim();

        console.log(`🎙️ Backend received audio from caller ${socket.id}, mime: ${cleanMime}, size: ${audioBase64.length} chars`);
        socket.emit('lyora-status', { state: 'thinking' });

        const contents = lyoraState.conversationHistory.slice(-6).map((turn) => ({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text }],
        }));

        contents.push({
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: audioBase64,
              },
            },
            {
              text: `${LYORA_SYSTEM_INSTRUCTION}
The user just spoke to you in the audio attached.
1. Transcribe what the user said (Malayalam/Manglish, Hindi/Hinglish, or Indian English).
2. Reply directly to them as Lyora in 1-2 sweet spoken sentences, adapting to their language and demeanor.
Return JSON with format: {"transcription": "...", "reply": "..."}`,
            },
          ],
        });

        const audioModels = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
        let rawText = null;

        for (const model of audioModels) {
          try {
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  system_instruction: {
                    parts: [{ text: LYORA_SYSTEM_INSTRUCTION }],
                  },
                  contents,
                  generationConfig: {
                    temperature: 0.85,
                    maxOutputTokens: 1000,
                    responseMimeType: 'application/json',
                  },
                }),
              }
            );

            if (response.ok) {
              const data = await response.json();
              rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (rawText) break;
            } else {
              const errBody = await response.text();
              console.warn(`Audio model ${model} returned ${response.status}:`, sanitizeError(errBody).slice(0, 200));
            }
          } catch (mErr) {
            console.warn(`Audio model ${model} fetch failed:`, sanitizeError(mErr));
          }
        }

        if (rawText) {
          let parsed = null;
          try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              parsed = JSON.parse(rawText);
            }
          } catch (e) {
            const cleaned = rawText.replace(/```[a-z]*|```/gi, '').trim();
            if (cleaned) {
              parsed = { transcription: 'Voice message', reply: cleaned };
            }
          }

          if (parsed && parsed.reply) {
            const userText = parsed.transcription || 'Voice message';
            const replyText = parsed.reply;
            console.log(`✨ Lyora transcribed: "${userText}" | Reply: "${replyText}"`);

            lyoraState.conversationHistory.push({ role: 'user', text: userText });
            lyoraState.conversationHistory.push({ role: 'model', text: replyText });

            socket.emit('lyora-user-transcription', { text: userText });
            socket.emit('lyora-reply-text', { text: replyText });
            socket.emit('lyora-status', { state: 'generating-voice' });

            const audioResult = await generateLyoraVoice(replyText);

            if (audioResult?.data) {
              socket.emit('lyora-reply', {
                text: replyText,
                audioData: audioResult.data,
                mimeType: audioResult.mimeType || 'audio/wav',
                timestamp: Date.now(),
              });
              socket.emit('lyora-status', { state: 'speaking' });
            } else {
              console.warn('Lyora voice generation returned no audio data');
              socket.emit('lyora-error', { message: 'Voice audio generation unavailable. Showing text reply.' });
              socket.emit('lyora-reply', {
                text: replyText,
                audioData: null,
                mimeType: 'audio/wav',
                timestamp: Date.now(),
              });
              socket.emit('lyora-status', { state: 'listening' });
            }
            return;
          }
        }

        console.warn('Lyora audio transcription failed across all models');
        socket.emit('lyora-error', { message: 'Could not understand voice audio. Please try speaking again.' });
        socket.emit('lyora-status', { state: 'listening' });
      } catch (err) {
        console.warn('Audio input processing error:', sanitizeError(err));
        socket.emit('lyora-error', { message: 'Failed to process voice message.' });
        socket.emit('lyora-status', { state: 'listening' });
      }
    });

    /**
     * Caller hangs up
     */
    socket.on('end-lyora-call', () => {
      if (lyoraState.activeCallerSocketId === socket.id) {
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
