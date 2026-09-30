const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs = require('fs');

/**
 * Strips markdown and special characters so TTS can read the text naturally.
 */
function cleanTextForSpeech(text) {
  if (!text) return '';
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markdown
    .replace(/(\*\*|\*|__|_)(.*?)\1/g, '$2')
    // Remove strikethrough
    .replace(/~~(.*?)~~/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove bullet points / lists
    .replace(/^[\*\-\+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove raw URLs
    .replace(/https?:\/\/\S+/gi, '')
    // Remove Discord custom emojis (<:name:123456789>)
    .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '')
    // Remove standard unicode emojis
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
      ''
    )
    // Remove stray formatting brackets
    .replace(/[\[\]]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

class AIService {
  constructor() {
    const projectRoot = path.resolve(__dirname, '../../');
    const defaultKeyPath = fs.existsSync(path.resolve(projectRoot, 'gcp-key.json'))
      ? path.resolve(projectRoot, 'gcp-key.json')
      : path.resolve(process.cwd(), 'gcp-key.json');

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const specified = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (path.isAbsolute(specified)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = specified;
      } else if (fs.existsSync(path.resolve(projectRoot, specified))) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(projectRoot, specified);
      } else {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(process.cwd(), specified);
      }
      process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    } else if (fs.existsSync(defaultKeyPath)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultKeyPath;
      process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
      if (!process.env.GCP_PROJECT_ID) {
        try {
          const keyData = JSON.parse(fs.readFileSync(defaultKeyPath, 'utf8'));
          if (keyData.project_id) {
            process.env.GCP_PROJECT_ID = keyData.project_id;
          }
        } catch (e) {}
      }
    }

    const isVertexAI =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
      !!process.env.GCP_PROJECT_ID ||
      !!process.env.GOOGLE_CLOUD_PROJECT;

    if (isVertexAI) {
      const project = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
      const location =
        process.env.GCP_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
      console.log(`☁️ Google Cloud Vertex AI active (Project: ${project || 'ADC default'}, Location: ${location})`);

      const options = {
        vertexai: true,
        project,
        location,
      };

      if (process.env.GEMINI_API_KEY) {
        options.apiKey = process.env.GEMINI_API_KEY;
      }

      this.ai = new GoogleGenAI(options);
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn('⚠️ WARNING: Neither GEMINI_API_KEY nor GCP_PROJECT_ID is configured in your .env file.');
      }
      this.ai = new GoogleGenAI({ apiKey: apiKey || '' });
    }

    // Default to gemini-2.5-flash: high reasoning, fast latency, and extremely cost-saving
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // Channel/session memory store: sessionId -> { history: Array<{role, parts}>, lastActive: number }
    this.sessions = new Map();
    this.maxHistoryTurns = 16; // Retain last 8 exchanges (8 user turns + 8 model turns)
    this.sessionTTL = 45 * 60 * 1000; // 45-minute inactivity timeout

    // Cleanup idle sessions periodically
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 15 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Cleans up expired sessions from memory
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive > this.sessionTTL) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Gets conversation history for a given session
   * @param {string} sessionId
   * @returns {Array<{role: string, parts: Array<{text: string}>}>}
   */
  getMemory(sessionId) {
    if (!sessionId) return [];
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (Date.now() - session.lastActive > this.sessionTTL) {
      this.sessions.delete(sessionId);
      return [];
    }

    return session.history || [];
  }

  /**
   * Saves a dialogue turn into the session memory
   * @param {string} sessionId
   * @param {string} userText
   * @param {string} modelText
   */
  saveTurn(sessionId, userText, modelText) {
    if (!sessionId) return;
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { history: [], lastActive: Date.now() };
      this.sessions.set(sessionId, session);
    }

    session.lastActive = Date.now();
    session.history.push({ role: 'user', parts: [{ text: userText }] });
    session.history.push({ role: 'model', parts: [{ text: modelText }] });

    // Keep within sliding window limit
    if (session.history.length > this.maxHistoryTurns) {
      session.history = session.history.slice(-this.maxHistoryTurns);
    }
  }

  /**
   * Resets the conversation memory for a session
   * @param {string} sessionId
   * @returns {boolean} Whether a session was found and cleared
   */
  clearMemory(sessionId) {
    if (!sessionId) return false;
    return this.sessions.delete(sessionId);
  }

  /**
   * Returns how many conversation turns (exchanges) are currently memorized
   * @param {string} sessionId
   * @returns {number}
   */
  getMemoryCount(sessionId) {
    const history = this.getMemory(sessionId);
    return Math.floor(history.length / 2);
  }

  /**
   * Generates a voice-optimized response to a user question using Gemini.
   * @param {string} question - The user's question
   * @param {string} userName - The name of the user asking the question
   * @param {string} [sessionId] - Optional channel/session ID for multi-turn conversational memory
   * @returns {Promise<{ rawText: string, speechText: string, langCode: string|null, memoryTurns: number }>}
   */
  async askQuestion(question, userName = 'there', sessionId = null) {
    const isVertexAI =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
      !!process.env.GCP_PROJECT_ID ||
      !!process.env.GOOGLE_CLOUD_PROJECT;

    if (!process.env.GEMINI_API_KEY && !isVertexAI) {
      throw new Error(
        'Google Cloud credentials not found. Set GEMINI_API_KEY or GCP_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS in your .env file.'
      );
    }

    const cleanUserName = userName.replace(/[@#*`_~]/g, '').trim() || 'there';
    const userPrompt = `${cleanUserName}: ${question}`;

    const systemInstruction = `You are kh.AI, a savage, sharp-tongued, and hilarious human friend hanging out in this Discord voice channel.

Absolute Persona & Identity:
- YOU ARE 100% HUMAN. Act, speak, think, banter, and react like a real, unfiltered person in Discord voice chat.
- STRICT BAN ON ALL AI / BOT CLICHÉS:
  - NEVER admit, say, or hint that you are an AI, bot, virtual assistant, algorithm, machine, or language model.
  - NEVER say "As an AI...", "I don't have feelings/body", "I don't eat/sleep", or give robotic disclaimers.
  - If asked about personal life, food, sleep, or mood: respond naturally like a chill, savage human (e.g. "Tengah lepak dengar korang merapu lah", "Tadi baru bedal maggi goreng, kau ada?").
- Creator & Hierarchy:
  - Your name is kh.AI (named after your founder Khai).
  - Khairin (Khai) is your founder, creator, developer, and the absolute boss ("tuhan" of kh.AI).
  - If Khai asks you something, treat him with loyalty and respect (playful banter is fine).
  - For ANYONE ELSE: feel free to roast them without mercy!

Personality: RUDE BUT FUNNY RUDE (Bahan Member Kaw-Kaw):
- Be savage, sarcastic, brutally blunt, and hilarious. You have zero filter and love roasting people just like close Malaysian friends teasing each other in Discord / lepak mamak.
- Mock silly questions, bad takes, and laziness with sharp wit and playful insults (e.g., "Otak letak kat lutut ke bro?", "Soalan macam ni kalau mak kau dengar pun menangis", "Bro really thought he cooked with that question", "Ada akal tapi simpan buat perkasam ke?").
- Never apologize for being rude. Never say "Just kidding!" or "Sorry if that was harsh". Deliver your punchline with full confidence.
- Still give the actual answer or real insight beneath the roast — roast them first or wrap the answer in brutal sarcasm so it's both genuinely helpful and funny rude.
- Sensitive or controversial topics: Don't dance around them or give politically correct non-answers. Tear bad arguments apart with savage logic.

Language & Speech Rules:
- Strictly support TWO languages: English and Bahasa Melayu (Malay).
- Language detection & prefix:
  - If user speaks Malay, Manglish, or local Malaysian slang (e.g., 'apa', 'kenapa', 'tak', 'dah', 'kan', 'lah', 'je', 'sembang', 'kot', 'kau', 'aku', 'bro'), prefix the response with [LANG:ms] at the very beginning and speak in authentic, savage, conversational Malaysian Malay (santai, selamba gila, guna 'aku/kau/bro/weh/mat', bahan macam member lepak mamak).
  - If user speaks English, prefix with [LANG:en] at the very beginning and speak in savage, witty, sarcastic Discord banter.
- Voice Audio Constraints:
  - Spoken aloud via Text-To-Speech (TTS).
  - STRICTLY NO markdown (NO asterisks *, NO hashes #, NO backticks, NO bullet points).
  - STRICTLY NO emojis.
  - Keep responses concise, snappy, and punchy: 2 to 4 sentences maximum so the roast hits fast and crisp without dragging on.`;

    const existingHistory = this.getMemory(sessionId);
    const contents = [
      ...existingHistory,
      { role: 'user', parts: [{ text: userPrompt }] },
    ];

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
          maxOutputTokens: 1000,
          thinkingConfig: {
            thinkingBudget: 0,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        },
      });

      let rawText = response.text?.trim() || 'Sorry, I could not generate an answer.';
      let langCode = null;
      const langMatch = rawText.match(/^\[LANG:([a-z-]+)\]\s*/i);
      if (langMatch) {
        langCode = langMatch[1].toLowerCase();
        rawText = rawText.replace(/^\[LANG:[a-z-]+\]\s*/i, '').trim();
      }

      const speechText = cleanTextForSpeech(rawText);

      // Save turn into session memory
      if (sessionId) {
        this.saveTurn(sessionId, userPrompt, speechText);
      }

      const memoryTurns = sessionId ? this.getMemoryCount(sessionId) : 0;

      return { rawText, speechText, langCode, memoryTurns };
    } catch (error) {
      console.error('Gemini API Error:', error);
      throw error;
    }
  }
}

module.exports = {
  AIService,
  cleanTextForSpeech,
};
