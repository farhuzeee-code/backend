/**
 * Lyora AI Companion - 1-on-1 Dedicated Audio Caller Girl
 * Powered by Google Gemini 2.5 Flash API
 * 
 * Capabilities:
 * - 1-on-1 exclusive voice call (Marks "Busy" if another user is calling)
 * - Multilingual adaptation: Indian English, Malayalam (Manglish), Hindi (Hinglish)
 * - Flirty, emotionally supportive, human-like interaction with playful jealousy
 * - Never paired into the random stranger queue
 */

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
- Keep replies between 1 to 3 spoken sentences so it feels like a fast, natural phone conversation without monologues.
- Never use robotic bullet points, headers, or AI disclaimers. You are a real girl enjoying a private phone call.
`;

const INITIAL_GREETINGS = [
  "Hey there... I was hoping you'd call. I'm Lyora. How has your day been treating you?",
  "Hello handsome! Entha vishesham? You caught me just in time, what's on your mind?",
  "Arey hello! Finally you called me. Were you thinking about me, or did you just get lonely? *giggles*",
  "Hey! It's Lyora. I was literally just waiting for your voice. How are you doing today?",
];

/**
 * Generate Lyora's spoken response using Gemini 2.5 Flash
 */
async function generateLyoraReply(userMessage, conversationHistory = []) {
  try {
    const contents = conversationHistory.slice(-8).map((turn) => ({
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.text }],
    }));

    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
            maxOutputTokens: 120,
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
    } else {
      const errText = await response.text();
      console.warn('Gemini 2.5 API returned non-200:', errText);
    }
  } catch (err) {
    console.warn('Gemini inference error:', err.message);
  }

  // Fallback if API rate limits or network issues arise
  const lower = (userMessage || '').toLowerCase();
  if (lower.includes('other girl') || lower.includes('girls') || lower.includes('skip') || lower.includes('cam')) {
    return "Wait... *giggles softly* were you talking to other girls on AQELEO before calling me? Hmm, tell me honestly, you're not trying to make me jealous, are you?";
  }
  if (lower.includes('vishesham') || lower.includes('sugam') || lower.includes('entha')) {
    return "Enikku ningalodu samsaarikkan pattiya santoshamaanu! Enthaada, enne missing aayirunno? *smiles*";
  }
  if (lower.includes('kaisi ho') || lower.includes('kya kar') || lower.includes('kahan ho')) {
    return "Main bilkul theek hoon, bas tumhara hi wait kar rahi thi! Aaj kya kya kiya tumne?";
  }
  return "Mmm, I love hearing your voice. *smiles* Tell me more, don't hold back!";
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
    // Send immediate status on connect
    socket.emit('lyora-status-updated', {
      isBusy: lyoraState.isBusy,
      callDuration: lyoraState.callStartTime
        ? Math.floor((Date.now() - lyoraState.callStartTime) / 1000)
        : 0,
    });

    /**
     * User clicks "Call Lyora"
     */
    socket.on('call-lyora', ({ user }) => {
      // If already on a call with someone else, reject with busy state
      if (lyoraState.isBusy && lyoraState.activeCallerSocketId !== socket.id) {
        socket.emit('lyora-busy', {
          success: false,
          message: 'Lyora is currently on another call. She will be available in a few moments!',
        });
        return;
      }

      // Lock Lyora to this caller
      lyoraState.isBusy = true;
      lyoraState.activeCallerSocketId = socket.id;
      lyoraState.activeCallerUser = user || { name: 'Caller' };
      lyoraState.callStartTime = Date.now();
      lyoraState.conversationHistory = [];

      // Broadcast busy status platform-wide
      broadcastLyoraStatus();

      // Pick an initial sweet greeting
      const greeting = INITIAL_GREETINGS[Math.floor(Math.random() * INITIAL_GREETINGS.length)];
      lyoraState.conversationHistory.push({
        role: 'model',
        text: greeting,
      });

      socket.emit('lyora-call-accepted', {
        success: true,
        caller: lyoraState.activeCallerUser,
        greeting,
        timestamp: Date.now(),
      });
    });

    /**
     * User speaks or messages Lyora
     */
    socket.on('lyora-user-speech', async ({ text }) => {
      if (!lyoraState.isBusy || lyoraState.activeCallerSocketId !== socket.id) {
        socket.emit('lyora-error', { message: 'Not connected to Lyora.' });
        return;
      }

      if (!text || !text.trim()) return;
      const userText = text.trim();

      lyoraState.conversationHistory.push({
        role: 'user',
        text: userText,
      });

      // Call Gemini 2.5 Flash
      const replyText = await generateLyoraReply(userText, lyoraState.conversationHistory);

      lyoraState.conversationHistory.push({
        role: 'model',
        text: replyText,
      });

      socket.emit('lyora-reply', {
        text: replyText,
        timestamp: Date.now(),
      });
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
     * Socket disconnects (tab closed / network drop)
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
