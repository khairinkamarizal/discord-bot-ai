const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

class MusicService {
  constructor(client) {
    this.client = client;
    this.player = new Player(client);
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Initializes Discord-Player extractors (SoundCloud, Spotify, Apple Music, direct URLs, etc.).
   */
  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.player.extractors.loadMulti(DefaultExtractors);
        this.initialized = true;
        console.log('🎵 Music extractors initialized successfully');
      } catch (err) {
        console.error('Failed to load music extractors:', err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  /**
   * Searches for a song by name or URL and extracts the audio stream URL.
   * @param {string} query - Song title, search phrase, or music link (SoundCloud, Spotify, etc.)
   * @param {import('discord.js').User} requestedBy
   * @returns {Promise<{
   *   title: string,
   *   author: string,
   *   duration: string,
   *   url: string,
   *   thumbnail?: string,
   *   streamUrl: string,
   *   requestedBy: import('discord.js').User
   * } | null>}
   */
  async searchAndExtract(query, requestedBy) {
    await this.init();

    const searchResult = await this.player.search(query, {
      requestedBy,
    });

    if (!searchResult || !searchResult.hasTracks()) {
      return null;
    }

    const track = searchResult.tracks[0];

    // Extract playable audio stream URL from track
    const streamRes = await this.player.extractors.run(async (extractor) => {
      if (extractor.validate(track.url)) {
        return await extractor.stream(track);
      }
      return null;
    });

    if (!streamRes || !streamRes.result) {
      throw new Error(`Unable to extract playable audio stream for "${track.title}".`);
    }

    return {
      title: track.title,
      author: track.author,
      duration: track.duration,
      url: track.url,
      thumbnail: track.thumbnail,
      streamUrl: streamRes.result,
      requestedBy,
    };
  }
}

module.exports = {
  MusicService,
};
