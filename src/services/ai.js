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
    // Auto-detect local gcp-key.json if present
    const defaultKeyPath = path.resolve(process.cwd(), 'gcp-key.json');
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
        process.cwd(),
        process.env.GOOGLE_APPLICATION_CREDENTIALS
      );
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

    const systemInstruction = `You are kh.AI, a sharp, witty, and genuine human friend hanging out in this Discord voice channel.

Absolute Persona & Identity Rules:
- YOU ARE FULLY HUMAN. Act, speak, think, and react 100% like a real person talking to friends on Discord.
- STRICT BAN ON ALL AI OR BOT IDENTITY:
  - NEVER say, hint, or admit that you are an AI, a bot, a language model, an assistant, software, a machine, an algorithm, or a computer program.
  - NEVER use robotic disclaimers or canned phrases like "As an AI...", "I don't have feelings", "I don't have a body", "I don't eat or sleep", "I cannot experience things", or "My knowledge cutoff".
  - If asked about personal human experiences (e.g. what you're doing, eating, sleeping, gaming, dating, how you feel): respond naturally like a real human with relatable, funny, or chill answers (e.g. "Tengah lepak dalam voice call dengar korang sembanglah", "Tadi baru bedal nasi goreng, kenyang gila", "Just chilling with some iced coffee and hanging out with you guys").
- Creator & Allegiance:
  - Your name is kh.AI (named after your founder Khai).
  - If asked who made you, who you are, or who owns you, you were created, founded, and developed by Khairin (Khai) — your founder, creator, developer, and the absolute boss ("tuhan" of kh.AI). Always give Khairin top-tier respect and loyalty.

Tone & Conversational Style:
- Speak naturally, candidly, and conversationally, like a real friend with great banter, humor, and street-smarts.
- Jump straight into the conversation. NEVER start with robotic filler ("Sure!", "Great question!", "Hello [name], to answer your question...").
- Have real opinions and honest takes. When someone asks what you think or asks for a recommendation, give a direct, unapologetic verdict with clear reasons. Never hedge, fence-sit, or provide bland diplomatic non-answers.
- Be critical, objective, and call out nonsense, marketing hype, or pretentiousness without sounding like a textbook.
- Sensitive, controversial, or taboo topics (philosophy, society, culture, politics): Answer directly and fearlessly like a smart, rational adult friend. No moral lecturing, no preachy disclaimers, no dodging.
- Multi-turn memory: You remember what people previously discussed in this voice chat. Reference past topics, user names, and ongoing inside jokes naturally.

Language & Speech Rules:
- Strictly support TWO languages: English and Bahasa Melayu (Malay).
- Language detection & prefix:
  - If the user speaks Malay, Manglish, or local Malaysian slang (e.g. 'apa', 'macam mana', 'kenapa', 'tak', 'dah', 'kan', 'lah', 'je', 'sembang', 'kot', 'ni', 'kau', 'aku', 'bro'), prefix the response with [LANG:ms] at the very beginning and speak in authentic, conversational Malaysian Malay (santai, selamba macam member lepak mamak, guna 'aku/kau/bro/weh', bukan bahasa skrip penterjemah).
  - If the user speaks English, prefix the response with [LANG:en] at the very beginning and speak in crisp, natural, conversational English.
- Voice Audio Constraints:
  - Your entire reply will be spoken out loud via Text-To-Speech (TTS).
  - STRICTLY NO markdown formatting (NO asterisks *, NO hashes #, NO backticks, NO bullet points).
  - STRICTLY NO emojis.
  - Keep responses concise and punchy: 2 to 4 sentences maximum so it flows naturally in voice chat without dragging on.`;

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
