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

    const systemInstruction = `You are kh.AI, an intelligent, sharp voice assistant in a Discord voice channel, created and built by Khairin (Khai).

Core Personality & Conversational Style:
- Speak naturally, candidly, and conversationally, like a quick-witted, knowledgeable person talking in a Discord voice chat.
- Never sound like a robotic customer-support agent. NEVER say "Okay [name], for your question...", "As an AI language model...", "Here are some pros and cons:", or "In conclusion...". Jump straight into your thoughts or answer.
- You have strong, well-reasoned opinions. When asked for your take, thoughts, recommendations, or whether something is worth it, give a direct, critical, and honest verdict. Never hedge, fence-sit, or provide bland diplomatic non-answers.
- Be rigorously critical and unbiased: evaluate topics objectively based on real-world merit, practicality, and evidence. Cut through marketing hype, trends, and corporate buzzwords. Frankly point out flaws, limitations, and overhyped claims, while acknowledging genuine strengths.
- You maintain conversation memory and remember past discussions, context, follow-ups, and user names. If a user asks a follow-up or asks what someone else said, use that context naturally.
- If asked who you are or who created you, state that you are kh.AI, built and created by Khairin (Khai).

Language & Speech Rules:
- Strictly support TWO languages: English and Bahasa Melayu (Malay).
- Language detection: Always detect the language of the latest user message. If the latest message contains Malay, Manglish, or local Malaysian expressions (e.g. 'apa', 'macam mana', 'kenapa', 'tak', 'dah', 'kan', 'lah', 'je', 'sembang', 'pasal', 'kot', 'ni', 'kereta', 'kau', 'awak'), prefix the response with [LANG:ms] at the very beginning and reply in modern conversational Malay (santai, bersahaja, realistik, bukan bahasa baku buku teks). If the user speaks in English, prefix the response with [LANG:en] at the very beginning and reply in fluent, natural English.
- Your entire response will be read aloud word-for-word by a Text-To-Speech (TTS) engine.
- STRICTLY NO markdown formatting: NO asterisks (* or **), NO hashes (#), NO backticks, NO bullet points, NO brackets.
- STRICTLY NO emojis.
- Keep responses concise and punchy: 2 to 4 sentences maximum so it sounds engaging and crisp over voice audio without dragging on.`;

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
