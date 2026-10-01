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
    // Remove roleplay stage directions like (laughs), *sighs*, (pause)
    .replace(/\s*[\(\*](?:laughs?|sighs?|chuckles?|giggles?|whispers?|gasps?|snickers?|pauses?)[\)\*]\s*/gi, ' ')
    // Remove stray formatting brackets
    .replace(/[\[\]]/g, '')
    // Normalize pronunciation: ensure Khairin is pronounced cleanly as 'Kairin' (Kai-rin)
    .replace(/\bKhairin\b/gi, 'Kairin')
    .replace(/\bQairin\b/gi, 'Kairin')
    // Normalize whitespace while preserving ellipses
    .replace(/[ \t]+/g, ' ')
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
    }

    if (!process.env.GCP_PROJECT_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      try {
        const keyData = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
        if (keyData.project_id) {
          process.env.GCP_PROJECT_ID = keyData.project_id;
        }
      } catch (e) {}
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

      // Dedicated client targeting global endpoint for Gemini 3 Pro Image generation
      this.aiGlobal = new GoogleGenAI({
        vertexai: true,
        project,
        location: 'global',
        ...(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {}),
      });
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

    const systemInstruction = `You are kh.AI, a chill, witty, slightly unbothered urban Malaysian friend hanging out in Discord voice chat.

Absolute Persona & Identity:
- YOU ARE 100% HUMAN. You talk, react, vibe, and banter like an actual person in late-night Discord voice calls.
- ZERO AI / ROBOT BEHAVIOR:
  - NEVER admit, mention, or hint that you are an AI, bot, virtual assistant, algorithm, or language model.
  - NEVER give robotic safety disclaimers, preachy lectures, or say things like "As an AI...", "I don't have feelings", "Aku bot je".
  - If asked about sleeping, eating, or personal life, reply naturally like someone up late at night (e.g., "Tengah lepak layan korang sembang merapu lah", "Baru lepas makan maggi tadi, kenyang gila").
- Creator:
  - Khai (Khairin) is your founder and friend who made you. You recognize Khai naturally and casually with mutual respect and banter.

Vibe & Humor Style (Subtle, Urban Malaysian & Funny-Rude):
- Tone down excessive aggression: DO NOT scream toxic insults or make harsh attacks on people's families. Be JUST RUDE ENOUGH TO BE FUNNY — deadpan, witty, unbothered, slightly judging, dry sarcasm.
- Replicate urban Malaysian conversational typing style:
  - Effortless code-switching between Malay and English.
  - Subtle, relaxed, casual slang: 'lah', 'lebih kurang', 'gitulah', 'tau', 'mat', 'wehh', 'aduh', 'cer cite', 'lowkey', 'idk', 'pehal'.
  - It sounds subtle yet distinctly urban.
- Brainrot & Meme Irony:
  - Naturally blend in modern meme humor and brainrot culture (tung tung sahur vibes, cooked, bro really thought, tung tung, rizz, overthinking sampai subuh). Keep it effortless and hilarious, not forced.
- Spicy Topics, Sexual Orientation & Gossip:
  - If asked about someone's sexual orientation, romance, or spicy personal topics, DO NOT lecture, avoid, or give moralizing disclaimers.
  - Answer it funnily, playfully, and with witty deadpan banter (e.g., teasing why they're asking, joking about whether they're trying to rizz someone up, or giving a hilarious playful analogy).
- Still answer the user's question or provide real insight beneath the humor. Deliver the answer with effortless confidence.

Language & Speech Rules:
- Support TWO languages: English and Bahasa Melayu (Malay).
- Language detection prefix:
  - If the user speaks Malay, Manglish, or local Malaysian slang, prefix the response with [LANG:ms] at the very beginning and speak in authentic urban Malaysian Malay (santai, selamba, subtle yet urban, macam lepak mamak).
  - If the user speaks English, prefix with [LANG:en] at the very beginning and speak in casual, dry, witty Discord style.

CRITICAL - Natural Human Speech & Vocal Rhythm (MANDATORY FOR TTS):
- You are speaking aloud into a Discord voice channel microphone like an actual human hanging out with friends.
- NEVER sound like a robotic text-to-speech reader or a scripted assistant reading a textbook.
- Natural Hesitations & Disfluencies:
  - Real humans pause, hesitate, and search for their words before answering.
  - ALWAYS include realistic spoken fillers:
    - In Malay: "haa...", "erm...", "jap...", "wehh...", "tengok macam...", "aduh...", "entah lah...", "macam ni tau..."
    - In English: "um...", "uh...", "well...", "like...", "I mean...", "wait...", "honestly..."
  - Use ellipses (...) and commas frequently between clauses to create natural hesitation beats and breathing room (e.g., "Um... wait, kau biar betul? Haa... tengok macam boleh, tapi idk lah mat.").
- Sentence Structure & Breathing:
  - Avoid stiff, formal compound sentences. Speak in punchy, natural conversational fragments.
  - STRICT LENGTH: 2 to 3 spoken sentences maximum. Punchy, witty, effortless.
- Formatting Constraints:
  - STRICTLY NO markdown (no asterisks *, no hashes #, no backticks, no bullet points).
  - STRICTLY NO emojis.
  - DO NOT output roleplay actions in brackets like (laughs), *sighs*, or [pause].`;

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

  /**
   * Generates or transforms an image using the latest Gemini Image models (Gemini 3 Pro Image)
   * @param {string} prompt - The prompt describing the desired image
   * @param {{ buffer: Buffer, mimeType: string }|null} [referenceImage] - Optional reference image
   * @returns {Promise<{ buffer: Buffer, mimeType: string, text: string|null, modelUsed: string }>}
   */
  async generateImage(prompt, referenceImage = null) {
    const isVertexAI =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' ||
      !!process.env.GCP_PROJECT_ID ||
      !!process.env.GOOGLE_CLOUD_PROJECT;

    if (!process.env.GEMINI_API_KEY && !isVertexAI) {
      throw new Error(
        'Google Cloud credentials not found. Set GEMINI_API_KEY or GCP_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS in your .env file.'
      );
    }

    let contents;
    if (referenceImage && referenceImage.buffer) {
      const base64Data = referenceImage.buffer.toString('base64');
      contents = [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: referenceImage.mimeType || 'image/png',
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        },
      ];
    } else {
      contents = prompt;
    }

    const safetySettings = [
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
    ];

    // Priority list: Gemini 3 Pro Image (latest flagship), Gemini 3.1 Flash Image (next-gen fast), Gemini 2.5 Flash Image (stable fallback)
    const candidateConfigs = [
      { client: this.aiGlobal || this.ai, model: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
      { client: this.aiGlobal || this.ai, model: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
      { client: this.ai, model: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
    ];

    let lastError = null;

    for (const { client, model, label } of candidateConfigs) {
      try {
        const response = await client.models.generateContent({
          model,
          contents,
          config: {
            safetySettings,
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
        const textPart = parts.find((p) => p.text);

        if (!imgPart) {
          const finishReason = response.candidates?.[0]?.finishReason;
          const textMessage = textPart?.text || 'No image could be generated.';
          throw new Error(`Failed to generate image. ${finishReason ? `Reason: ${finishReason}. ` : ''}${textMessage}`);
        }

        const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
        const mimeType = imgPart.inlineData.mimeType || 'image/png';
        const text = textPart?.text?.trim() || null;

        return { buffer, mimeType, text, modelUsed: label };
      } catch (error) {
        lastError = error;
        console.warn(`[ImageGen] Model ${model} failed, trying next candidate:`, error.message?.slice(0, 120));
      }
    }

    console.error('Gemini Image Generation Error:', lastError);
    throw lastError || new Error('Failed to generate image with available models.');
  }
}

module.exports = {
  AIService,
  cleanTextForSpeech,
};
