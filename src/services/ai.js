const { GoogleGenAI } = require('@google/genai');

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
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

const path = require('path');
const fs = require('fs');

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

    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  /**
   * Generates a voice-optimized response to a user question using Gemini.
   * @param {string} question - The user's question
   * @param {string} userName - The name of the user asking the question
   * @returns {Promise<{ rawText: string, speechText: string }>}
   */
  async askQuestion(question, userName = 'there') {
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

    const systemInstruction = `You are a friendly voice assistant in a Discord voice channel.
Guidelines:
1. Start your answer by naturally addressing the user: "Okay ${cleanUserName}, for your question..." or "Okay ${cleanUserName}, regarding your question...".
2. Answer the question directly, accurately, and conversationally.
3. Keep your answer brief: 2 to 3 sentences maximum so it sounds natural when spoken over audio.
4. NEVER use markdown formatting like asterisks, bullet points, headers, or code blocks.
5. NEVER use emojis.
6. Your response will be read out loud word-for-word by a text-to-speech engine.`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: question,
        config: {
          systemInstruction,
          temperature: 0.7,
          maxOutputTokens: 200,
        },
      });

      const rawText = response.text?.trim() || 'Sorry, I could not generate an answer.';
      const speechText = cleanTextForSpeech(rawText);

      return { rawText, speechText };
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
