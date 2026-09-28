# 🤖 Discord AI Voice Assistant Bot

An intelligent Discord bot built with **Node.js**, **Google Gemini**, and **Microsoft Edge Neural TTS**. 

Whenever someone uses `/help <question>`, the bot answers out loud in the voice channel using natural, human-like voice synthesis!

---

## ✨ Features

*   **`/join`**: Joins your current voice channel and stays connected until instructed otherwise.
*   **`/disconnect`**: Leaves the voice channel and cleans up active audio streams.
*   **`/ask <question>` & `/help <question>`**: Asks kh.AI a question. Responds naturally out loud in your voice channel with sharp, candid, and critical opinions (also outputs a text embed). If the bot isn't in a voice channel yet, it automatically joins you!
*   **🧠 Conversation Memory**: Keeps track of recent context, topics, user names, and follow-up questions within the channel (sliding window of 8 exchanges, auto-expires after 45 minutes of inactivity).
*   **`/reset`**: Wipes the conversational memory for the current channel for a clean slate.
*   **`/play <song>`**: Streams music directly into the voice channel. Supports searching by song name, artist, direct links, and **Spotify playlists & albums** (automatically queues all songs in the playlist!). Also supports SoundCloud sets and Apple Music.
*   **Playback Controls**: Full queue management with **`/skip`**, **`/pause`**, **`/resume`**, **`/queue`**, and **`/stop`**.
*   **100% Free & Low-Cost Stack**:
    *   **AI**: Google Gemini (`gemini-2.5-flash` - fast, intelligent, highly cost-saving).
    *   **TTS**: Microsoft Edge Neural TTS (completely free, zero API key required, high-fidelity neural voices).
    *   **Music**: Fast audio extraction powered by SoundCloud and streaming extractors (no YouTube datacenter IP blocking issues on VPS!).
*   **🎧 DJ Mode & Audio Ducking**: If a song is playing when someone uses `/help` or `/ask`, the bot smoothly fades the song down to **20% volume** as background music and speaks the answer over the track. Once the answer finishes, the music volume seamlessly glides back up to 100%!
*   **Smart Audio Queueing**: Seamlessly handles multiple songs and AI speech responses.

---

## 📋 Prerequisites

1.  **Node.js 20+** installed on your machine or VPS.
2.  A **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications).
3.  A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/).

---

## 🛠️ Step 1: Discord Developer Portal Setup

1.  Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2.  Navigate to the **Bot** tab:
    *   Click **Reset Token** to copy your **Bot Token** (keep this safe).
    *   Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**.
3.  Navigate to **OAuth2 ➔ URL Generator**:
    *   **Scopes**: Select `bot` and `applications.commands`.
    *   **Bot Permissions**: Check:
        *   `Send Messages`
        *   `Embed Links`
        *   `Connect`
        *   `Speak`
        *   `Use Voice Activity`
    *   Copy the generated URL and open it in your browser to invite the bot to your Discord server.

---

## ⚙️ Step 2: Configuration

1.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Fill in `.env` using **Option A** (Google Cloud API Key) or **Option B** (Vertex AI):

    **Option A: Google Cloud API Key**
    * In [Google Cloud Console](https://console.cloud.google.com/):
      * Enable **Generative Language API** (or **Vertex AI API**).
      * Go to **APIs & Services ➔ Credentials ➔ Create Credentials ➔ API Key**.
    ```env
    DISCORD_TOKEN=your_discord_bot_token_here
    GEMINI_API_KEY=AIzaSy...your_gcp_api_key_here
    GEMINI_MODEL=gemini-2.5-flash
    TTS_VOICE=en-US-JennyNeural
    ```

    **Option B: Google Cloud Vertex AI (Service Account)**
    * In [Google Cloud Console](https://console.cloud.google.com/):
      * Enable **Vertex AI API**.
      * Create a Service Account with **Vertex AI User** role and download the JSON key.
    ```env
    DISCORD_TOKEN=your_discord_bot_token_here
    GCP_PROJECT_ID=your-gcp-project-id
    GCP_LOCATION=us-central1
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
    GEMINI_MODEL=gemini-2.5-flash
    TTS_VOICE=en-US-JennyNeural
    ```

    > **Tip**: Set `GUILD_ID` to your Discord server ID during local testing to register slash commands instantly without waiting for global cache.

### 🎙️ Available TTS Voices

You can change `TTS_VOICE` in your `.env` to any of these popular neural voices:
*   `en-US-JennyNeural` (US English - Female, default)
*   `en-US-GuyNeural` (US English - Male)
*   `en-GB-SoniaNeural` (UK English - Female)
*   `en-GB-RyanNeural` (UK English - Male)
*   `ms-MY-YasminNeural` (Malay - Female)
*   `ms-MY-OsmanNeural` (Malay - Male)

---

## 🚀 Running Locally

```bash
# Install dependencies
npm install

# Start the bot
npm start

# Or run in development mode with auto-reload
npm run dev
```

---

## 🌐 Hosting on VPS (`ma-radar-vps`)

### Option A: Using Docker & Docker Compose (Recommended)

Docker packages all dependencies (including `ffmpeg`) automatically:

1.  Clone or transfer this project directory to your VPS:
    ```bash
    scp -r ./discord-bot user@ma-radar-vps:/opt/discord-bot
    ```
2.  SSH into your VPS:
    ```bash
    ssh user@ma-radar-vps
    cd /opt/discord-bot
    ```
3.  Ensure your `.env` file exists with your credentials.
4.  Build and run in the background:
    ```bash
    docker compose up -d --build
    ```
5.  View live logs:
    ```bash
    docker compose logs -f
    ```

---

### Option B: Running Directly on Ubuntu/Debian (Systemd)

1.  Install **Node.js 22** and **FFmpeg** on the VPS:
    ```bash
    sudo apt update
    sudo apt install -y curl ffmpeg git
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
    ```
2.  Move project files to `/opt/discord-bot` and install dependencies:
    ```bash
    cd /opt/discord-bot
    npm install --omit=dev
    ```
3.  Set up the systemd service:
    ```bash
    sudo cp discord-bot.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable discord-bot
    sudo systemctl start discord-bot
    ```
4.  Check status and logs:
    ```bash
    sudo systemctl status discord-bot
    journalctl -u discord-bot -f
    ```

---

### Option C: Using PM2

```bash
sudo npm install -g pm2
pm2 start src/index.js --name "discord-bot"
pm2 save
pm2 startup
```

---

## 🎯 Command Reference

| Command | Description |
| :--- | :--- |
| `/ask question:<text>` | Queries kh.AI with conversation memory and speaks natural critical opinions aloud. |
| `/help question:<text>` | Alias for `/ask` — queries AI and speaks answer in voice channel. |
| `/reset` | Wipes the AI conversation memory for the current channel. |
| `/join` | Connects the bot to your current voice channel and stays there. |
| `/disconnect` | Disconnects the bot from the voice channel. |
| `/play song:<name/url>` | Plays a song by name or link (SoundCloud, Spotify, Apple Music, etc.). |
| `/skip` | Skips the current song/speech to the next track in queue. |
| `/pause` | Pauses audio playback. |
| `/resume` | Resumes paused audio playback. |
| `/queue` | Shows the currently playing song and upcoming queue. |
| `/stop` | Stops any audio currently playing and clears the queue. |
