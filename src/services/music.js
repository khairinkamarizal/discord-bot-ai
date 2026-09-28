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

        // Improve Spotify bridging to SoundCloud by tuning the bridge search query
        const spExt = this.player.extractors.get('com.discord-player.spotifyextractor');
        if (spExt) {
          spExt.createBridgeQuery = (track) => `${track.author} - ${track.title}`;
        }

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
   * Extracts a playable audio stream for a given Track object.
   * @param {import('discord-player').Track} track
   * @returns {Promise<string | import('stream').Readable>}
   */
  async extractStream(track) {
    await this.init();

    // Normalize any Spotify URL variations like /tracks/ to /track/
    if (track.url && track.url.includes('open.spotify.com/tracks/')) {
      track.url = track.url.replace('/tracks/', '/track/');
    }

    // 1. Try direct extractor stream
    if (track.extractor && typeof track.extractor.stream === 'function') {
      try {
        const stream = await track.extractor.stream(track);
        if (stream) return stream;
      } catch (err) {
        // Fall back to search bridging
      }
    }

    // 2. Try running through loaded extractors
    const streamRes = await this.player.extractors.run(async (extractor) => {
      if (extractor.validate(track.url)) {
        return await extractor.stream(track);
      }
      return null;
    });

    if (streamRes && streamRes.result) {
      return streamRes.result;
    }

    // 3. Fallback: Bridge through SoundCloud search
    const scExt = this.player.extractors.get('com.discord-player.soundcloudextractor');
    if (scExt) {
      const bridgeQuery = `${track.author} - ${track.title}`;
      const scSearch = await scExt.handle(bridgeQuery, { type: 'soundcloudSearch' });
      if (scSearch && scSearch.tracks.length > 0) {
        const scStream = await scExt.stream(scSearch.tracks[0]);
        if (scStream) return scStream;
      }
    }

    throw new Error(`Unable to extract playable audio stream for "${track.title}".`);
  }

  /**
   * Searches for a song or playlist by name or URL.
   * Supports Spotify playlists, albums, SoundCloud sets, and individual tracks.
   * @param {string} query - Song title, search phrase, or music link (SoundCloud, Spotify, etc.)
   * @param {import('discord.js').User} requestedBy
   * @returns {Promise<{
   *   isPlaylist: boolean,
   *   playlist?: {
   *     title: string,
   *     author: string,
   *     url: string,
   *     thumbnail?: string,
   *     trackCount: number,
   *   },
   *   tracks?: Array<object>,
   *   song?: object
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

    // Handle Playlists (Spotify playlist/album, SoundCloud playlist, etc.)
    if (searchResult.hasPlaylist() || searchResult.playlist) {
      const pl = searchResult.playlist;
      const tracks = searchResult.tracks.map((track) => {
        if (track.url && track.url.includes('open.spotify.com/tracks/')) {
          track.url = track.url.replace('/tracks/', '/track/');
        }
        return {
          title: track.title,
          author: track.author || 'Unknown',
          duration: track.duration,
          url: track.url,
          thumbnail: track.thumbnail,
          requestedBy,
          track,
          streamUrl: null, // Extracted on-demand during playback
        };
      });

      return {
        isPlaylist: true,
        playlist: {
          title: pl?.title || 'Playlist',
          author: pl?.author?.name || pl?.author || 'Various Artists',
          url: pl?.url || query,
          thumbnail: pl?.thumbnail || tracks[0]?.thumbnail,
          trackCount: tracks.length,
        },
        tracks,
      };
    }

    // Handle Single Track
    const track = searchResult.tracks[0];
    if (track.url && track.url.includes('open.spotify.com/tracks/')) {
      track.url = track.url.replace('/tracks/', '/track/');
    }

    const streamUrl = await this.extractStream(track);

    return {
      isPlaylist: false,
      song: {
        title: track.title,
        author: track.author || 'Unknown',
        duration: track.duration,
        url: track.url,
        thumbnail: track.thumbnail,
        streamUrl,
        requestedBy,
        track,
      },
    };
  }
}

module.exports = {
  MusicService,
};
